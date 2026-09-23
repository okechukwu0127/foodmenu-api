import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RpcException } from "@nestjs/microservices";
import { PaymentStatus, Prisma } from "@prisma/client";
import Stripe from "stripe";
import { PrismaService } from "@app/database";
import {
  ConfirmPaymentDto,
  CreatePaymentIntentDto,
  RefundPaymentDto,
} from "@app/dto";

@Injectable()
export class StripePaymentService {
  private readonly logger = new Logger(StripePaymentService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
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
      const metadata = {
        ...(payload.metadata ?? {}),
        ...(payload.orderId ? { orderId: payload.orderId } : {}),
        source: payload.metadata?.source ?? "foodmenu-mobile",
      };
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: payload.amount,
        currency,
        customer: payload.customerId,
        metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      });

      await this.prisma.paymentTransaction.upsert({
        create: {
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          customerId: payload.customerId,
          metadata: metadata as Prisma.InputJsonValue,
          orderId: payload.orderId,
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

      this.logger.log(`Created Stripe payment intent ${paymentIntent.id}`);

      return {
        clientSecret: paymentIntent.client_secret ?? "",
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      };
    } catch (error) {
      throw this.toRpcException(error, "PAYMENT_INTENT_FAILED");
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
    await this.prisma.paymentTransaction.upsert({
      create: {
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        metadata: paymentIntent.metadata as Prisma.InputJsonValue,
        orderId: paymentIntent.metadata?.orderId,
        paymentIntentId: paymentIntent.id,
        status: this.mapPaymentIntentStatus(paymentIntent.status),
      },
      update: {
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: this.mapPaymentIntentStatus(paymentIntent.status),
      },
      where: {
        paymentIntentId: paymentIntent.id,
      },
    });
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
