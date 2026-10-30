import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RpcException } from "@nestjs/microservices";
import { FulfilmentStatus, OrderStatus, Prisma } from "@prisma/client";
import { PrismaService } from "@app/database";
import {
  CreateOrderFulfilmentPayload,
  CreatePendingOrderDto,
  OrdersQueryDto,
  StuartWebhookPayload,
  UpdateOrderFulfilmentPayload,
  UpdateOrderPaymentStatusDto,
} from "@app/dto";
import { StuartFulfilmentService } from "../fulfilment/stuart-fulfilment.service";
import { GoogleRoutesService, LatLng } from "../tracking/google-routes.service";

const ORDER_STATUS_GROUPS = {
  active: [
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.PAID,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.COURIER_ASSIGNED,
    OrderStatus.OUT_FOR_DELIVERY,
  ],
  cancelled: [
    OrderStatus.CANCELED,
    OrderStatus.PAYMENT_FAILED,
    OrderStatus.REFUNDED,
    OrderStatus.PARTIALLY_REFUNDED,
  ],
  completed: [OrderStatus.DELIVERED, OrderStatus.COMPLETED],
} as const;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly googleRoutesService: GoogleRoutesService,
    private readonly prisma: PrismaService,
    private readonly stuartFulfilmentService: StuartFulfilmentService,
  ) {}

  async createPendingOrder(payload: CreatePendingOrderDto) {
    const customerId = payload.customerId ?? payload.customer?.id;
    if (!customerId) {
      throw new RpcException({
        code: "CUSTOMER_REQUIRED",
        message: "An authenticated customer is required.",
      });
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new RpcException({
        code: "CUSTOMER_NOT_FOUND",
        message: "Customer profile was not found.",
      });
    }
    const customerContact = {
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: payload.customer?.phone ?? customer.phone,
    };

    const orderId = payload.order?.id ?? payload.orderId;
    const checkoutSessionId =
      payload.checkoutSessionId ?? payload.idempotencyKey ?? orderId;
    const existingOrder = await this.findExistingCheckoutOrder(
      orderId,
      checkoutSessionId,
    );
    if (existingOrder && existingOrder.customerId !== customerId) {
      throw new RpcException({
        code: "ORDER_NOT_FOUND",
        message: "Order not found.",
      });
    }
    const orderNumber = existingOrder?.orderNumber ?? this.createOrderNumber();
    const orderData = {
      amount: payload.amount,
      checkoutSessionId,
      currency: payload.currency,
      customerId: customer.id,
      deliveryAddress: payload.order?.deliveryAddress as
        Prisma.InputJsonValue | undefined,
      deliveryFee: payload.order?.deliveryFee,
      discountAmount: payload.order?.discountAmount,
      metadata: {
        ...(payload.order?.metadata ?? {}),
        ...(payload.metadata ?? {}),
        customerContact,
      } as Prisma.InputJsonValue,
      notes: payload.order?.notes,
      status: OrderStatus.PENDING_PAYMENT,
      subtotal: payload.order?.subtotal,
      taxAmount: payload.order?.taxAmount,
    };

    const order = existingOrder
      ? await this.updateExistingCheckoutOrder(existingOrder, orderData)
      : await this.prisma.order.create({
          data: {
            ...orderData,
            ...(orderId ? { id: orderId } : {}),
            orderNumber,
          },
        });

    if (order.status === OrderStatus.PENDING_PAYMENT) {
      await this.replaceOrderItems(order.id, payload);
    }

    this.logger.log(`Prepared pending order ${order.orderNumber}`);

    return order;
  }

  async updatePaymentStatus(payload: UpdateOrderPaymentStatusDto) {
    if (payload.status === "SYNC_ONLY") {
      return this.getOrderSummaryByPaymentIntent(payload.paymentIntentId);
    }

    const orderStatus = this.mapOrderStatus(payload.status);
    const data = {
      paymentIntentId: payload.paymentIntentId,
      ...(orderStatus ? { status: orderStatus } : {}),
    };

    const eligibleStatus =
      orderStatus === OrderStatus.PAID || orderStatus === OrderStatus.CANCELED
        ? {
            status: {
              in: [OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_FAILED],
            },
          }
        : {};
    if (payload.orderId) {
      await this.prisma.order.updateMany({
        data,
        where: { id: payload.orderId, ...eligibleStatus },
      });
    } else {
      await this.prisma.order.updateMany({
        data,
        where: { paymentIntentId: payload.paymentIntentId, ...eligibleStatus },
      });
    }

    const orderSummary = await this.getOrderSummaryByPaymentIntent(
      payload.paymentIntentId,
    );

    if (orderStatus === OrderStatus.PAID && orderSummary) {
      await this.ensureDefaultFulfilmentForPaidOrder(
        orderSummary.id,
        payload.paymentIntentId,
      );
    }

    return orderSummary;
  }

  listFulfilmentProviders() {
    return this.prisma.fulfilmentProvider.findMany({
      orderBy: { name: "asc" },
      where: { isActive: true },
    });
  }

  async createOrderFulfilment(payload: CreateOrderFulfilmentPayload) {
    const order = await this.findOrderByIdOrNumber(payload.orderId);
    const provider = await this.prisma.fulfilmentProvider.findFirst({
      where: {
        code: payload.providerCode,
        isActive: true,
      },
    });

    if (!provider) {
      throw new RpcException({
        code: "FULFILMENT_PROVIDER_NOT_FOUND",
        message: "Fulfilment provider could not be found.",
      });
    }

    const fulfilment = await this.prisma.orderFulfilment.create({
      data: {
        clientTrackingUrl: payload.clientTrackingUrl,
        courierLatitude: payload.courierLatitude,
        courierLongitude: payload.courierLongitude,
        courierName: payload.courierName,
        courierPhone: payload.courierPhone,
        deliveredAt: this.toDate(payload.deliveredAt),
        estimatedDropoffAt: this.toDate(payload.estimatedDropoffAt),
        estimatedPickupAt: this.toDate(payload.estimatedPickupAt),
        failedReason: payload.failedReason,
        fulfilmentProviderId: provider.id,
        metadata: payload.metadata as Prisma.InputJsonValue | undefined,
        orderId: order.id,
        pickedUpAt: this.toDate(payload.pickedUpAt),
        providerDeliveryId: payload.providerDeliveryId,
        providerJobId: payload.providerJobId,
        rawProviderPayload: payload.rawProviderPayload as
          Prisma.InputJsonValue | undefined,
        status: this.normalizeFulfilmentStatus(payload.status),
        trackingUrl: payload.trackingUrl,
      },
      include: { provider: true },
    });

    await this.syncOrderStatusFromFulfilment(order.id, fulfilment.status);

    return this.mapFulfilmentForApp(order, fulfilment);
  }

  async getOrderTracking(orderId: string) {
    const order = await this.findOrderByIdOrNumber(orderId);
    const fulfilment = await this.prisma.orderFulfilment.findFirst({
      include: { provider: true },
      orderBy: { createdAt: "desc" },
      where: { orderId: order.id },
    });

    if (!fulfilment) {
      const pickup = this.getPickupForApp();
      const dropoff = this.getDropoffForApp(order.deliveryAddress);
      const route = await this.getTrackingRoute({
        courierLocation: null,
        customerLocation: dropoff.location,
        deliveryStatus: FulfilmentStatus.NOT_REQUESTED,
        orderId: order.id,
        restaurantLocation: pickup.location,
      });
      return {
        deliveryStatus: FulfilmentStatus.NOT_REQUESTED,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        provider: null,
        status: FulfilmentStatus.NOT_REQUESTED,
        statusLabel: "Not Requested",
        trackingUrl: null,
        clientTrackingUrl: null,
        courier: null,
        customerLocation: dropoff.location,
        dropoff,
        pickup,
        location: null,
        route,
        eta: {
          dropoff: null,
          pickup: null,
        },
        etaLabel: this.getEtaLabel(FulfilmentStatus.NOT_REQUESTED),
      };
    }

    const response = this.mapFulfilmentForApp(order, fulfilment);
    return {
      ...response,
      route: await this.getTrackingRoute({
        courierLocation: response.location,
        customerLocation: response.dropoff.location,
        deliveryStatus: fulfilment.status,
        orderId: order.id,
        restaurantLocation: response.pickup.location,
      }),
    };
  }

  async handleStuartWebhook(payload: StuartWebhookPayload) {
    const event = this.parseStuartWebhook(payload);
    if (!event.orderReference && !event.providerDeliveryId) {
      throw new RpcException({
        code: "STUART_WEBHOOK_REFERENCE_MISSING",
        message:
          "Stuart webhook did not include clientReference, package reference, or delivery id.",
      });
    }

    const order = event.orderReference
      ? await this.findOrderByIdOrNumber(event.orderReference)
      : await this.findOrderByProviderDeliveryId(event.providerDeliveryId);

    const provider = await this.getActiveFulfilmentProvider("STUART");
    const existingFulfilment = await this.prisma.orderFulfilment.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        OR: [
          { orderId: order.id },
          ...(event.providerDeliveryId
            ? [{ providerDeliveryId: event.providerDeliveryId }]
            : []),
        ],
      },
    });

    const data = {
      clientTrackingUrl: event.clientTrackingUrl,
      courierLatitude: event.courierLatitude,
      courierLongitude: event.courierLongitude,
      courierName: event.courierName,
      courierPhone: event.courierPhone,
      deliveredAt: event.deliveredAt,
      estimatedDropoffAt: event.estimatedDropoffAt,
      estimatedPickupAt: event.estimatedPickupAt,
      failedReason: event.failedReason,
      fulfilmentProviderId: provider.id,
      orderId: order.id,
      providerDeliveryId: event.providerDeliveryId,
      providerJobId: event.providerJobId,
      rawProviderPayload: payload as Prisma.InputJsonValue,
      status: event.status,
      trackingUrl: event.trackingUrl,
    };

    const fulfilment = existingFulfilment
      ? await this.prisma.orderFulfilment.update({
          data,
          include: { provider: true },
          where: { id: existingFulfilment.id },
        })
      : await this.prisma.orderFulfilment.create({
          data,
          include: { provider: true },
        });

    await this.syncOrderStatusFromFulfilment(order.id, fulfilment.status);

    return {
      received: true,
      fulfilment: this.mapFulfilmentForApp(order, fulfilment),
    };
  }

  async updateOrderFulfilment(payload: UpdateOrderFulfilmentPayload) {
    const order = await this.findOrderByIdOrNumber(payload.orderId);
    const existingFulfilment = await this.prisma.orderFulfilment.findFirst({
      where: {
        id: payload.fulfilmentId,
        orderId: order.id,
      },
    });

    if (!existingFulfilment) {
      throw new RpcException({
        code: "FULFILMENT_NOT_FOUND",
        message: "Fulfilment record could not be found.",
      });
    }

    const fulfilment = await this.prisma.orderFulfilment.update({
      data: {
        clientTrackingUrl: payload.clientTrackingUrl,
        courierLatitude: payload.courierLatitude,
        courierLongitude: payload.courierLongitude,
        courierName: payload.courierName,
        courierPhone: payload.courierPhone,
        deliveredAt: this.toDate(payload.deliveredAt),
        estimatedDropoffAt: this.toDate(payload.estimatedDropoffAt),
        failedReason: payload.failedReason,
        pickedUpAt: this.toDate(payload.pickedUpAt),
        providerDeliveryId: payload.providerDeliveryId,
        rawProviderPayload: payload.rawProviderPayload as
          Prisma.InputJsonValue | undefined,
        ...(payload.status
          ? { status: this.normalizeFulfilmentStatus(payload.status) }
          : {}),
      },
      include: { provider: true },
      where: { id: existingFulfilment.id },
    });

    await this.syncOrderStatusFromFulfilment(order.id, fulfilment.status);

    return this.mapFulfilmentForApp(order, fulfilment);
  }

  async getCustomerOrders(query: OrdersQueryDto) {
    const take = query.limit ?? 20;
    const where: Prisma.OrderWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.statusGroup
        ? { status: { in: [...ORDER_STATUS_GROUPS[query.statusGroup]] } }
        : {}),
    };

    const orders = await this.prisma.order.findMany({
      include: {
        fulfilments: {
          include: { provider: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
      where,
    });
    const mappedOrders = orders.map((order) => this.mapOrderForApp(order));

    if (query.statusGroup) {
      return {
        items: mappedOrders,
        statusGroup: query.statusGroup,
      };
    }

    return {
      active: mappedOrders.filter((order) => order.statusGroup === "active"),
      cancelled: mappedOrders.filter(
        (order) => order.statusGroup === "cancelled",
      ),
      completed: mappedOrders.filter(
        (order) => order.statusGroup === "completed",
      ),
      counts: {
        active: mappedOrders.filter((order) => order.statusGroup === "active")
          .length,
        cancelled: mappedOrders.filter(
          (order) => order.statusGroup === "cancelled",
        ).length,
        completed: mappedOrders.filter(
          (order) => order.statusGroup === "completed",
        ).length,
      },
    };
  }

  async getOrderDetails(orderId: string) {
    const order = await this.prisma.order.findFirst({
      include: {
        fulfilments: {
          include: { provider: true },
          orderBy: { createdAt: "desc" },
        },
        customer: true,
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
    });

    if (!order) {
      throw new RpcException({
        code: "ORDER_NOT_FOUND",
        message: "Order could not be found.",
      });
    }

    return this.mapOrderForApp(order);
  }

  async getOrderSummaryByPaymentIntent(paymentIntentId: string) {
    const order = await this.prisma.order.findUnique({
      select: {
        amount: true,
        currency: true,
        id: true,
        orderNumber: true,
        status: true,
      },
      where: { paymentIntentId },
    });

    return order ?? null;
  }

  private async replaceOrderItems(
    orderId: string,
    payload: CreatePendingOrderDto,
  ) {
    await this.prisma.orderItem.deleteMany({ where: { orderId } });

    const items = payload.order?.items ?? [];
    if (items.length > 0) {
      await this.prisma.orderItem.createMany({
        data: items.map((item) => ({
          categoryId: item.categoryId,
          currency: payload.currency,
          description: item.description,
          foodItemId: item.foodItemId,
          imageUrl: item.imageUrl,
          itemSnapshot: item.itemSnapshot as Prisma.InputJsonValue | undefined,
          metadata: item.metadata as Prisma.InputJsonValue | undefined,
          modifiers: item.modifiers as Prisma.InputJsonValue | undefined,
          name: item.name,
          orderId,
          quantity: item.quantity,
          totalAmount: item.unitAmount * item.quantity,
          unitAmount: item.unitAmount,
        })),
      });
      return;
    }

    await this.prisma.orderItem.create({
      data: {
        currency: payload.currency,
        name: "FoodMenu checkout order",
        orderId,
        quantity: 1,
        totalAmount: payload.amount,
        unitAmount: payload.amount,
      },
    });
  }

  private async findExistingCheckoutOrder(
    orderId?: string,
    checkoutSessionId?: string,
  ) {
    if (!orderId && !checkoutSessionId) return null;

    return this.prisma.order.findFirst({
      where: {
        OR: [
          ...(orderId ? [{ id: orderId }] : []),
          ...(checkoutSessionId ? [{ checkoutSessionId }] : []),
        ],
      },
    });
  }

  private async updateExistingCheckoutOrder(
    existingOrder: Awaited<ReturnType<typeof this.findExistingCheckoutOrder>>,
    orderData: {
      amount: number;
      checkoutSessionId?: string;
      currency: string;
      customerId: string;
      deliveryAddress?: Prisma.InputJsonValue;
      deliveryFee?: number;
      discountAmount?: number;
      metadata?: Prisma.InputJsonValue;
      notes?: string;
      subtotal?: number;
      taxAmount?: number;
    },
  ) {
    if (!existingOrder) {
      throw new Error("Existing order is required.");
    }

    if (existingOrder.status !== OrderStatus.PENDING_PAYMENT) {
      return existingOrder;
    }

    return this.prisma.order.update({
      data: {
        amount: orderData.amount,
        checkoutSessionId: orderData.checkoutSessionId,
        currency: orderData.currency,
        customerId: orderData.customerId,
        deliveryAddress: orderData.deliveryAddress,
        deliveryFee: orderData.deliveryFee,
        discountAmount: orderData.discountAmount,
        metadata: orderData.metadata,
        notes: orderData.notes,
        subtotal: orderData.subtotal,
        taxAmount: orderData.taxAmount,
      },
      where: { id: existingOrder.id },
    });
  }

  private mapOrderStatus(paymentStatus: string) {
    if (paymentStatus === "SUCCEEDED") return OrderStatus.PAID;
    if (paymentStatus === "FAILED") return OrderStatus.PAYMENT_FAILED;
    if (paymentStatus === "CANCELED") return OrderStatus.CANCELED;
    if (paymentStatus === "REFUNDED") return OrderStatus.REFUNDED;
    if (paymentStatus === "PARTIALLY_REFUNDED") {
      return OrderStatus.PARTIALLY_REFUNDED;
    }
    return undefined;
  }

  private async ensureDefaultFulfilmentForPaidOrder(
    orderId: string,
    paymentIntentId: string,
  ) {
    const paidOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (
      (paidOrder?.metadata as Record<string, unknown> | null)?.fulfilment ===
      "pickup"
    )
      return null;
    const existingFulfilment = await this.prisma.orderFulfilment.findFirst({
      include: { provider: true },
      where: { orderId },
    });

    if (existingFulfilment) return existingFulfilment;

    const provider = await this.getActiveFulfilmentProvider("STUART");
    const fulfilment = await this.prisma.orderFulfilment.create({
      data: {
        fulfilmentProviderId: provider.id,
        metadata: {
          paymentIntentId,
          source: "payment_success",
          stuartDispatchStatus: this.stuartFulfilmentService.isConfigured()
            ? "dispatching"
            : "configuration_missing",
        },
        orderId,
        status: FulfilmentStatus.CREATED,
      },
      include: { provider: true },
    });

    if (!this.stuartFulfilmentService.isConfigured()) {
      this.logger.warn(
        `Created local fulfilment ${fulfilment.id}; Stuart dispatch is not configured.`,
      );
      return fulfilment;
    }

    try {
      return await this.dispatchFulfilmentToStuart(orderId, fulfilment.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Dispatch failed";
      this.logger.error(
        `Stuart dispatch failed for order ${orderId}: ${message}`,
      );

      return this.prisma.orderFulfilment.update({
        data: {
          failedReason: message,
          metadata: {
            paymentIntentId,
            source: "payment_success",
            stuartDispatchStatus: "failed",
          },
          status: FulfilmentStatus.FAILED,
        },
        include: { provider: true },
        where: { id: fulfilment.id },
      });
    }
  }

  private async dispatchFulfilmentToStuart(
    orderId: string,
    fulfilmentId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      include: {
        customer: true,
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
      where: { id: orderId },
    });

    if (!order) {
      throw new Error("Order could not be found for Stuart dispatch.");
    }

    // Delivery uses checkout contact details even if the profile changes later.
    const metadata = this.asRecord(order.metadata);
    const contact = metadata?.customerContact;
    const snapshot =
      contact && typeof contact === "object" && !Array.isArray(contact)
        ? (contact as Record<string, unknown>)
        : null;
    const dispatch = await this.stuartFulfilmentService.createDelivery({
      ...order,
      customer: snapshot
        ? {
            ...order.customer,
            email: typeof snapshot.email === "string" ? snapshot.email : null,
            firstName:
              typeof snapshot.firstName === "string"
                ? snapshot.firstName
                : null,
            lastName:
              typeof snapshot.lastName === "string" ? snapshot.lastName : null,
            phone: typeof snapshot.phone === "string" ? snapshot.phone : null,
          }
        : order.customer,
    });
    const status = this.mapStuartStatus(dispatch.status);
    const fulfilment = await this.prisma.orderFulfilment.update({
      data: {
        clientTrackingUrl: dispatch.clientTrackingUrl,
        estimatedDropoffAt: dispatch.estimatedDropoffAt,
        estimatedPickupAt: dispatch.estimatedPickupAt,
        metadata: {
          source: "payment_success",
          stuartDispatchStatus: "created",
          stuartRequestPayload: dispatch.requestPayload,
        },
        providerDeliveryId: dispatch.deliveryId,
        providerJobId: dispatch.jobId,
        rawProviderPayload: dispatch.raw as Prisma.InputJsonValue,
        status,
        trackingUrl: dispatch.trackingUrl,
      },
      include: { provider: true },
      where: { id: fulfilmentId },
    });

    await this.syncOrderStatusFromFulfilment(order.id, fulfilment.status);

    return fulfilment;
  }

  private async getActiveFulfilmentProvider(code: string) {
    const provider = await this.prisma.fulfilmentProvider.findFirst({
      where: { code, isActive: true },
    });

    if (provider) return provider;

    const fallbackProvider = await this.prisma.fulfilmentProvider.findFirst({
      orderBy: { name: "asc" },
      where: { isActive: true },
    });

    if (!fallbackProvider) {
      throw new RpcException({
        code: "FULFILMENT_PROVIDER_NOT_FOUND",
        message: "No active fulfilment provider is configured.",
      });
    }

    return fallbackProvider;
  }

  private mapOrderForApp(
    order: Prisma.OrderGetPayload<{
      include: {
        fulfilments: { include: { provider: true } };
        items: true;
      };
    }>,
  ) {
    const items = order.items.map((item) => ({
      categoryId: item.categoryId,
      currency: item.currency,
      description: item.description,
      foodItemId: item.foodItemId,
      id: item.id,
      imageUrl: item.imageUrl,
      itemSnapshot: item.itemSnapshot,
      metadata: item.metadata,
      modifiers: item.modifiers,
      name: item.name,
      quantity: item.quantity,
      totalAmount: item.totalAmount,
      unitAmount: item.unitAmount,
    }));
    const statusGroup = this.getStatusGroup(order.status);
    const primaryItem = items[0] ?? null;
    const latestFulfilment = order.fulfilments[0] ?? null;

    return {
      amount: order.amount,
      canCancel: statusGroup === "active",
      canReorder: statusGroup === "cancelled" || statusGroup === "completed",
      canTrack: statusGroup === "active",
      canViewReceipt: statusGroup === "completed",
      createdAt: order.createdAt,
      currency: order.currency,
      customerId: order.customerId,
      deliveryAddress: order.deliveryAddress,
      deliveryFee: order.deliveryFee,
      discountAmount: order.discountAmount,
      id: order.id,
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      items,
      latestFulfilment: latestFulfilment
        ? this.mapFulfilmentForApp(order, latestFulfilment)
        : null,
      notes: order.notes,
      orderNumber: order.orderNumber,
      paymentIntentId: order.paymentIntentId,
      primaryItem,
      status: order.status,
      statusGroup,
      statusLabel: this.getStatusLabel(order.status),
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      updatedAt: order.updatedAt,
    };
  }

  private getStatusGroup(status: OrderStatus) {
    if (
      (ORDER_STATUS_GROUPS.completed as readonly OrderStatus[]).includes(status)
    ) {
      return "completed";
    }
    if (
      (ORDER_STATUS_GROUPS.cancelled as readonly OrderStatus[]).includes(status)
    ) {
      return "cancelled";
    }
    return "active";
  }

  private getStatusLabel(status: OrderStatus) {
    const labels: Record<OrderStatus, string> = {
      CANCELED: "Cancelled Order",
      COMPLETED: "Completed Order",
      CONFIRMED: "Active Order",
      COURIER_ASSIGNED: "Active Order",
      DELIVERED: "Completed Order",
      OUT_FOR_DELIVERY: "Active Order",
      PAID: "Active Order",
      PARTIALLY_REFUNDED: "Cancelled Order",
      PAYMENT_FAILED: "Cancelled Order",
      PENDING_PAYMENT: "Active Order",
      PREPARING: "Active Order",
      READY_FOR_PICKUP: "Active Order",
      REFUNDED: "Cancelled Order",
    };

    return labels[status];
  }

  private async findOrderByIdOrNumber(orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: orderId }, { orderNumber: orderId }],
      },
    });

    if (!order) {
      throw new RpcException({
        code: "ORDER_NOT_FOUND",
        message: "Order could not be found.",
      });
    }

    return order;
  }

  private async findOrderByProviderDeliveryId(providerDeliveryId?: string) {
    if (!providerDeliveryId) {
      throw new RpcException({
        code: "ORDER_REFERENCE_MISSING",
        message: "Order reference could not be resolved from provider webhook.",
      });
    }

    const fulfilment = await this.prisma.orderFulfilment.findFirst({
      include: { order: true },
      where: { providerDeliveryId },
    });

    if (!fulfilment) {
      throw new RpcException({
        code: "ORDER_NOT_FOUND",
        message: "Order could not be found for provider delivery id.",
      });
    }

    return fulfilment.order;
  }

  private normalizeFulfilmentStatus(status?: string) {
    if (!status) return FulfilmentStatus.CREATED;
    return status in FulfilmentStatus
      ? (status as FulfilmentStatus)
      : FulfilmentStatus.CREATED;
  }

  private toDate(value?: string) {
    return value ? new Date(value) : undefined;
  }

  private parseStuartWebhook(payload: StuartWebhookPayload) {
    const data = this.asRecord(payload.data);
    const details = this.asRecord(payload.details);
    const packageDetails = this.asRecord(details.package);
    const driver = this.asRecord(data.driver ?? details.driver);
    const currentLocation = this.asRecord(
      driver.currentLocation ??
        driver.current_location ??
        driver.location ??
        data.location,
    );
    const cancellation = this.asRecord(
      data.cancellation ?? packageDetails.cancellation,
    );
    const rawStatus = this.stringValue(
      packageDetails.status ?? data.status ?? payload.topic ?? payload.type,
    );

    return {
      clientTrackingUrl: this.stringValue(
        packageDetails.end_customer_tracking_url ??
          packageDetails.client_tracking_url ??
          data.clientTrackingUrl ??
          data.trackingUrl,
      ),
      courierLatitude: this.numberValue(
        currentLocation.latitude ?? currentLocation.lat,
      ),
      courierLongitude: this.numberValue(
        currentLocation.longitude ?? currentLocation.lng,
      ),
      courierName: this.driverName(driver),
      courierPhone: this.stringValue(
        driver.phone ?? driver.phoneNumber ?? driver.phone_number,
      ),
      deliveredAt: this.dateValue(
        packageDetails.delivered_at ?? data.deliveredAt,
      ),
      estimatedDropoffAt: this.dateValue(
        packageDetails.eta_to_destination ??
          packageDetails.estimated_dropoff_at ??
          packageDetails.estimatedDropoffAt ??
          packageDetails.dropoff_eta ??
          packageDetails.dropoffEta ??
          data.estimatedDropoffAt ??
          data.estimated_dropoff_at ??
          data.dropoffEta ??
          data.dropoff_eta ??
          data.etaToDestination ??
          data.eta_to_destination,
      ),
      estimatedPickupAt: this.dateValue(
        packageDetails.eta_to_origin ??
          packageDetails.estimated_pickup_at ??
          packageDetails.estimatedPickupAt ??
          packageDetails.pickup_eta ??
          packageDetails.pickupEta ??
          data.estimatedPickupAt ??
          data.estimated_pickup_at ??
          data.pickupEta ??
          data.pickup_eta ??
          data.etaToOrigin ??
          data.eta_to_origin,
      ),
      failedReason: this.stringValue(
        cancellation.reasonKey ?? cancellation.comment ?? data.failureReason,
      ),
      orderReference: this.stringValue(
        packageDetails.reference ??
          data.clientReference ??
          data.client_reference ??
          payload.clientReference,
      ),
      providerDeliveryId: this.stringValue(packageDetails.id ?? data.id),
      providerJobId: this.stringValue(
        this.asRecord(data.job).id ?? packageDetails.job_id,
      ),
      status: this.mapStuartStatus(rawStatus),
      trackingUrl: this.stringValue(
        packageDetails.client_tracking_url ??
          data.trackingUrl ??
          data.clientTrackingUrl,
      ),
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringValue(value: unknown) {
    if (value === null || value === undefined) return undefined;
    return String(value);
  }

  private numberValue(value: unknown) {
    if (value === null || value === undefined || value === "") return undefined;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  private dateValue(value: unknown) {
    const stringValue = this.stringValue(value);
    if (!stringValue) return undefined;

    const date = new Date(stringValue);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private driverName(driver: Record<string, unknown>) {
    const name = this.stringValue(driver.name);
    if (name) return name;

    const firstName = this.stringValue(driver.firstName ?? driver.first_name);
    const lastName = this.stringValue(driver.lastName ?? driver.last_name);
    return [firstName, lastName].filter(Boolean).join(" ") || undefined;
  }

  private mapStuartStatus(status?: string) {
    const normalized = status?.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const mapped: Record<string, FulfilmentStatus> = {
      assigned: FulfilmentStatus.COURIER_ASSIGNED,
      canceled: FulfilmentStatus.CANCELED,
      cancelled: FulfilmentStatus.CANCELED,
      courier_assigned: FulfilmentStatus.COURIER_ASSIGNED,
      courier_waiting: FulfilmentStatus.PICKUP_STARTED,
      create: FulfilmentStatus.CREATED,
      created: FulfilmentStatus.CREATED,
      delivering: FulfilmentStatus.DROPOFF_STARTED,
      delivered: FulfilmentStatus.DELIVERED,
      failed: FulfilmentStatus.FAILED,
      finished: FulfilmentStatus.DELIVERED,
      in_progress: FulfilmentStatus.CREATED,
      new: FulfilmentStatus.CREATED,
      package_canceled: FulfilmentStatus.CANCELED,
      package_cancelled: FulfilmentStatus.CANCELED,
      package_created: FulfilmentStatus.CREATED,
      package_delivered: FulfilmentStatus.DELIVERED,
      package_delivering: FulfilmentStatus.DROPOFF_STARTED,
      pending: FulfilmentStatus.CREATED,
      picking: FulfilmentStatus.PICKUP_STARTED,
      picked: FulfilmentStatus.PICKED_UP,
      picked_up: FulfilmentStatus.PICKED_UP,
    };

    return normalized
      ? (mapped[normalized] ?? FulfilmentStatus.CREATED)
      : FulfilmentStatus.CREATED;
  }

  private async syncOrderStatusFromFulfilment(
    orderId: string,
    fulfilmentStatus: FulfilmentStatus,
  ) {
    const status = this.mapOrderStatusFromFulfilment(fulfilmentStatus);
    if (!status) return;

    await this.prisma.order.update({
      data: { status },
      where: { id: orderId },
    });
  }

  private mapOrderStatusFromFulfilment(status: FulfilmentStatus) {
    const mapped: Partial<Record<FulfilmentStatus, OrderStatus>> = {
      CANCELED: OrderStatus.CANCELED,
      COURIER_ASSIGNED: OrderStatus.COURIER_ASSIGNED,
      DELIVERED: OrderStatus.DELIVERED,
      DROPOFF_STARTED: OrderStatus.OUT_FOR_DELIVERY,
      FAILED: OrderStatus.CANCELED,
      PICKED_UP: OrderStatus.OUT_FOR_DELIVERY,
      PICKUP_STARTED: OrderStatus.READY_FOR_PICKUP,
    };

    return mapped[status];
  }

  private mapFulfilmentForApp(
    order: {
      deliveryAddress?: Prisma.JsonValue | null;
      id: string;
      orderNumber: string;
      status: OrderStatus;
    },
    fulfilment: Prisma.OrderFulfilmentGetPayload<{
      include: { provider: true };
    }>,
  ) {
    const dropoff = this.getDropoffForApp(order.deliveryAddress);
    const pickup = this.getPickupForApp();

    return {
      clientTrackingUrl: fulfilment.clientTrackingUrl,
      courier:
        fulfilment.courierName || fulfilment.courierPhone
          ? {
              name: fulfilment.courierName,
              phone: fulfilment.courierPhone,
            }
          : null,
      eta: {
        dropoff: fulfilment.estimatedDropoffAt,
        pickup: fulfilment.estimatedPickupAt,
      },
      etaLabel: this.getEtaLabel(
        fulfilment.status,
        fulfilment.estimatedDropoffAt,
        fulfilment.estimatedPickupAt,
      ),
      failedReason: fulfilment.failedReason,
      fulfilmentId: fulfilment.id,
      customerLocation: dropoff.location,
      deliveryStatus: fulfilment.status,
      dropoff,
      location:
        fulfilment.courierLatitude !== null &&
        fulfilment.courierLongitude !== null
          ? {
              latitude: fulfilment.courierLatitude,
              longitude: fulfilment.courierLongitude,
            }
          : null,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      pickup,
      provider: {
        code: fulfilment.provider.code,
        id: fulfilment.provider.id,
        name: fulfilment.provider.name,
      },
      providerDeliveryId: fulfilment.providerDeliveryId,
      providerJobId: fulfilment.providerJobId,
      status: fulfilment.status,
      statusLabel: this.getFulfilmentStatusLabel(fulfilment.status),
      trackingUrl: fulfilment.trackingUrl,
      updatedAt: fulfilment.updatedAt,
    };
  }

  private getPickupForApp() {
    const latitude = this.configService.get<number>("STUART_PICKUP_LATITUDE");
    const longitude = this.configService.get<number>("STUART_PICKUP_LONGITUDE");
    const location =
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : null;

    return {
      address: this.configService.get<string>("STUART_PICKUP_ADDRESS", ""),
      location,
    };
  }

  private getDropoffForApp(deliveryAddress?: Prisma.JsonValue | null) {
    const address = this.asRecord(deliveryAddress);
    const location = this.getAddressLocation(address);

    return {
      address: this.formatDeliveryAddress(address),
      location,
      raw: deliveryAddress ?? null,
    };
  }

  private getAddressLocation(address: Record<string, unknown>) {
    const nestedLocation = this.asRecord(address.location);
    const latitude = this.numberValue(
      address.latitude ??
        address.lat ??
        nestedLocation.latitude ??
        nestedLocation.lat,
    );
    const longitude = this.numberValue(
      address.longitude ??
        address.lng ??
        address.lon ??
        nestedLocation.longitude ??
        nestedLocation.lng ??
        nestedLocation.lon,
    );

    if (latitude === undefined || longitude === undefined) return null;

    return {
      latitude,
      longitude,
    };
  }

  private formatDeliveryAddress(address: Record<string, unknown>) {
    const rawAddress = this.stringValue(
      address.formattedAddress ?? address.raw ?? address.address,
    );
    if (rawAddress) return rawAddress;

    return [
      this.stringValue(address.line1 ?? address.addressLine1),
      this.stringValue(address.line2 ?? address.addressLine2),
      this.stringValue(address.city),
      this.stringValue(address.postcode ?? address.postalCode),
      this.stringValue(address.country),
    ]
      .filter(Boolean)
      .join(", ");
  }

  private getFulfilmentStatusLabel(status: FulfilmentStatus) {
    const labels: Record<FulfilmentStatus, string> = {
      CANCELED: "Canceled",
      COURIER_ASSIGNED: "Courier Assigned",
      CREATED: "Delivery Created",
      DELIVERED: "Delivered",
      DROPOFF_STARTED: "On The Way",
      FAILED: "Failed",
      NOT_REQUESTED: "Not Requested",
      PICKED_UP: "Picked Up",
      PICKUP_STARTED: "Pickup Started",
      QUOTE_REQUESTED: "Quote Requested",
    };

    return labels[status];
  }

  private getEtaLabel(
    status: FulfilmentStatus,
    estimatedDropoffAt?: Date | null,
    estimatedPickupAt?: Date | null,
  ) {
    if (status === FulfilmentStatus.DELIVERED) return "Delivered";
    if (status === FulfilmentStatus.CANCELED) return "Delivery canceled";
    if (status === FulfilmentStatus.FAILED) return "Delivery failed";

    const targetDate =
      status === FulfilmentStatus.CREATED ||
      status === FulfilmentStatus.COURIER_ASSIGNED ||
      status === FulfilmentStatus.PICKUP_STARTED
        ? (estimatedPickupAt ?? estimatedDropoffAt)
        : (estimatedDropoffAt ?? estimatedPickupAt);

    if (targetDate) {
      const minutes = Math.max(
        0,
        Math.round((targetDate.getTime() - Date.now()) / 60_000),
      );
      const prefix =
        status === FulfilmentStatus.CREATED ||
        status === FulfilmentStatus.COURIER_ASSIGNED ||
        status === FulfilmentStatus.PICKUP_STARTED
          ? "Pickup"
          : "Arrival";

      if (minutes <= 1) return `${prefix} due now`;
      return `${prefix} in ${minutes} min`;
    }

    const labels: Record<FulfilmentStatus, string> = {
      CANCELED: "Delivery canceled",
      COURIER_ASSIGNED: "Courier assigned",
      CREATED: "Finding courier",
      DELIVERED: "Delivered",
      DROPOFF_STARTED: "On the way",
      FAILED: "Delivery failed",
      NOT_REQUESTED: "Delivery not requested",
      PICKED_UP: "On the way",
      PICKUP_STARTED: "Courier arriving",
      QUOTE_REQUESTED: "Checking ETA",
    };

    return labels[status];
  }

  private async getTrackingRoute(params: {
    courierLocation: LatLng | null;
    customerLocation: LatLng | null;
    deliveryStatus: FulfilmentStatus;
    orderId: string;
    restaurantLocation: LatLng | null;
  }) {
    const endpoints = this.resolveRouteEndpoints(params);
    if (!endpoints) {
      return { coordinates: [] };
    }

    const cachedRoute = await this.getCachedTrackingRoute({
      destination: endpoints.destination,
      orderId: params.orderId,
      origin: endpoints.origin,
      status: params.deliveryStatus,
    });
    if (cachedRoute) {
      return { coordinates: cachedRoute };
    }

    try {
      const coordinates = await this.googleRoutesService.getRouteCoordinates({
        destination: endpoints.destination,
        origin: endpoints.origin,
      });

      if (coordinates.length > 0) {
        await this.prisma.orderTrackingRouteCache.create({
          data: {
            coordinates: coordinates as unknown as Prisma.InputJsonValue,
            destLat: endpoints.destination.latitude,
            destLng: endpoints.destination.longitude,
            orderId: params.orderId,
            originLat: endpoints.origin.latitude,
            originLng: endpoints.origin.longitude,
            status: params.deliveryStatus,
          },
        });
      }

      console.log({ coordinates });

      return { coordinates };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Route lookup failed";
      this.logger.warn(`Tracking route lookup failed: ${message}`);

      return { coordinates: cachedRoute ?? [] };
    }
  }

  private resolveRouteEndpoints(params: {
    courierLocation: LatLng | null;
    customerLocation: LatLng | null;
    deliveryStatus: FulfilmentStatus;
    restaurantLocation: LatLng | null;
  }) {
    if (!params.restaurantLocation || !params.customerLocation) return null;

    if (!params.courierLocation) {
      return {
        destination: params.customerLocation,
        origin: params.restaurantLocation,
      };
    }

    if (
      params.deliveryStatus === FulfilmentStatus.PICKED_UP ||
      params.deliveryStatus === FulfilmentStatus.DROPOFF_STARTED
    ) {
      return {
        destination: params.customerLocation,
        origin: params.courierLocation,
      };
    }

    return {
      destination: params.restaurantLocation,
      origin: params.courierLocation,
    };
  }

  private async getCachedTrackingRoute(params: {
    destination: LatLng;
    orderId: string;
    origin: LatLng;
    status: FulfilmentStatus;
  }) {
    const cacheMaxAgeMs = 60_000;
    const movementThresholdMeters = 50;
    const cache = await this.prisma.orderTrackingRouteCache.findFirst({
      orderBy: { updatedAt: "desc" },
      where: {
        orderId: params.orderId,
        status: params.status,
      },
    });

    if (!cache) return null;

    const isFresh = Date.now() - cache.updatedAt.getTime() <= cacheMaxAgeMs;
    const originCloseEnough =
      this.getDistanceMeters(params.origin, {
        latitude: cache.originLat,
        longitude: cache.originLng,
      }) <= movementThresholdMeters;
    const destinationCloseEnough =
      this.getDistanceMeters(params.destination, {
        latitude: cache.destLat,
        longitude: cache.destLng,
      }) <= movementThresholdMeters;

    if (!isFresh || !originCloseEnough || !destinationCloseEnough) return null;

    return this.asRouteCoordinates(cache.coordinates);
  }

  private asRouteCoordinates(value: Prisma.JsonValue): LatLng[] {
    if (!Array.isArray(value)) return [];

    return value
      .map((point) => {
        const record = this.asRecord(point);
        const latitude = this.numberValue(record.latitude);
        const longitude = this.numberValue(record.longitude);
        return latitude !== undefined && longitude !== undefined
          ? { latitude, longitude }
          : null;
      })
      .filter((point): point is LatLng => Boolean(point));
  }

  private getDistanceMeters(a: LatLng, b: LatLng) {
    const earthRadiusMeters = 6_371_000;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  private createOrderNumber() {
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `FM-${Date.now()}-${randomPart}`;
  }
}
