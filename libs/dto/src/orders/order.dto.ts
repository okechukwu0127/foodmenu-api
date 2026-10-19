import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { PaymentCustomerDto, PaymentOrderDto } from "../payments";

export class OrderIdParamDto {
  @ApiProperty({ example: "FM-1720000000000-ABC123" })
  @IsString()
  orderId!: string;
}

export class OrdersQueryDto {
  @ApiProperty({ example: "customer_123", required: false })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({
    enum: ["active", "completed", "cancelled"],
    required: false,
  })
  @IsOptional()
  @IsIn(["active", "completed", "cancelled"])
  statusGroup?: "active" | "completed" | "cancelled";

  @ApiProperty({ default: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;
}

export type CreatePendingOrderDto = {
  amount: number;
  currency: string;
  customer?: PaymentCustomerDto;
  customerId?: string;
  checkoutSessionId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
  order?: PaymentOrderDto;
  orderId?: string;
};

export type OrderSummaryDto = {
  amount: number;
  currency: string;
  customerId: string;
  id: string;
  metadata?: unknown;
  orderNumber: string;
  status: string;
};

export type UpdateOrderPaymentStatusDto = {
  orderId?: string;
  paymentIntentId: string;
  status: string;
};

export type OrderStatusGroup = "active" | "completed" | "cancelled";

export class CreateOrderFulfilmentDto {
  @ApiProperty({ default: "STUART", required: false })
  @IsOptional()
  @IsString()
  providerCode = "STUART";

  @ApiProperty({ example: "job_123", required: false })
  @IsOptional()
  @IsString()
  providerJobId?: string;

  @ApiProperty({ example: "delivery_123", required: false })
  @IsOptional()
  @IsString()
  providerDeliveryId?: string;

  @ApiProperty({ example: "CREATED", required: false })
  @IsOptional()
  @IsIn([
    "NOT_REQUESTED",
    "QUOTE_REQUESTED",
    "CREATED",
    "COURIER_ASSIGNED",
    "PICKUP_STARTED",
    "PICKED_UP",
    "DROPOFF_STARTED",
    "DELIVERED",
    "CANCELED",
    "FAILED",
  ])
  status?: string;

  @ApiProperty({ example: "https://tracking.stuart.com/abc", required: false })
  @IsOptional()
  @IsString()
  trackingUrl?: string;

  @ApiProperty({ example: "https://tracking.stuart.com/customer/abc", required: false })
  @IsOptional()
  @IsString()
  clientTrackingUrl?: string;

  @ApiProperty({ example: "Alex Rider", required: false })
  @IsOptional()
  @IsString()
  courierName?: string;

  @ApiProperty({ example: "+447700900123", required: false })
  @IsOptional()
  @IsString()
  courierPhone?: string;

  @ApiProperty({ example: 51.5072, required: false })
  @IsOptional()
  @IsNumber()
  courierLatitude?: number;

  @ApiProperty({ example: -0.1276, required: false })
  @IsOptional()
  @IsNumber()
  courierLongitude?: number;

  @ApiProperty({ example: "2026-10-06T12:45:00.000Z", required: false })
  @IsOptional()
  @IsISO8601()
  estimatedPickupAt?: string;

  @ApiProperty({ example: "2026-10-06T13:15:00.000Z", required: false })
  @IsOptional()
  @IsISO8601()
  estimatedDropoffAt?: string;

  @ApiProperty({ example: "2026-10-06T12:52:00.000Z", required: false })
  @IsOptional()
  @IsISO8601()
  pickedUpAt?: string;

  @ApiProperty({ example: "2026-10-06T13:09:00.000Z", required: false })
  @IsOptional()
  @IsISO8601()
  deliveredAt?: string;

  @ApiProperty({ example: "Courier cancelled pickup", required: false })
  @IsOptional()
  @IsString()
  failedReason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  rawProviderPayload?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export type CreateOrderFulfilmentPayload = CreateOrderFulfilmentDto & {
  orderId: string;
};

export class UpdateOrderFulfilmentDto {
  @ApiProperty({ example: "COURIER_ASSIGNED", required: false })
  @IsOptional()
  @IsIn([
    "NOT_REQUESTED",
    "QUOTE_REQUESTED",
    "CREATED",
    "COURIER_ASSIGNED",
    "PICKUP_STARTED",
    "PICKED_UP",
    "DROPOFF_STARTED",
    "DELIVERED",
    "CANCELED",
    "FAILED",
  ])
  status?: string;

  @ApiProperty({ example: "delivery_123", required: false })
  @IsOptional()
  @IsString()
  providerDeliveryId?: string;

  @ApiProperty({ example: "https://tracking.stuart.com/customer/abc", required: false })
  @IsOptional()
  @IsString()
  clientTrackingUrl?: string;

  @ApiProperty({ example: "Alex Rider", required: false })
  @IsOptional()
  @IsString()
  courierName?: string;

  @ApiProperty({ example: "+447700900123", required: false })
  @IsOptional()
  @IsString()
  courierPhone?: string;

  @ApiProperty({ example: 51.5072, required: false })
  @IsOptional()
  @IsNumber()
  courierLatitude?: number;

  @ApiProperty({ example: -0.1276, required: false })
  @IsOptional()
  @IsNumber()
  courierLongitude?: number;

  @ApiProperty({ example: "2026-10-06T13:15:00.000Z", required: false })
  @IsOptional()
  @IsISO8601()
  estimatedDropoffAt?: string;

  @ApiProperty({ example: "2026-10-06T12:52:00.000Z", required: false })
  @IsOptional()
  @IsISO8601()
  pickedUpAt?: string;

  @ApiProperty({ example: "2026-10-06T13:09:00.000Z", required: false })
  @IsOptional()
  @IsISO8601()
  deliveredAt?: string;

  @ApiProperty({ example: "Courier cancelled pickup", required: false })
  @IsOptional()
  @IsString()
  failedReason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  rawProviderPayload?: Record<string, unknown>;
}

export type UpdateOrderFulfilmentPayload = UpdateOrderFulfilmentDto & {
  fulfilmentId: string;
  orderId: string;
};

export type StuartWebhookPayload = Record<string, unknown>;
