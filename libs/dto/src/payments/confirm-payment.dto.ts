import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class ConfirmPaymentDto {
  @ApiProperty({ example: "pi_123" })
  @IsString()
  paymentIntentId!: string;

  @ApiPropertyOptional({ example: "pm_123" })
  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
