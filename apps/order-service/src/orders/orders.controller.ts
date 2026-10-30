import { CheckoutChargesService } from "../checkout/checkout-charges.service";
import { commerceRpc } from "@app/dto";
import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { ORDER_PATTERNS } from "@app/common";
import {
  CreateOrderFulfilmentPayload,
  CreatePendingOrderDto,
  OrdersQueryDto,
  StuartWebhookPayload,
  UpdateOrderFulfilmentPayload,
  UpdateOrderPaymentStatusDto,
} from "@app/dto";
import { OrdersService } from "./orders.service";

@Controller()
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly charges: CheckoutChargesService,
  ) {}

  @MessagePattern(ORDER_PATTERNS.QUOTE_CHARGES)
  quoteCharges(@Payload() payload: unknown) {
    return commerceRpc(() => this.charges.quote(payload));
  }

  @MessagePattern(ORDER_PATTERNS.CREATE_PENDING_ORDER)
  createPendingOrder(@Payload() payload: CreatePendingOrderDto) {
    return this.ordersService.createPendingOrder(payload);
  }

  @MessagePattern(ORDER_PATTERNS.LIST_FULFILMENT_PROVIDERS)
  listFulfilmentProviders() {
    return this.ordersService.listFulfilmentProviders();
  }

  @MessagePattern(ORDER_PATTERNS.CREATE_ORDER_FULFILMENT)
  createOrderFulfilment(@Payload() payload: CreateOrderFulfilmentPayload) {
    return this.ordersService.createOrderFulfilment(payload);
  }

  @MessagePattern(ORDER_PATTERNS.GET_ORDER_TRACKING)
  getOrderTracking(@Payload() orderId: string) {
    return this.ordersService.getOrderTracking(orderId);
  }

  @MessagePattern(ORDER_PATTERNS.HANDLE_STUART_WEBHOOK)
  handleStuartWebhook(@Payload() payload: StuartWebhookPayload) {
    return this.ordersService.handleStuartWebhook(payload);
  }

  @MessagePattern(ORDER_PATTERNS.UPDATE_ORDER_FULFILMENT)
  updateOrderFulfilment(@Payload() payload: UpdateOrderFulfilmentPayload) {
    return this.ordersService.updateOrderFulfilment(payload);
  }

  @MessagePattern(ORDER_PATTERNS.GET_CUSTOMER_ORDERS)
  getCustomerOrders(@Payload() payload: OrdersQueryDto) {
    return this.ordersService.getCustomerOrders(payload);
  }

  @MessagePattern(ORDER_PATTERNS.UPDATE_PAYMENT_STATUS)
  updatePaymentStatus(@Payload() payload: UpdateOrderPaymentStatusDto) {
    return this.ordersService.updatePaymentStatus(payload);
  }

  @MessagePattern(ORDER_PATTERNS.GET_ORDER_DETAILS)
  getOrderDetails(@Payload() orderId: string) {
    return this.ordersService.getOrderDetails(orderId);
  }
}
