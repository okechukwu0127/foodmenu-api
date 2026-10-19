-- CreateTable
CREATE TABLE "OrderTrackingRouteCache" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "coordinates" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTrackingRouteCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderTrackingRouteCache_orderId_idx" ON "OrderTrackingRouteCache"("orderId");

-- CreateIndex
CREATE INDEX "OrderTrackingRouteCache_orderId_status_idx" ON "OrderTrackingRouteCache"("orderId", "status");

-- AddForeignKey
ALTER TABLE "OrderTrackingRouteCache" ADD CONSTRAINT "OrderTrackingRouteCache_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
