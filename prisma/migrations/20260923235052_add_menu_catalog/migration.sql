-- CreateEnum
CREATE TYPE "ModifierSelectionType" AS ENUM ('SINGLE', 'MULTIPLE');

-- CreateEnum
CREATE TYPE "DefaultModifierScope" AS ENUM ('GLOBAL', 'CATEGORY', 'FOOD_ITEM');

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "displayName" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodItem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "calories" INTEGER,
    "prepTimeMinutes" INTEGER,
    "rating" DOUBLE PRECISION,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodImage" (
    "id" TEXT NOT NULL,
    "foodItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FoodImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "discountPercent" INTEGER,
    "backgroundColor" TEXT,
    "foodItemId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeroSlide" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "discountPercent" INTEGER,
    "ctaLabel" TEXT,
    "ctaTargetType" TEXT,
    "ctaTargetId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroSlide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotBurgerCombo" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "imageUrl" TEXT,
    "categoryLabel" TEXT,
    "price" INTEGER,
    "foodItemId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotBurgerCombo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrinkAddOn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrinkAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "selectionType" "ModifierSelectionType" NOT NULL,
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierOption" (
    "id" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceOffset" INTEGER NOT NULL DEFAULT 0,
    "calories" INTEGER,
    "imageUrl" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodItemModifierGroup" (
    "foodItemId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FoodItemModifierGroup_pkey" PRIMARY KEY ("foodItemId","modifierGroupId")
);

-- CreateTable
CREATE TABLE "DefaultModifierGroup" (
    "id" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "scope" "DefaultModifierScope" NOT NULL,
    "categoryId" TEXT,
    "foodItemId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefaultModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierLabelTranslation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierLabelTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppetizerOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "calories" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppetizerOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_isActive_idx" ON "Category"("isActive");

-- CreateIndex
CREATE INDEX "Category_sortOrder_idx" ON "Category"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_slug_key" ON "FoodItem"("slug");

-- CreateIndex
CREATE INDEX "FoodItem_categoryId_idx" ON "FoodItem"("categoryId");

-- CreateIndex
CREATE INDEX "FoodItem_isActive_idx" ON "FoodItem"("isActive");

-- CreateIndex
CREATE INDEX "FoodItem_isPopular_idx" ON "FoodItem"("isPopular");

-- CreateIndex
CREATE INDEX "FoodItem_sortOrder_idx" ON "FoodItem"("sortOrder");

-- CreateIndex
CREATE INDEX "FoodImage_foodItemId_idx" ON "FoodImage"("foodItemId");

-- CreateIndex
CREATE INDEX "FoodImage_sortOrder_idx" ON "FoodImage"("sortOrder");

-- CreateIndex
CREATE INDEX "Deal_isActive_idx" ON "Deal"("isActive");

-- CreateIndex
CREATE INDEX "Deal_startsAt_idx" ON "Deal"("startsAt");

-- CreateIndex
CREATE INDEX "Deal_endsAt_idx" ON "Deal"("endsAt");

-- CreateIndex
CREATE INDEX "Deal_sortOrder_idx" ON "Deal"("sortOrder");

-- CreateIndex
CREATE INDEX "Deal_foodItemId_idx" ON "Deal"("foodItemId");

-- CreateIndex
CREATE INDEX "HeroSlide_isActive_idx" ON "HeroSlide"("isActive");

-- CreateIndex
CREATE INDEX "HeroSlide_sortOrder_idx" ON "HeroSlide"("sortOrder");

-- CreateIndex
CREATE INDEX "HotBurgerCombo_isActive_idx" ON "HotBurgerCombo"("isActive");

-- CreateIndex
CREATE INDEX "HotBurgerCombo_sortOrder_idx" ON "HotBurgerCombo"("sortOrder");

-- CreateIndex
CREATE INDEX "HotBurgerCombo_foodItemId_idx" ON "HotBurgerCombo"("foodItemId");

-- CreateIndex
CREATE INDEX "DrinkAddOn_isActive_idx" ON "DrinkAddOn"("isActive");

-- CreateIndex
CREATE INDEX "DrinkAddOn_sortOrder_idx" ON "DrinkAddOn"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroup_slug_key" ON "ModifierGroup"("slug");

-- CreateIndex
CREATE INDEX "ModifierGroup_isActive_idx" ON "ModifierGroup"("isActive");

-- CreateIndex
CREATE INDEX "ModifierGroup_sortOrder_idx" ON "ModifierGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "ModifierOption_modifierGroupId_idx" ON "ModifierOption"("modifierGroupId");

-- CreateIndex
CREATE INDEX "ModifierOption_isActive_idx" ON "ModifierOption"("isActive");

-- CreateIndex
CREATE INDEX "ModifierOption_sortOrder_idx" ON "ModifierOption"("sortOrder");

-- CreateIndex
CREATE INDEX "FoodItemModifierGroup_foodItemId_idx" ON "FoodItemModifierGroup"("foodItemId");

-- CreateIndex
CREATE INDEX "FoodItemModifierGroup_modifierGroupId_idx" ON "FoodItemModifierGroup"("modifierGroupId");

-- CreateIndex
CREATE INDEX "FoodItemModifierGroup_sortOrder_idx" ON "FoodItemModifierGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "DefaultModifierGroup_modifierGroupId_idx" ON "DefaultModifierGroup"("modifierGroupId");

-- CreateIndex
CREATE INDEX "DefaultModifierGroup_scope_idx" ON "DefaultModifierGroup"("scope");

-- CreateIndex
CREATE INDEX "DefaultModifierGroup_categoryId_idx" ON "DefaultModifierGroup"("categoryId");

-- CreateIndex
CREATE INDEX "DefaultModifierGroup_foodItemId_idx" ON "DefaultModifierGroup"("foodItemId");

-- CreateIndex
CREATE INDEX "DefaultModifierGroup_sortOrder_idx" ON "DefaultModifierGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "ModifierLabelTranslation_locale_idx" ON "ModifierLabelTranslation"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierLabelTranslation_key_locale_key" ON "ModifierLabelTranslation"("key", "locale");

-- CreateIndex
CREATE INDEX "AppetizerOption_isActive_idx" ON "AppetizerOption"("isActive");

-- CreateIndex
CREATE INDEX "AppetizerOption_sortOrder_idx" ON "AppetizerOption"("sortOrder");

-- AddForeignKey
ALTER TABLE "FoodItem" ADD CONSTRAINT "FoodItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodImage" ADD CONSTRAINT "FoodImage_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotBurgerCombo" ADD CONSTRAINT "HotBurgerCombo_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItemModifierGroup" ADD CONSTRAINT "FoodItemModifierGroup_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItemModifierGroup" ADD CONSTRAINT "FoodItemModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultModifierGroup" ADD CONSTRAINT "DefaultModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultModifierGroup" ADD CONSTRAINT "DefaultModifierGroup_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultModifierGroup" ADD CONSTRAINT "DefaultModifierGroup_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
