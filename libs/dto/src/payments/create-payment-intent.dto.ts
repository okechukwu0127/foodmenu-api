import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Min,
  ValidateNested,
} from "class-validator";

export class PaymentCustomerDto {
  @ApiPropertyOptional({ example: "customer_123" })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ example: "Ada" })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: "Lovelace" })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: "ada@example.com" })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: "+447700900123" })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class PaymentOrderItemDto {
  @ApiPropertyOptional({ example: "food-001" })
  @IsOptional()
  @IsString()
  foodItemId?: string;

  @ApiPropertyOptional({ example: "burgers" })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ example: "Smoky BBQ Burger" })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: "Juicy beef patty with smoky BBQ sauce." })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1200",
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 1299, minimum: 0 })
  @IsInt()
  @Min(0)
  unitAmount!: number;

  @ApiPropertyOptional({
    example: [
      {
        groupId: "mod_burger_size",
        groupName: "Choose your burger size",
        optionId: "opt_burger_large",
        optionName: "Large",
        priceOffset: 200,
        quantity: 1,
      },
    ],
  })
  @IsOptional()
  @IsArray()
  modifiers?: unknown[];

  @ApiPropertyOptional({
    example: {
      tags: ["beef", "spicy"],
      rating: 4.8,
      calories: 720,
      selectedSize: "Large",
    },
  })
  @IsOptional()
  @IsObject()
  itemSnapshot?: Record<string, unknown>;

  @ApiPropertyOptional({ example: { note: "No onions" } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class PaymentOrderDto {
  @ApiPropertyOptional({ example: "order_123" })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ example: 2198 })
  @IsOptional()
  @IsInt()
  @Min(0)
  subtotal?: number;

  @ApiPropertyOptional({ example: 199 })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  taxAmount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ example: "Leave at reception" })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: {
      line1: "23 King Street",
      city: "London",
      postcode: "SW1A 1AA",
      country: "GB",
    },
  })
  @IsOptional()
  @IsObject()
  deliveryAddress?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [PaymentOrderItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentOrderItemDto)
  items?: PaymentOrderItemDto[];

  @ApiPropertyOptional({ example: { source: "checkout" } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

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

  @ApiPropertyOptional({ example: "pm_123" })
  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @ApiPropertyOptional({ example: "card_db_id" })
  @IsOptional()
  @IsString()
  savedPaymentMethodId?: string;

  @ApiPropertyOptional({ example: "order_123" })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ example: "checkout_1791909664130" })
  @IsOptional()
  @IsString()
  checkoutSessionId?: string;

  @ApiPropertyOptional({ example: "checkout_1791909664130" })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({ type: PaymentCustomerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentCustomerDto)
  customer?: PaymentCustomerDto;

  @ApiPropertyOptional({ type: PaymentOrderDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentOrderDto)
  order?: PaymentOrderDto;

  @ApiPropertyOptional({ example: { source: "foodmenu-mobile" } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
