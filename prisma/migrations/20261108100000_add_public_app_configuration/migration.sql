CREATE TABLE "Restaurant" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "addressFormatted" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "city" TEXT NOT NULL,
  "postcode" TEXT NOT NULL,
  "countryCode" CHAR(2) NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Restaurant_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
  CONSTRAINT "Restaurant_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180),
  CONSTRAINT "Restaurant_country_check" CHECK ("countryCode" ~ '^[A-Z]{2}$')
);
CREATE TABLE "AppConfiguration" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "appName" TEXT NOT NULL,
  "shortName" TEXT,
  "defaultRestaurantId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppConfiguration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppConfiguration_singleton_check" CHECK ("id" = 'default')
);
CREATE UNIQUE INDEX "AppConfiguration_defaultRestaurantId_key" ON "AppConfiguration"("defaultRestaurantId");
ALTER TABLE "AppConfiguration" ADD CONSTRAINT "AppConfiguration_defaultRestaurantId_fkey"
FOREIGN KEY ("defaultRestaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
