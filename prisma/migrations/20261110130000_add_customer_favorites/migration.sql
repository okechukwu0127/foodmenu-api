CREATE TABLE "CustomerFavorite" (
    "customerId" TEXT NOT NULL,
    "foodId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerFavorite_pkey" PRIMARY KEY ("customerId", "foodId"),
    CONSTRAINT "CustomerFavorite_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
