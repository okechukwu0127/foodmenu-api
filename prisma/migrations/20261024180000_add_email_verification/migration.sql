ALTER TABLE "AuthAccount" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
-- Google identities were already verified when created/linked. Password-only
-- accounts must now prove ownership; never grandfather them as email-verified.
UPDATE "AuthAccount" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "googleSub" IS NOT NULL;

CREATE TABLE "EmailVerification" (
    "accountId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("accountId"),
    CONSTRAINT "EmailVerification_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "EmailVerification_expiresAt_idx" ON "EmailVerification"("expiresAt");
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "AuthAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
