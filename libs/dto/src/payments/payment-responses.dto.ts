import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreatePaymentIntentResponseDto {
  @ApiProperty({ example: "pi_123_secret_abc" })
  clientSecret!: string;

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
}

export class RefundPaymentResponseDto {
  @ApiProperty({ example: "re_123" })
  refundId!: string;

  @ApiProperty({ example: "succeeded" })
  status!: string;
}
