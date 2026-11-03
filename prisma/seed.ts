import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { assetUrl } from "./seed-data/asset-url";
import { modifierLabelTranslationsSeed } from "./seed-data";

type LocalizedText = Record<string, string | undefined>;

type CatalogSeed = {
  appetizerOptionsPool: CatalogAddOn[];
  categories: Array<{
    icon: string;
    id: string;
    image: string;
    name: LocalizedText;
  }>;
  deals: Array<{
    foodItemId?: string;
    accentColor: string;
    backgroundColor: string;
    id: string;
    image: string;
    offerCategory: string[];
    offerDelivery: LocalizedText;
    offerDesc: LocalizedText;
    offerType: LocalizedText;
  }>;
  drinkAddOns: CatalogAddOn[];
  foods: Array<{
    appetizerOptions: CatalogAddOn[];
    calories?: number;
    categoryId: string;
    description: LocalizedText;
    discountPercent?: number;
    fulfillmentOptions: unknown[];
    id: string;
    image: string[];
    isFoodAvailable?: boolean;
    isPopular?: boolean;
    isRecommended?: boolean;
    modifierGroupIds: string[];
    name: LocalizedText;
    prepTimeMinutes?: number;
    price: number;
    rating?: number;
    sideOptions: CatalogAddOn[];
    sizeOptions: unknown[];
    tags: string[];
  }>;
  heroSlides: Array<{
    discountPercent: string;
    id: string;
    image: string;
    subtitle: LocalizedText;
    title: LocalizedText;
  }>;
  hotCombos: Array<{
    foodItemId?: string;
    categoryLabel: LocalizedText;
    description: LocalizedText;
    id: string;
    image: string;
    isFeatured?: boolean;
    items: LocalizedText[];
    name: LocalizedText;
    price: number;
  }>;
  modifierGroups: Array<{
    description?: LocalizedText;
    id: string;
    max: number;
    min: number;
    name: LocalizedText;
    options: Array<{
      calories?: number;
      description?: LocalizedText;
      id: string;
      image?: string;
      isDefault?: boolean;
      isPopular?: boolean;
      maxQuantity?: number;
      name: LocalizedText;
      priceOffset: number;
      tag?: string;
    }>;
    quantityMode: string;
    required: boolean;
    selectionType: "single" | "multi";
  }>;
};

type CatalogAddOn = {
  calories?: number;
  description?: LocalizedText;
  id: string;
  image: string;
  name: LocalizedText;
  price: number;
  tag?: string;
  unitLabel?: string;
};

const prisma = new PrismaClient();

const cents = (value: number) => Math.round(value * 100);

const localized = (value: LocalizedText | undefined, fallback = "") =>
  value?.en ?? fallback;

const imageUrl = (value: string | undefined) => {
  if (!value) return value;
  return value.startsWith("/assets/") ? assetUrl(value) : value;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const parseDiscountPercent = (value: string) => {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
};

const loadCatalog = () =>
  JSON.parse(
    readFileSync(join(__dirname, "seed-data/mobile-catalog.seed.json"), "utf8"),
  ) as CatalogSeed;

async function clearMenuCatalog() {
  await prisma.defaultModifierGroup.deleteMany();
  await prisma.foodItemModifierGroup.deleteMany();
  await prisma.foodImage.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.hotCombo.deleteMany();
  await prisma.heroSlide.deleteMany();
  await prisma.drinkAddOn.deleteMany();
  await prisma.appetizerOption.deleteMany();
  await prisma.modifierOption.deleteMany();
  await prisma.modifierGroup.deleteMany();
  await prisma.foodItem.deleteMany();
  await prisma.category.deleteMany();
}

async function main() {
  const catalog = loadCatalog();

  await clearMenuCatalog();
  await seedFulfilmentProviders();

  for (const [index, category] of catalog.categories.entries()) {
    await prisma.category.create({
      data: {
        displayName: localized(category.name),
        icon: category.icon,
        id: category.id,
        imageUrl: imageUrl(category.image),
        name: category.name,
        nameKey: `categories.${category.id}`,
        slug: category.id,
        sortOrder: index + 1,
      },
    });
  }

  for (const [index, group] of catalog.modifierGroups.entries()) {
    await prisma.modifierGroup.create({
      data: {
        descriptionData: group.description,
        id: group.id,
        isRequired: group.required,
        maxSelections: group.max,
        minSelections: group.min,
        nameData: group.name,
        quantityMode: group.quantityMode,
        selectionType: group.selectionType === "single" ? "SINGLE" : "MULTIPLE",
        slug: group.id,
        sortOrder: index + 1,
        subtitle: localized(group.description),
        title: localized(group.name),
        options: {
          create: group.options.map((option, optionIndex) => ({
            calories: option.calories,
            description: localized(option.description),
            descriptionData: option.description,
            id: option.id,
            imageUrl: imageUrl(option.image),
            isDefault: option.isDefault ?? false,
            isPopular: option.isPopular ?? false,
            maxQuantity: option.maxQuantity,
            name: localized(option.name),
            nameData: option.name,
            priceOffset: cents(option.priceOffset),
            sortOrder: optionIndex + 1,
            tag: option.tag,
          })),
        },
      },
    });
  }

  for (const [index, food] of catalog.foods.entries()) {
    await prisma.foodItem.create({
      data: {
        appetizerOptions: food.appetizerOptions.map((option) => ({
          ...option,
          image: imageUrl(option.image),
        })),
        calories: food.calories,
        categoryId: food.categoryId,
        description: localized(food.description),
        descriptionData: food.description,
        discountPercent: food.discountPercent,
        fulfillmentOptions: food.fulfillmentOptions as Prisma.InputJsonValue,
        id: food.id,
        isActive: food.isFoodAvailable ?? true,
        isFoodAvailable: food.isFoodAvailable ?? true,
        isPopular: food.isPopular ?? false,
        isRecommended: food.isRecommended ?? false,
        name: localized(food.name),
        nameData: food.name,
        prepTimeMinutes: food.prepTimeMinutes,
        price: cents(food.price),
        rating: food.rating,
        sideOptions: food.sideOptions.map((option) => ({
          ...option,
          image: imageUrl(option.image),
        })),
        sizeOptions: food.sizeOptions as Prisma.InputJsonValue,
        slug: slugify(food.id),
        sortOrder: index + 1,
        tags: food.tags,
      },
    });

    for (const [imageIndex, image] of food.image.entries()) {
      await prisma.foodImage.create({
        data: {
          altText: localized(food.name),
          foodItemId: food.id,
          sortOrder: imageIndex + 1,
          url: imageUrl(image) ?? image,
        },
      });
    }

    for (const [
      groupIndex,
      modifierGroupId,
    ] of food.modifierGroupIds.entries()) {
      await prisma.foodItemModifierGroup.create({
        data: {
          foodItemId: food.id,
          modifierGroupId,
          sortOrder: groupIndex + 1,
        },
      });

      await prisma.defaultModifierGroup.create({
        data: {
          foodItemId: food.id,
          id: `${food.id}-${modifierGroupId}`,
          modifierGroupId,
          scope: "FOOD_ITEM",
          sortOrder: groupIndex + 1,
        },
      });
    }
  }

  for (const [index, slide] of catalog.heroSlides.entries()) {
    await prisma.heroSlide.create({
      data: {
        discountLabel: slide.discountPercent,
        discountPercent: parseDiscountPercent(slide.discountPercent),
        id: slide.id,
        imageUrl: imageUrl(slide.image) ?? slide.image,
        sortOrder: index + 1,
        subtitle: localized(slide.subtitle),
        subtitleData: slide.subtitle,
        title: localized(slide.title),
        titleData: slide.title,
      },
    });
  }

  for (const [index, deal] of catalog.deals.entries()) {
    await prisma.deal.create({
      data: {
        accentColor: deal.accentColor,
        backgroundColor: deal.backgroundColor,
        foodItemId: deal.foodItemId,
        description: localized(deal.offerDesc),
        id: deal.id,
        imageUrl: imageUrl(deal.image),
        offerCategory: deal.offerCategory,
        offerDelivery: deal.offerDelivery,
        offerDesc: deal.offerDesc,
        offerType: deal.offerType,
        sortOrder: index + 1,
        subtitle: localized(deal.offerDelivery),
        title: localized(deal.offerType),
      },
    });
  }

  for (const [index, combo] of catalog.hotCombos.entries()) {
    await prisma.hotCombo.create({
      data: {
        categoryLabel: localized(combo.categoryLabel),
        foodItemId: combo.foodItemId,
        categoryLabelData: combo.categoryLabel,
        descriptionData: combo.description,
        id: combo.id,
        imageUrl: imageUrl(combo.image),
        isFeatured: combo.isFeatured ?? false,
        items: combo.items,
        nameData: combo.name,
        price: cents(combo.price),
        sortOrder: index + 1,
        subtitle: localized(combo.description),
        title: localized(combo.name),
      },
    });
  }

  for (const [index, drink] of catalog.drinkAddOns.entries()) {
    await prisma.drinkAddOn.create({
      data: {
        description: localized(drink.description),
        descriptionData: drink.description,
        id: drink.id,
        imageUrl: imageUrl(drink.image),
        name: localized(drink.name),
        nameData: drink.name,
        price: cents(drink.price),
        sortOrder: index + 1,
        tag: drink.tag,
        unitLabel: drink.unitLabel,
      },
    });
  }

  for (const [index, appetizer] of catalog.appetizerOptionsPool.entries()) {
    await prisma.appetizerOption.create({
      data: {
        calories: appetizer.calories,
        description: localized(appetizer.description),
        descriptionData: appetizer.description,
        id: appetizer.id,
        imageUrl: imageUrl(appetizer.image),
        name: localized(appetizer.name),
        nameData: appetizer.name,
        price: cents(appetizer.price),
        sortOrder: index + 1,
        tag: appetizer.tag,
        unitLabel: appetizer.unitLabel,
      },
    });
  }

  for (const translation of modifierLabelTranslationsSeed) {
    await prisma.modifierLabelTranslation.upsert({
      create: translation,
      update: {
        value: translation.value,
      },
      where: {
        key_locale: {
          key: translation.key,
          locale: translation.locale,
        },
      },
    });
  }
}

async function seedFulfilmentProviders() {
  const providers = [
    {
      code: "STUART",
      config: {
        docs: "https://api-docs.stuart.com/",
        mode: "manual-first",
      },
      isActive: true,
      name: "Stuart",
    },
    {
      code: "UBER_DIRECT",
      config: {
        docs: "https://developer.uber.com/docs/deliveries",
        mode: "reserved",
      },
      isActive: false,
      name: "Uber Direct",
    },
    {
      code: "MANUAL_DELIVERY",
      config: {
        mode: "internal",
      },
      isActive: true,
      name: "Manual Delivery",
    },
  ];

  for (const provider of providers) {
    await prisma.fulfilmentProvider.upsert({
      create: provider,
      update: {
        config: provider.config,
        isActive: provider.isActive,
        name: provider.name,
      },
      where: { code: provider.code },
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
