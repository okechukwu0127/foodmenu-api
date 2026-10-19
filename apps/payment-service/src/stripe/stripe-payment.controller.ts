import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { PAYMENT_PATTERNS } from "@app/common";
import {
  ConfirmPaymentDto,
  CreateSetupIntentDto,
  CreatePaymentIntentDto,
  PaymentMethodsQueryDto,
  RefundPaymentDto,
  SavePaymentMethodDto,
  UpdatePaymentMethodDto,
} from "@app/dto";
import { StripePaymentService } from "./stripe-payment.service";

@Controller()
export class StripePaymentController {
  constructor(private readonly stripePaymentService: StripePaymentService) {}

  @MessagePattern(PAYMENT_PATTERNS.CREATE_PAYMENT_INTENT)
  createPaymentIntent(@Payload() payload: CreatePaymentIntentDto) {
    return this.stripePaymentService.createPaymentIntent(payload);
  }

  @MessagePattern(PAYMENT_PATTERNS.CREATE_SETUP_INTENT)
  createSetupIntent(@Payload() payload: CreateSetupIntentDto) {
    return this.stripePaymentService.createSetupIntent(payload);
  }

  @MessagePattern(PAYMENT_PATTERNS.LIST_PAYMENT_METHODS)
  listPaymentMethods(@Payload() payload: PaymentMethodsQueryDto) {
    return this.stripePaymentService.listPaymentMethods(payload);
  }

  @MessagePattern(PAYMENT_PATTERNS.SAVE_PAYMENT_METHOD)
  savePaymentMethod(@Payload() payload: SavePaymentMethodDto) {
    return this.stripePaymentService.savePaymentMethod(payload);
  }

  @MessagePattern(PAYMENT_PATTERNS.UPDATE_PAYMENT_METHOD)
  updatePaymentMethod(
    @Payload()
    payload: UpdatePaymentMethodDto & {
      paymentMethodId: string;
    },
  ) {
    return this.stripePaymentService.updatePaymentMethod(payload);
  }

  @MessagePattern(PAYMENT_PATTERNS.DELETE_PAYMENT_METHOD)
  deletePaymentMethod(@Payload() paymentMethodId: string) {
    return this.stripePaymentService.deletePaymentMethod(paymentMethodId);
  }

  @MessagePattern(PAYMENT_PATTERNS.CONFIRM_PAYMENT)
  confirmPayment(@Payload() payload: ConfirmPaymentDto) {
    return this.stripePaymentService.confirmPayment(payload);
  }

  @MessagePattern(PAYMENT_PATTERNS.GET_PAYMENT_STATUS)
  getPaymentStatus(@Payload() paymentIntentId: string) {
    return this.stripePaymentService.getPaymentStatus(paymentIntentId);
  }

  @MessagePattern(PAYMENT_PATTERNS.REFUND_PAYMENT)
  refundPayment(@Payload() payload: RefundPaymentDto) {
    return this.stripePaymentService.refundPayment(payload);
  }

  @MessagePattern(PAYMENT_PATTERNS.HANDLE_STRIPE_WEBHOOK)
  handleStripeWebhook(
    @Payload()
    payload: {
      rawBody: string;
      stripeSignature?: string;
    },
  ) {
    return this.stripePaymentService.handleStripeWebhook(payload);
  }
}
