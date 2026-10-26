ALTER TABLE "Customer" ADD COLUMN "defaultAddressId" VARCHAR(128);

CREATE TABLE "CustomerAddress" (
    "customerId" TEXT NOT NULL,
    "addressId" VARCHAR(128) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "address" VARCHAR(1000) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("customerId", "addressId"),
    CONSTRAINT "CustomerAddress_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
    CONSTRAINT "CustomerAddress_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180)
);
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Including customer ID makes cross-customer defaults impossible, even outside the API.
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_id_defaultAddressId_fkey"
    FOREIGN KEY ("id", "defaultAddressId") REFERENCES "CustomerAddress"("customerId", "addressId")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
