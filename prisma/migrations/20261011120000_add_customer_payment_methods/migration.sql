-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "CustomerPaymentMethod" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "alias" TEXT,
    "holderName" TEXT,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "Customer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentMethod_stripePaymentMethodId_key" ON "CustomerPaymentMethod"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "CustomerPaymentMethod_customerId_idx" ON "CustomerPaymentMethod"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPaymentMethod_stripeCustomerId_idx" ON "CustomerPaymentMethod"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "CustomerPaymentMethod_isDefault_idx" ON "CustomerPaymentMethod"("isDefault");

-- CreateIndex
CREATE INDEX "CustomerPaymentMethod_deletedAt_idx" ON "CustomerPaymentMethod"("deletedAt");

-- AddForeignKey
ALTER TABLE "CustomerPaymentMethod" ADD CONSTRAINT "CustomerPaymentMethod_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
