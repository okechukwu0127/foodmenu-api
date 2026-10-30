import { CheckoutQuotesService } from "../checkout/checkout-quotes.service";
import { QuotePaymentPayload, commerceRpc } from "@app/dto";
import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { PAYMENT_PATTERNS } from "@app/common";
import {
  ConfirmPaymentDto,
  CreateSetupIntentDto,
  PaymentMethodsQueryDto,
  RefundPaymentDto,
  SavePaymentMethodDto,
  UpdatePaymentMethodDto,
} from "@app/dto";
import { StripePaymentService } from "./stripe-payment.service";

@Controller()
export class StripePaymentController {
  constructor(
    private readonly stripePaymentService: StripePaymentService,
    private readonly quotes: CheckoutQuotesService,
  ) {}

  @MessagePattern(PAYMENT_PATTERNS.INVALIDATE_CHECKOUT_QUOTE)
  invalidate(@Payload() p: QuotePaymentPayload) {
    return commerceRpc(() => this.quotes.invalidate(p.quoteId, p.customerId));
  }
  @MessagePattern(PAYMENT_PATTERNS.CREATE_CHECKOUT_QUOTE)
  quote(@Payload() payload: unknown) {
    return commerceRpc(() => this.quotes.create(payload));
  }
  @MessagePattern(PAYMENT_PATTERNS.GET_QUOTE_STATUS)
  quoteStatus(@Payload() p: QuotePaymentPayload) {
    return this.stripePaymentService.quoteStatus(p.quoteId, p.customerId);
  }
  @MessagePattern(PAYMENT_PATTERNS.CANCEL_QUOTE_PAYMENT)
  cancel(@Payload() p: QuotePaymentPayload) {
    return this.stripePaymentService.cancelQuote(p.quoteId, p.customerId);
  }
  @MessagePattern(PAYMENT_PATTERNS.POLL_COMMERCE_EVENTS)
  events() {
    return this.quotes.poll();
  }
  @MessagePattern(PAYMENT_PATTERNS.ACK_COMMERCE_EVENT)
  ack(@Payload() p: { id: string }) {
    return this.quotes.ack(p.id);
  }

  @MessagePattern(PAYMENT_PATTERNS.CREATE_PAYMENT_INTENT)
  createPaymentIntent(@Payload() payload: QuotePaymentPayload) {
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
