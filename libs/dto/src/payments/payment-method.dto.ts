import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class CreateSetupIntentDto {
  @ApiProperty({ example: "customer_123" })
  @IsString()
  customerId!: string;
}

export class SavePaymentMethodDto {
  @ApiProperty({ example: "customer_123" })
  @IsString()
  customerId!: string;

  @ApiProperty({ example: "pm_123" })
  @IsString()
  paymentMethodId!: string;

  @ApiPropertyOptional({ example: "Personal Visa" })
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiPropertyOptional({ example: "John Doe" })
  @IsOptional()
  @IsString()
  holderName?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class PaymentMethodsQueryDto {
  @ApiProperty({ example: "customer_123" })
  @IsString()
  customerId!: string;
}

export class PaymentMethodParamDto {
  @ApiProperty({ example: "pm_123" })
  @IsString()
  paymentMethodId!: string;
}

export class UpdatePaymentMethodDto {
  @ApiPropertyOptional({ example: "Personal Visa" })
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiPropertyOptional({ example: "John Doe" })
  @IsOptional()
  @IsString()
  holderName?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
