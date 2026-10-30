-- AlterTable
ALTER TABLE "AiConversation" ADD COLUMN     "claimExpiresAt" TIMESTAMP(3),
ADD COLUMN     "claimedGuestTokenHash" TEXT;

-- AlterTable
ALTER TABLE "AiTurn" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CHAT';

-- CreateTable
CREATE TABLE "AiCommerceState" (
    "conversationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "cart" JSONB NOT NULL DEFAULT '[]',
    "draft" JSONB,
    "stage" TEXT NOT NULL DEFAULT 'BROWSING',
    "quoteId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCommerceState_pkey" PRIMARY KEY ("conversationId")
);

-- CreateTable
CREATE TABLE "AiCommerceAction" (
    "conversationId" UUID NOT NULL,
    "actionId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCommerceAction_pkey" PRIMARY KEY ("conversationId","actionId")
);

-- CreateTable
CREATE TABLE "AiConversationCheckout" (
    "quoteId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "cartRevision" INTEGER NOT NULL,
    "orderId" TEXT,
    "paymentIntentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "lastObservation" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversationCheckout_pkey" PRIMARY KEY ("quoteId")
);

-- CreateTable
CREATE TABLE "CheckoutPolicy" (
    "currency" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "deliveryCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliveryPostcodePrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutPolicy_pkey" PRIMARY KEY ("currency")
);

-- CreateTable
CREATE TABLE "CheckoutQuote" (
    "id" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "conversationId" UUID,
    "requestHash" TEXT NOT NULL,
    "selection" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "reservedAt" TIMESTAMP(3),
    "paymentIntentId" TEXT,
    "orderId" TEXT,
    "observation" INTEGER NOT NULL DEFAULT 0,
    "observedStatus" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCommerceEvent" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "observation" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCommerceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiConversationCheckout_paymentIntentId_key" ON "AiConversationCheckout"("paymentIntentId");

-- CreateIndex
CREATE INDEX "AiConversationCheckout_conversationId_createdAt_idx" ON "AiConversationCheckout"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutQuote_paymentIntentId_key" ON "CheckoutQuote"("paymentIntentId");

-- CreateIndex
CREATE INDEX "CheckoutQuote_expiresAt_idx" ON "CheckoutQuote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutQuote_customerId_requestId_key" ON "CheckoutQuote"("customerId", "requestId");

-- CreateIndex
CREATE INDEX "PaymentCommerceEvent_acknowledgedAt_createdAt_idx" ON "PaymentCommerceEvent"("acknowledgedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCommerceEvent_quoteId_observation_key" ON "PaymentCommerceEvent"("quoteId", "observation");

-- AddForeignKey
ALTER TABLE "AiCommerceState" ADD CONSTRAINT "AiCommerceState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCommerceAction" ADD CONSTRAINT "AiCommerceAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversationCheckout" ADD CONSTRAINT "AiConversationCheckout_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCommerceEvent" ADD CONSTRAINT "PaymentCommerceEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CheckoutQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

