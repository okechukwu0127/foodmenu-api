-- CreateEnum
CREATE TYPE "FulfilmentStatus" AS ENUM (
    'NOT_REQUESTED',
    'QUOTE_REQUESTED',
    'CREATED',
    'COURIER_ASSIGNED',
    'PICKUP_STARTED',
    'PICKED_UP',
    'DROPOFF_STARTED',
    'DELIVERED',
    'CANCELED',
    'FAILED'
);

-- CreateTable
CREATE TABLE "FulfilmentProvider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfilmentProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFulfilment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fulfilmentProviderId" TEXT NOT NULL,
    "status" "FulfilmentStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "providerJobId" TEXT,
    "providerDeliveryId" TEXT,
    "trackingUrl" TEXT,
    "clientTrackingUrl" TEXT,
    "courierName" TEXT,
    "courierPhone" TEXT,
    "courierLatitude" DOUBLE PRECISION,
    "courierLongitude" DOUBLE PRECISION,
    "estimatedPickupAt" TIMESTAMP(3),
    "estimatedDropoffAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "rawProviderPayload" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderFulfilment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FulfilmentProvider_code_key" ON "FulfilmentProvider"("code");

-- CreateIndex
CREATE INDEX "FulfilmentProvider_isActive_idx" ON "FulfilmentProvider"("isActive");

-- CreateIndex
CREATE INDEX "OrderFulfilment_orderId_idx" ON "OrderFulfilment"("orderId");

-- CreateIndex
CREATE INDEX "OrderFulfilment_fulfilmentProviderId_idx" ON "OrderFulfilment"("fulfilmentProviderId");

-- CreateIndex
CREATE INDEX "OrderFulfilment_status_idx" ON "OrderFulfilment"("status");

-- CreateIndex
CREATE INDEX "OrderFulfilment_providerJobId_idx" ON "OrderFulfilment"("providerJobId");

-- CreateIndex
CREATE INDEX "OrderFulfilment_providerDeliveryId_idx" ON "OrderFulfilment"("providerDeliveryId");

-- CreateIndex
CREATE INDEX "OrderFulfilment_createdAt_idx" ON "OrderFulfilment"("createdAt");

-- AddForeignKey
ALTER TABLE "OrderFulfilment" ADD CONSTRAINT "OrderFulfilment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFulfilment" ADD CONSTRAINT "OrderFulfilment_fulfilmentProviderId_fkey" FOREIGN KEY ("fulfilmentProviderId") REFERENCES "FulfilmentProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
