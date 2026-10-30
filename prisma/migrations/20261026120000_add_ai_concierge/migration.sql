-- AlterTable
ALTER TABLE "FoodItem" ADD COLUMN     "dietaryInfo" JSONB;

-- CreateTable
CREATE TABLE "AiConfiguration" (
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConfiguration_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "AiCustomerState" (
    "customerId" TEXT NOT NULL,
    "defaultProfileId" UUID,
    "defaultRevision" INTEGER NOT NULL DEFAULT 1,
    "accountAnswers" JSONB NOT NULL DEFAULT '{}',
    "accountConfigVersion" TEXT,
    "accountRevision" INTEGER NOT NULL DEFAULT 1,
    "accountUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCustomerState_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "AiPreferenceProfile" (
    "id" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "configVersion" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPreferenceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProfileImport" (
    "customerId" TEXT NOT NULL,
    "importId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProfileImport_pkey" PRIMARY KEY ("customerId","importId")
);

-- CreateTable
CREATE TABLE "AiImportMapping" (
    "customerId" TEXT NOT NULL,
    "localId" UUID NOT NULL,
    "profileId" UUID NOT NULL,

    CONSTRAINT "AiImportMapping_pkey" PRIMARY KEY ("customerId","localId")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "id" UUID NOT NULL,
    "customerId" TEXT,
    "guestTokenHash" TEXT,
    "guestExpiresAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "contextRevision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTurn" (
    "context" JSONB NOT NULL,
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "clientMessageId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "sequence" INTEGER NOT NULL,
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "turnId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRateBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRateBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AiConfiguration_active_idx" ON "AiConfiguration"("active");

-- CreateIndex
CREATE INDEX "AiPreferenceProfile_customerId_deletedAt_createdAt_idx" ON "AiPreferenceProfile"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiPreferenceProfile_customerId_id_key" ON "AiPreferenceProfile"("customerId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiConversation_guestTokenHash_key" ON "AiConversation"("guestTokenHash");

-- CreateIndex
CREATE INDEX "AiConversation_customerId_createdAt_id_idx" ON "AiConversation"("customerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AiConversation_expiresAt_idx" ON "AiConversation"("expiresAt");

-- CreateIndex
CREATE INDEX "AiTurn_conversationId_status_idx" ON "AiTurn"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiTurn_id_conversationId_key" ON "AiTurn"("id", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiTurn_conversationId_clientMessageId_key" ON "AiTurn"("conversationId", "clientMessageId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_id_idx" ON "AiMessage"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiMessage_conversationId_sequence_key" ON "AiMessage"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "AiRateBucket_expiresAt_idx" ON "AiRateBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "AiCustomerState" ADD CONSTRAINT "AiCustomerState_customerId_defaultProfileId_fkey" FOREIGN KEY ("customerId", "defaultProfileId") REFERENCES "AiPreferenceProfile"("customerId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AiCustomerState" ADD CONSTRAINT "AiCustomerState_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPreferenceProfile" ADD CONSTRAINT "AiPreferenceProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "AiCustomerState"("customerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProfileImport" ADD CONSTRAINT "AiProfileImport_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "AiCustomerState"("customerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiImportMapping" ADD CONSTRAINT "AiImportMapping_customerId_profileId_fkey" FOREIGN KEY ("customerId", "profileId") REFERENCES "AiPreferenceProfile"("customerId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AiImportMapping" ADD CONSTRAINT "AiImportMapping_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "AiCustomerState"("customerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "AiCustomerState"("customerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTurn" ADD CONSTRAINT "AiTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_turnId_conversationId_fkey" FOREIGN KEY ("turnId", "conversationId") REFERENCES "AiTurn"("id", "conversationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants not expressible by Prisma's schema DSL.
CREATE UNIQUE INDEX "AiConfiguration_one_active" ON "AiConfiguration" ("active") WHERE "active" = true;
CREATE UNIQUE INDEX "AiTurn_one_running" ON "AiTurn" ("conversationId") WHERE "status" = 'RUNNING';
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_access_mode" CHECK (
  ("customerId" IS NOT NULL AND "guestTokenHash" IS NULL AND "guestExpiresAt" IS NULL)
  OR ("customerId" IS NULL AND "guestTokenHash" IS NOT NULL AND "guestTokenHash" ~ '^[a-f0-9]{64}$' AND "guestExpiresAt" IS NOT NULL)
);
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_role" CHECK ("role" IN ('user', 'assistant'));
ALTER TABLE "AiTurn" ADD CONSTRAINT "AiTurn_status" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'));
ALTER TABLE "AiPreferenceProfile" ADD CONSTRAINT "AiPreferenceProfile_positive_revision" CHECK ("revision" > 0);
ALTER TABLE "AiCustomerState" ADD CONSTRAINT "AiCustomerState_positive_revisions" CHECK ("defaultRevision" > 0 AND "accountRevision" > 0);
