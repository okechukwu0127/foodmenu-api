import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PaymentOrderSummaryResponseDto {
  @ApiProperty({ example: "cm_order_123" })
  id!: string;

  @ApiProperty({ example: "FM-1720000000000-ABC123" })
  orderNumber!: string;

  @ApiProperty({ example: "PAID" })
  status!: string;

  @ApiProperty({ example: 2500 })
  amount!: number;

  @ApiProperty({ example: "gbp" })
  currency!: string;
}

export class CreatePaymentIntentResponseDto {
  @ApiProperty({ example: "pi_123_secret_abc" })
  clientSecret!: string;

  @ApiPropertyOptional({ example: "checkout_1791909664130" })
  checkoutSessionId?: string | null;

  @ApiProperty({ example: "ek_123_secret_abc" })
  customerEphemeralKeySecret!: string;

  @ApiProperty({ example: "cus_123" })
  customerId!: string;

  @ApiProperty({ example: "cm_order_123" })
  orderId!: string;

  @ApiProperty({ example: "FM-1720000000000-ABC123" })
  orderNumber!: string;

  @ApiProperty({ example: "PENDING_PAYMENT" })
  orderStatus!: string;

  @ApiProperty({ example: "pi_123" })
  paymentIntentId!: string;

  @ApiProperty({ example: "requires_payment_method" })
  status!: string;
}

export class ConfirmPaymentResponseDto {
  @ApiProperty({ example: "pi_123" })
  paymentIntentId!: string;

  @ApiProperty({ example: "succeeded" })
  status!: string;

  @ApiPropertyOptional({ type: PaymentOrderSummaryResponseDto })
  order?: PaymentOrderSummaryResponseDto | null;
}

export class PaymentStatusResponseDto {
  @ApiProperty({ example: "pi_123" })
  paymentIntentId!: string;

  @ApiProperty({ example: "succeeded" })
  status!: string;

  @ApiPropertyOptional({ example: 2500 })
  amount?: number;

  @ApiPropertyOptional({ example: "gbp" })
  currency?: string;

  @ApiPropertyOptional({ type: PaymentOrderSummaryResponseDto })
  order?: PaymentOrderSummaryResponseDto | null;
}

export class RefundPaymentResponseDto {
  @ApiProperty({ example: "re_123" })
  refundId!: string;

  @ApiProperty({ example: "succeeded" })
  status!: string;
}

export class CreateSetupIntentResponseDto {
  @ApiProperty({ example: "seti_123_secret_abc" })
  clientSecret!: string;

  @ApiProperty({ example: "customer_123" })
  customerId!: string;

  @ApiProperty({ example: "seti_123" })
  setupIntentId!: string;
}

export class CustomerPaymentMethodResponseDto {
  @ApiProperty({ example: "card_db_id" })
  id!: string;

  @ApiProperty({ example: "customer_123" })
  customerId!: string;

  @ApiProperty({ example: "pm_123" })
  stripePaymentMethodId!: string;

  @ApiPropertyOptional({ example: "Personal Visa" })
  alias?: string | null;

  @ApiPropertyOptional({ example: "John Doe" })
  holderName?: string | null;

  @ApiProperty({ example: "visa" })
  brand!: string;

  @ApiProperty({ example: "4242" })
  last4!: string;

  @ApiProperty({ example: 12 })
  expMonth!: number;

  @ApiProperty({ example: 2030 })
  expYear!: number;

  @ApiProperty({ example: false })
  isDefault!: boolean;
}
