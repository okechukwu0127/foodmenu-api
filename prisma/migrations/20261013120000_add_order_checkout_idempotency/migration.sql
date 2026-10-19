-- AlterTable
ALTER TABLE "Order" ADD COLUMN "checkoutSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_checkoutSessionId_key" ON "Order"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "Order_checkoutSessionId_idx" ON "Order"("checkoutSessionId");
