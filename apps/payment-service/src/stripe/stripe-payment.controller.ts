import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { PAYMENT_PATTERNS } from "@app/common";
import {
  ConfirmPaymentDto,
  CreatePaymentIntentDto,
  RefundPaymentDto,
} from "@app/dto";
import { StripePaymentService } from "./stripe-payment.service";

@Controller()
export class StripePaymentController {
  constructor(private readonly stripePaymentService: StripePaymentService) {}

  @MessagePattern(PAYMENT_PATTERNS.CREATE_PAYMENT_INTENT)
  createPaymentIntent(@Payload() payload: CreatePaymentIntentDto) {
    return this.stripePaymentService.createPaymentIntent(payload);
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
