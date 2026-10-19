import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientProxy, RpcException } from "@nestjs/microservices";
import { PaymentStatus, Prisma } from "@prisma/client";
import { firstValueFrom } from "rxjs";
import Stripe from "stripe";
import { ORDER_PATTERNS } from "@app/common";
import { PrismaService } from "@app/database";
import {
  ConfirmPaymentDto,
  CreateSetupIntentDto,
  CreatePaymentIntentDto,
  PaymentMethodsQueryDto,
  RefundPaymentDto,
  SavePaymentMethodDto,
  UpdatePaymentMethodDto,
} from "@app/dto";

@Injectable()
export class StripePaymentService {
  private readonly logger = new Logger(StripePaymentService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject("ORDER_SERVICE")
    private readonly orderClient: ClientProxy,
  ) {
    this.stripe = new Stripe(
      this.configService.getOrThrow<string>("STRIPE_SECRET_KEY"),
      {
        apiVersion: "2025-10-29.clover",
      },
    );
  }

  async createPaymentIntent(payload: CreatePaymentIntentDto) {
    try {
      const currency = payload.currency?.toLowerCase() ?? "gbp";
      const savedPaymentMethod = payload.savedPaymentMethodId
        ? await this.getActivePaymentMethod(payload.savedPaymentMethodId)
        : null;
      const checkoutSessionId =
        payload.checkoutSessionId ?? payload.idempotencyKey ?? payload.orderId;
      const effectiveCustomerId =
        payload.customerId ?? savedPaymentMethod?.customerId;
      const order = await this.createPendingOrder(
        {
          ...payload,
          checkoutSessionId,
          customerId: effectiveCustomerId,
        },
        currency,
      );
      const stripeCustomerId =
        savedPaymentMethod?.stripeCustomerId ??
        (await this.ensureStripeCustomer(order.customerId, payload.customer));
      const metadata: Record<string, string> = {
        ...(payload.metadata ?? {}),
        ...(checkoutSessionId ? { checkoutSessionId } : {}),
        orderId: order.id,
        orderNumber: order.orderNumber,
        source: payload.metadata?.source ?? "foodmenu-mobile",
      };
      if (savedPaymentMethod?.id) {
        metadata.savedPaymentMethodId = savedPaymentMethod.id;
      }
      if (payload.paymentMethodId) {
        metadata.paymentMethodId = payload.paymentMethodId;
      }
      const paymentIntent = await this.stripe.paymentIntents.create(
        {
          amount: payload.amount,
          automatic_payment_methods: {
            enabled: true,
          },
          currency,
          customer: stripeCustomerId,
          metadata,
        },
        checkoutSessionId
          ? { idempotencyKey: `payment-intent:${checkoutSessionId}` }
          : undefined,
      );
      const ephemeralKey = await this.createCustomerEphemeralKey(
        stripeCustomerId,
      );

      await this.prisma.paymentTransaction.upsert({
        create: {
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          customerId: order.customerId,
          metadata: metadata as Prisma.InputJsonValue,
          orderId: order.id,
          paymentIntentId: paymentIntent.id,
          status: this.mapPaymentIntentStatus(paymentIntent.status),
        },
        update: {
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          metadata: metadata as Prisma.InputJsonValue,
          status: this.mapPaymentIntentStatus(paymentIntent.status),
        },
        where: {
          paymentIntentId: paymentIntent.id,
        },
      });

      await this.updateOrderPaymentStatus(
        paymentIntent.id,
        this.mapPaymentIntentStatus(paymentIntent.status),
        order.id,
      );

      this.logger.log(`Created Stripe payment intent ${paymentIntent.id}`);

      const response = {
        clientSecret: paymentIntent.client_secret ?? "",
        customerEphemeralKeySecret: ephemeralKey.secret ?? "",
        customerId: stripeCustomerId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      };
      const responseCheckoutSessionId =
        order.checkoutSessionId ?? checkoutSessionId;
      return responseCheckoutSessionId
        ? { ...response, checkoutSessionId: responseCheckoutSessionId }
        : response;
    } catch (error) {
      throw this.toRpcException(error, "PAYMENT_INTENT_FAILED");
    }
  }

  async createSetupIntent(payload: CreateSetupIntentDto) {
    try {
      const stripeCustomerId = await this.ensureStripeCustomer(
        payload.customerId,
      );
      const setupIntent = await this.stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        usage: "off_session",
      });

      return {
        clientSecret: setupIntent.client_secret ?? "",
        customerId: payload.customerId,
        setupIntentId: setupIntent.id,
      };
    } catch (error) {
      throw this.toRpcException(error, "SETUP_INTENT_FAILED");
    }
  }

  async listPaymentMethods(payload: PaymentMethodsQueryDto) {
    const paymentMethods = await this.prisma.customerPaymentMethod.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      where: {
        customerId: payload.customerId,
        deletedAt: null,
      },
    });

    return paymentMethods.map((paymentMethod) =>
      this.mapCustomerPaymentMethod(paymentMethod),
    );
  }

  async savePaymentMethod(payload: SavePaymentMethodDto) {
    try {
      const stripeCustomerId = await this.ensureStripeCustomer(
        payload.customerId,
      );
      let paymentMethod = await this.stripe.paymentMethods.retrieve(
        payload.paymentMethodId,
      );

      if (!paymentMethod.customer) {
        paymentMethod = await this.stripe.paymentMethods.attach(
          payload.paymentMethodId,
          {
            customer: stripeCustomerId,
          },
        );
      }

      if (paymentMethod.customer && paymentMethod.customer !== stripeCustomerId) {
        throw new Error("Payment method belongs to a different Stripe customer.");
      }

      if (!paymentMethod.card) {
        throw new Error("Only card payment methods can be saved.");
      }

      if (payload.isDefault) {
        await this.clearDefaultPaymentMethods(payload.customerId);
      }

      const savedPaymentMethod =
        await this.prisma.customerPaymentMethod.upsert({
          create: {
            alias: payload.alias,
            brand: paymentMethod.card.brand,
            customerId: payload.customerId,
            expMonth: paymentMethod.card.exp_month,
            expYear: paymentMethod.card.exp_year,
            holderName: payload.holderName,
            isDefault: payload.isDefault ?? false,
            last4: paymentMethod.card.last4,
            stripeCustomerId,
            stripePaymentMethodId: paymentMethod.id,
          },
          update: {
            alias: payload.alias,
            brand: paymentMethod.card.brand,
            deletedAt: null,
            expMonth: paymentMethod.card.exp_month,
            expYear: paymentMethod.card.exp_year,
            holderName: payload.holderName,
            isDefault: payload.isDefault ?? false,
            last4: paymentMethod.card.last4,
            stripeCustomerId,
          },
          where: {
            stripePaymentMethodId: paymentMethod.id,
          },
        });

      return this.mapCustomerPaymentMethod(savedPaymentMethod);
    } catch (error) {
      throw this.toRpcException(error, "SAVE_PAYMENT_METHOD_FAILED");
    }
  }

  async updatePaymentMethod(
    payload: UpdatePaymentMethodDto & { paymentMethodId: string },
  ) {
    try {
      const paymentMethod = await this.getActivePaymentMethod(
        payload.paymentMethodId,
      );

      if (payload.isDefault) {
        await this.clearDefaultPaymentMethods(paymentMethod.customerId);
      }

      const updatedPaymentMethod =
        await this.prisma.customerPaymentMethod.update({
          data: {
            ...(payload.alias !== undefined ? { alias: payload.alias } : {}),
            ...(payload.holderName !== undefined
              ? { holderName: payload.holderName }
              : {}),
            ...(payload.isDefault !== undefined
              ? { isDefault: payload.isDefault }
              : {}),
          },
          where: { id: paymentMethod.id },
        });

      return this.mapCustomerPaymentMethod(updatedPaymentMethod);
    } catch (error) {
      throw this.toRpcException(error, "UPDATE_PAYMENT_METHOD_FAILED");
    }
  }

  async deletePaymentMethod(paymentMethodId: string) {
    try {
      const paymentMethod = await this.getActivePaymentMethod(paymentMethodId);

      await this.stripe.paymentMethods.detach(
        paymentMethod.stripePaymentMethodId,
      );
      await this.prisma.customerPaymentMethod.update({
        data: {
          deletedAt: new Date(),
          isDefault: false,
        },
        where: { id: paymentMethod.id },
      });

      return {
        deleted: true,
        id: paymentMethod.id,
        stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
      };
    } catch (error) {
      throw this.toRpcException(error, "DELETE_PAYMENT_METHOD_FAILED");
    }
  }

  async confirmPayment(payload: ConfirmPaymentDto) {
    try {
      const paymentIntent = payload.paymentMethodId
        ? await this.stripe.paymentIntents.confirm(payload.paymentIntentId, {
            payment_method: payload.paymentMethodId,
          })
        : await this.stripe.paymentIntents.retrieve(payload.paymentIntentId);

      await this.syncPaymentIntent(paymentIntent);

      return {
        order: await this.getOrderSummaryForPaymentIntent(paymentIntent.id),
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      };
    } catch (error) {
      throw this.toRpcException(error, "PAYMENT_CONFIRM_FAILED");
    }
  }

  async getPaymentStatus(paymentIntentId: string) {
    try {
      const paymentIntent =
        await this.stripe.paymentIntents.retrieve(paymentIntentId);
      await this.syncPaymentIntent(paymentIntent);

      return {
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        order: await this.getOrderSummaryForPaymentIntent(paymentIntent.id),
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      };
    } catch (error) {
      throw this.toRpcException(error, "PAYMENT_STATUS_FAILED");
    }
  }

  async refundPayment(payload: RefundPaymentDto) {
    try {
      const refund = await this.stripe.refunds.create({
        amount: payload.amount,
        payment_intent: payload.paymentIntentId,
        reason: this.mapRefundReason(payload.reason),
      });
      const status = this.mapRefundStatus(refund.status);

      await this.prisma.paymentRefund.upsert({
        create: {
          amount: refund.amount ?? payload.amount,
          paymentIntentId: payload.paymentIntentId,
          reason: payload.reason,
          refundId: refund.id,
          status,
        },
        update: {
          amount: refund.amount ?? payload.amount,
          reason: payload.reason,
          status,
        },
        where: {
          refundId: refund.id,
        },
      });

      await this.prisma.paymentTransaction.update({
        data: {
          status:
            status === PaymentStatus.SUCCEEDED
              ? PaymentStatus.REFUNDED
              : status,
        },
        where: {
          paymentIntentId: payload.paymentIntentId,
        },
      });

      await this.updateOrderPaymentStatus(
        payload.paymentIntentId,
        status === PaymentStatus.SUCCEEDED
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED,
      );

      this.logger.log(`Created Stripe refund ${refund.id}`);

      return {
        refundId: refund.id,
        status: refund.status ?? "processing",
      };
    } catch (error) {
      throw this.toRpcException(error, "PAYMENT_REFUND_FAILED");
    }
  }

  async handleStripeWebhook(payload: {
    rawBody: string;
    stripeSignature?: string;
  }) {
    try {
      const webhookSecret = this.configService.get<string>(
        "STRIPE_WEBHOOK_SECRET",
      );
      const event =
        webhookSecret && payload.stripeSignature
          ? this.stripe.webhooks.constructEvent(
              payload.rawBody,
              payload.stripeSignature,
              webhookSecret,
            )
          : (JSON.parse(payload.rawBody) as Stripe.Event);

      if (
        event.type === "payment_intent.succeeded" ||
        event.type === "payment_intent.payment_failed" ||
        event.type === "payment_intent.canceled" ||
        event.type === "payment_intent.processing"
      ) {
        await this.syncPaymentIntent(event.data.object as Stripe.PaymentIntent);
      }

      this.logger.log(`Handled Stripe webhook ${event.type}`);

      return { received: true };
    } catch (error) {
      throw this.toRpcException(error, "STRIPE_WEBHOOK_FAILED");
    }
  }

  private async syncPaymentIntent(paymentIntent: Stripe.PaymentIntent) {
    const paymentStatus = this.mapPaymentIntentStatus(paymentIntent.status);
    const orderId = paymentIntent.metadata?.orderId;

    await this.prisma.paymentTransaction.upsert({
      create: {
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        metadata: paymentIntent.metadata as Prisma.InputJsonValue,
        orderId,
        paymentIntentId: paymentIntent.id,
        status: paymentStatus,
      },
      update: {
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        metadata: paymentIntent.metadata as Prisma.InputJsonValue,
        orderId,
        status: paymentStatus,
      },
      where: {
        paymentIntentId: paymentIntent.id,
      },
    });

    await this.syncOrderStatus(paymentIntent.id, paymentStatus, orderId);
  }

  private async createPendingOrder(
    payload: CreatePaymentIntentDto,
    currency: string,
  ) {
    return firstValueFrom(
      this.orderClient.send(ORDER_PATTERNS.CREATE_PENDING_ORDER, {
        amount: payload.amount,
        customer: payload.customer,
        customerId: payload.customerId,
        metadata: payload.metadata,
        order: payload.order,
        orderId: payload.orderId,
        currency,
      }),
    );
  }

  private async syncOrderStatus(
    paymentIntentId: string,
    paymentStatus: PaymentStatus,
    orderId?: string,
  ) {
    await this.updateOrderPaymentStatus(paymentIntentId, paymentStatus, orderId);
  }

  private async updateOrderPaymentStatus(
    paymentIntentId: string,
    status: PaymentStatus,
    orderId?: string,
  ) {
    return firstValueFrom(
      this.orderClient.send(ORDER_PATTERNS.UPDATE_PAYMENT_STATUS, {
        orderId,
        paymentIntentId,
        status,
      }),
    );
  }

  private async getOrderSummaryForPaymentIntent(paymentIntentId: string) {
    return firstValueFrom(
      this.orderClient.send(ORDER_PATTERNS.UPDATE_PAYMENT_STATUS, {
        paymentIntentId,
        status: "SYNC_ONLY",
      }),
    );
  }

  private async createCustomerEphemeralKey(stripeCustomerId: string) {
    return this.stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: "2024-06-20" },
    );
  }

  private async ensureStripeCustomer(
    customerId: string,
    customer?: CreatePaymentIntentDto["customer"],
  ) {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (existingCustomer?.stripeCustomerId) {
      return existingCustomer.stripeCustomerId;
    }

    const stripeCustomer = await this.stripe.customers.create({
      email: customer?.email ?? existingCustomer?.email ?? undefined,
      metadata: {
        foodMenuCustomerId: customerId,
      },
      name:
        [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
        [existingCustomer?.firstName, existingCustomer?.lastName]
          .filter(Boolean)
          .join(" ") ||
        undefined,
      phone: customer?.phone ?? existingCustomer?.phone ?? undefined,
    });

    await this.prisma.customer.upsert({
      create: {
        email: customer?.email,
        firstName: customer?.firstName,
        id: customerId,
        lastName: customer?.lastName,
        phone: customer?.phone,
        stripeCustomerId: stripeCustomer.id,
      },
      update: {
        ...(customer?.email ? { email: customer.email } : {}),
        ...(customer?.firstName ? { firstName: customer.firstName } : {}),
        ...(customer?.lastName ? { lastName: customer.lastName } : {}),
        ...(customer?.phone ? { phone: customer.phone } : {}),
        stripeCustomerId: stripeCustomer.id,
      },
      where: { id: customerId },
    });

    return stripeCustomer.id;
  }

  private async clearDefaultPaymentMethods(customerId: string) {
    await this.prisma.customerPaymentMethod.updateMany({
      data: { isDefault: false },
      where: {
        customerId,
        deletedAt: null,
      },
    });
  }

  private async getActivePaymentMethod(paymentMethodId: string) {
    const paymentMethod = await this.prisma.customerPaymentMethod.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: paymentMethodId }, { stripePaymentMethodId: paymentMethodId }],
      },
    });

    if (!paymentMethod) {
      throw new Error("Saved payment method could not be found.");
    }

    return paymentMethod;
  }

  private mapCustomerPaymentMethod(
    paymentMethod: Prisma.CustomerPaymentMethodGetPayload<object>,
  ) {
    return {
      alias: paymentMethod.alias,
      brand: paymentMethod.brand,
      customerId: paymentMethod.customerId,
      expMonth: paymentMethod.expMonth,
      expYear: paymentMethod.expYear,
      holderName: paymentMethod.holderName,
      id: paymentMethod.id,
      isDefault: paymentMethod.isDefault,
      last4: paymentMethod.last4,
      stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
    };
  }

  private mapPaymentIntentStatus(status: Stripe.PaymentIntent.Status) {
    const normalizedStatus = status.toUpperCase().replace(/-/g, "_");
    return normalizedStatus in PaymentStatus
      ? (normalizedStatus as PaymentStatus)
      : PaymentStatus.FAILED;
  }

  private mapRefundStatus(status: Stripe.Refund["status"] | null) {
    if (status === "succeeded") return PaymentStatus.SUCCEEDED;
    if (status === "failed") return PaymentStatus.FAILED;
    if (status === "canceled") return PaymentStatus.CANCELED;
    return PaymentStatus.PROCESSING;
  }

  private mapRefundReason(reason?: string) {
    const allowedReasons = [
      "duplicate",
      "fraudulent",
      "requested_by_customer",
    ] as const;
    return allowedReasons.includes(reason as (typeof allowedReasons)[number])
      ? (reason as Stripe.RefundCreateParams.Reason)
      : undefined;
  }

  private toRpcException(error: unknown, code: string) {
    const message =
      error instanceof Stripe.errors.StripeError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Payment request failed";

    this.logger.error(`${code}: ${message}`);

    return new RpcException({
      code,
      message,
    });
  }
}
