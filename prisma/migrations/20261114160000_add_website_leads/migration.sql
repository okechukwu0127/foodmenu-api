-- "Book a free demo" and "Become a partner" requests from the Liberq marketing website.
CREATE TYPE "LeadKind" AS ENUM ('DEMO', 'PARTNER');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

CREATE TABLE "WebsiteLead" (
    "id" TEXT NOT NULL,
    "kind" "LeadKind" NOT NULL DEFAULT 'DEMO',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "name" VARCHAR(100) NOT NULL,
    "business" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "source" VARCHAR(64) NOT NULL DEFAULT 'website',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebsiteLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteLead_kind_status_createdAt_idx" ON "WebsiteLead"("kind", "status", "createdAt");
CREATE INDEX "WebsiteLead_email_idx" ON "WebsiteLead"("email");
