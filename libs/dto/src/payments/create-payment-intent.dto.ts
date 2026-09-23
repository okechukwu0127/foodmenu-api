import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Length,
} from "class-validator";

export class CreatePaymentIntentDto {
  @ApiProperty({ example: 2500, minimum: 1 })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ default: "gbp", example: "gbp" })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency = "gbp";

  @ApiPropertyOptional({ example: "cus_123" })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ example: "order_123" })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ example: { source: "foodmenu-mobile" } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
