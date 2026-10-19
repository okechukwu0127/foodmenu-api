-- AlterTable
ALTER TABLE "AppetizerOption" ADD COLUMN     "descriptionData" JSONB,
ADD COLUMN     "nameData" JSONB,
ADD COLUMN     "tag" TEXT,
ADD COLUMN     "unitLabel" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "icon" TEXT,
ADD COLUMN     "name" JSONB;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "accentColor" TEXT,
ADD COLUMN     "offerCategory" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "offerDelivery" JSONB,
ADD COLUMN     "offerDesc" JSONB,
ADD COLUMN     "offerType" JSONB;

-- AlterTable
ALTER TABLE "DrinkAddOn" ADD COLUMN     "descriptionData" JSONB,
ADD COLUMN     "nameData" JSONB,
ADD COLUMN     "tag" TEXT,
ADD COLUMN     "unitLabel" TEXT;

-- AlterTable
ALTER TABLE "FoodItem" ADD COLUMN     "appetizerOptions" JSONB,
ADD COLUMN     "descriptionData" JSONB,
ADD COLUMN     "discountPercent" INTEGER,
ADD COLUMN     "fulfillmentOptions" JSONB,
ADD COLUMN     "isFoodAvailable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isRecommended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nameData" JSONB,
ADD COLUMN     "sideOptions" JSONB,
ADD COLUMN     "sizeOptions" JSONB,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "HeroSlide" ADD COLUMN     "discountLabel" TEXT,
ADD COLUMN     "subtitleData" JSONB,
ADD COLUMN     "titleData" JSONB;

-- AlterTable
ALTER TABLE "HotBurgerCombo" ADD COLUMN     "categoryLabelData" JSONB,
ADD COLUMN     "descriptionData" JSONB,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "items" JSONB,
ADD COLUMN     "nameData" JSONB;

-- AlterTable
ALTER TABLE "ModifierGroup" ADD COLUMN     "descriptionData" JSONB,
ADD COLUMN     "nameData" JSONB,
ADD COLUMN     "quantityMode" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "ModifierOption" ADD COLUMN     "descriptionData" JSONB,
ADD COLUMN     "isPopular" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxQuantity" INTEGER,
ADD COLUMN     "nameData" JSONB,
ADD COLUMN     "tag" TEXT;

-- CreateIndex
CREATE INDEX "FoodItem_isRecommended_idx" ON "FoodItem"("isRecommended");

-- CreateIndex
CREATE INDEX "FoodItem_isFoodAvailable_idx" ON "FoodItem"("isFoodAvailable");
