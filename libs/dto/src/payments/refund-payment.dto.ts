import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsPositive, IsString } from "class-validator";

export class RefundPaymentDto {
  @ApiProperty({ example: "pi_123" })
  @IsString()
  paymentIntentId!: string;

  @ApiPropertyOptional({ example: 500, minimum: 1 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: "requested_by_customer" })
  @IsOptional()
  @IsString()
  reason?: string;
}
