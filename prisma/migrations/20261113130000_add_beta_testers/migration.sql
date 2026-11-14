-- Beta-testing sign-ups collected from the Liberq marketing website.
CREATE TYPE "BetaPlatform" AS ENUM ('IOS', 'ANDROID');
CREATE TYPE "BetaTesterStatus" AS ENUM ('REQUESTED', 'INVITED', 'UNSUBSCRIBED');

CREATE TABLE "BetaTester" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "platform" "BetaPlatform" NOT NULL,
    "status" "BetaTesterStatus" NOT NULL DEFAULT 'REQUESTED',
    "source" VARCHAR(64) NOT NULL DEFAULT 'website',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BetaTester_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BetaTester_email_platform_key" ON "BetaTester"("email", "platform");
CREATE INDEX "BetaTester_status_createdAt_idx" ON "BetaTester"("status", "createdAt");
