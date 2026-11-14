-- Legal documents (terms, privacy) delivered to the apps with the public app configuration.
CREATE TABLE "LegalDocument" (
    "id" VARCHAR(32) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "blocks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);
