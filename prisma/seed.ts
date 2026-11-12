import "dotenv/config";
import { seedAppConfiguration } from "./seed-data/app-config.seed";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { assetUrl } from "./seed-data/asset-url";
import { modifierLabelTranslationsSeed } from "./seed-data";

/*
 * Additive, idempotent catalogue seed.
 *
 * Every record in the seed files is upserted by its fixed id, so the seed can
 * run any number of times (locally or on a live server) without deleting
 * anything. Records that are not in the seed files are never touched. Records
 * that are in the seed files are reset to the seed values on each run, so the
 * seed files are the source of truth for seeded menu items.
 */

type LocalizedText = Record<string, string | undefined>;

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

type CatalogSeed = {
  appetizerOptionsPool: CatalogAddOn[];
  categories: Array<{
    icon: string;
    id: string;
    image: string;
    isActive?: boolean;
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
    isActive?: boolean;
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
    slug?: string;
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
    isActive?: boolean;
    max: number;
    min: number;
    name: LocalizedText;
    options: Array<{
      calories?: number;
      description?: LocalizedText;
      id: string;
      image?: string;
      isActive?: boolean;
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

type Tx = Prisma.TransactionClient;

// Seed files, applied in order. Sort orders continue across files so later
// menus appear after earlier ones.
const CATALOG_FILES = ["mobile-catalog.seed.json", "menu-2026-11.seed.json"];

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

const loadCatalog = (file: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "seed-data", file), "utf8"),
  ) as CatalogSeed;

type Offsets = Record<
  | "categories"
  | "groups"
  | "foods"
  | "slides"
  | "deals"
  | "combos"
  | "drinks"
  | "appetizers",
  number
>;

async function seedCatalog(tx: Tx, catalog: CatalogSeed, offset: Offsets) {
  for (const [index, category] of catalog.categories.entries()) {
    const data = {
      displayName: localized(category.name),
      icon: category.icon,
      imageUrl: imageUrl(category.image),
      isActive: category.isActive ?? true,
      name: category.name,
      nameKey: `categories.${category.id}`,
      slug: category.id,
      sortOrder: offset.categories + index + 1,
    };
    await tx.category.upsert({
      create: { id: category.id, ...data },
      update: data,
      where: { id: category.id },
    });
  }

  for (const [index, group] of catalog.modifierGroups.entries()) {
    const data = {
      descriptionData: group.description,
      isActive: group.isActive ?? true,
      isRequired: group.required,
      maxSelections: group.max,
      minSelections: group.min,
      nameData: group.name,
      quantityMode: group.quantityMode,
      selectionType:
        group.selectionType === "single"
          ? ("SINGLE" as const)
          : ("MULTIPLE" as const),
      slug: group.id,
      sortOrder: offset.groups + index + 1,
      subtitle: localized(group.description),
      title: localized(group.name),
    };
    await tx.modifierGroup.upsert({
      create: { id: group.id, ...data },
      update: data,
      where: { id: group.id },
    });

    for (const [optionIndex, option] of group.options.entries()) {
      const optionData = {
        calories: option.calories,
        description: localized(option.description),
        descriptionData: option.description,
        imageUrl: imageUrl(option.image),
        isActive: option.isActive ?? true,
        isDefault: option.isDefault ?? false,
        isPopular: option.isPopular ?? false,
        maxQuantity: option.maxQuantity,
        modifierGroupId: group.id,
        name: localized(option.name),
        nameData: option.name,
        priceOffset: cents(option.priceOffset),
        sortOrder: optionIndex + 1,
        tag: option.tag,
      };
      await tx.modifierOption.upsert({
        create: { id: option.id, ...optionData },
        update: optionData,
        where: { id: option.id },
      });
    }
  }

  for (const [index, food] of catalog.foods.entries()) {
    const data = {
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
      isActive: food.isActive ?? food.isFoodAvailable ?? true,
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
      slug: food.slug ?? slugify(food.id),
      sortOrder: offset.foods + index + 1,
      tags: food.tags,
    };
    await tx.foodItem.upsert({
      create: { id: food.id, ...data },
      update: data,
      where: { id: food.id },
    });

    // Images and group links belong to the seeded food: replace them with the
    // seeded set (fixed ids), removing only rows for this food that are no
    // longer in the seed.
    const imageIds = food.image.map((_, i) => `${food.id}-img-${i + 1}`);
    await tx.foodImage.deleteMany({
      where: { foodItemId: food.id, id: { notIn: imageIds } },
    });
    for (const [imageIndex, image] of food.image.entries()) {
      const imageData = {
        altText: localized(food.name),
        foodItemId: food.id,
        sortOrder: imageIndex + 1,
        url: imageUrl(image) ?? image,
      };
      await tx.foodImage.upsert({
        create: { id: imageIds[imageIndex], ...imageData },
        update: imageData,
        where: { id: imageIds[imageIndex] },
      });
    }

    await tx.foodItemModifierGroup.deleteMany({
      where: {
        foodItemId: food.id,
        modifierGroupId: { notIn: food.modifierGroupIds },
      },
    });
    await tx.defaultModifierGroup.deleteMany({
      where: {
        foodItemId: food.id,
        scope: "FOOD_ITEM",
        modifierGroupId: { notIn: food.modifierGroupIds },
      },
    });
    for (const [
      groupIndex,
      modifierGroupId,
    ] of food.modifierGroupIds.entries()) {
      await tx.foodItemModifierGroup.upsert({
        create: {
          foodItemId: food.id,
          modifierGroupId,
          sortOrder: groupIndex + 1,
        },
        update: { sortOrder: groupIndex + 1 },
        where: {
          foodItemId_modifierGroupId: { foodItemId: food.id, modifierGroupId },
        },
      });

      const defaultId = `${food.id}-${modifierGroupId}`;
      const defaultData = {
        foodItemId: food.id,
        modifierGroupId,
        scope: "FOOD_ITEM" as const,
        sortOrder: groupIndex + 1,
      };
      await tx.defaultModifierGroup.upsert({
        create: { id: defaultId, ...defaultData },
        update: defaultData,
        where: { id: defaultId },
      });
    }
  }

  for (const [index, slide] of catalog.heroSlides.entries()) {
    const data = {
      discountLabel: slide.discountPercent,
      discountPercent: parseDiscountPercent(slide.discountPercent),
      imageUrl: imageUrl(slide.image) ?? slide.image,
      sortOrder: offset.slides + index + 1,
      subtitle: localized(slide.subtitle),
      subtitleData: slide.subtitle,
      title: localized(slide.title),
      titleData: slide.title,
    };
    await tx.heroSlide.upsert({
      create: { id: slide.id, ...data },
      update: data,
      where: { id: slide.id },
    });
  }

  for (const [index, deal] of catalog.deals.entries()) {
    const data = {
      accentColor: deal.accentColor,
      backgroundColor: deal.backgroundColor,
      foodItemId: deal.foodItemId,
      description: localized(deal.offerDesc),
      imageUrl: imageUrl(deal.image),
      offerCategory: deal.offerCategory,
      offerDelivery: deal.offerDelivery,
      offerDesc: deal.offerDesc,
      offerType: deal.offerType,
      sortOrder: offset.deals + index + 1,
      subtitle: localized(deal.offerDelivery),
      title: localized(deal.offerType),
    };
    await tx.deal.upsert({
      create: { id: deal.id, ...data },
      update: data,
      where: { id: deal.id },
    });
  }

  for (const [index, combo] of catalog.hotCombos.entries()) {
    const data = {
      categoryLabel: localized(combo.categoryLabel),
      foodItemId: combo.foodItemId,
      categoryLabelData: combo.categoryLabel,
      descriptionData: combo.description,
      imageUrl: imageUrl(combo.image),
      isFeatured: combo.isFeatured ?? false,
      items: combo.items,
      nameData: combo.name,
      price: cents(combo.price),
      sortOrder: offset.combos + index + 1,
      subtitle: localized(combo.description),
      title: localized(combo.name),
    };
    await tx.hotCombo.upsert({
      create: { id: combo.id, ...data },
      update: data,
      where: { id: combo.id },
    });
  }

  for (const [index, drink] of catalog.drinkAddOns.entries()) {
    const data = {
      description: localized(drink.description),
      descriptionData: drink.description,
      imageUrl: imageUrl(drink.image),
      name: localized(drink.name),
      nameData: drink.name,
      price: cents(drink.price),
      sortOrder: offset.drinks + index + 1,
      tag: drink.tag,
      unitLabel: drink.unitLabel,
    };
    await tx.drinkAddOn.upsert({
      create: { id: drink.id, ...data },
      update: data,
      where: { id: drink.id },
    });
  }

  for (const [index, appetizer] of catalog.appetizerOptionsPool.entries()) {
    const data = {
      calories: appetizer.calories,
      description: localized(appetizer.description),
      descriptionData: appetizer.description,
      imageUrl: imageUrl(appetizer.image),
      name: localized(appetizer.name),
      nameData: appetizer.name,
      price: cents(appetizer.price),
      sortOrder: offset.appetizers + index + 1,
      tag: appetizer.tag,
      unitLabel: appetizer.unitLabel,
    };
    await tx.appetizerOption.upsert({
      create: { id: appetizer.id, ...data },
      update: data,
      where: { id: appetizer.id },
    });
  }

  return {
    appetizers: offset.appetizers + catalog.appetizerOptionsPool.length,
    categories: offset.categories + catalog.categories.length,
    combos: offset.combos + catalog.hotCombos.length,
    deals: offset.deals + catalog.deals.length,
    drinks: offset.drinks + catalog.drinkAddOns.length,
    foods: offset.foods + catalog.foods.length,
    groups: offset.groups + catalog.modifierGroups.length,
    slides: offset.slides + catalog.heroSlides.length,
  };
}

async function main() {
  // Only creates the app configuration when missing; never overwrites it.
  await seedAppConfiguration(
    prisma,
    JSON.parse(readFileSync(join(__dirname, "app-config.json"), "utf8")),
  );
  await seedFulfilmentProviders();

  await prisma.$transaction(
    async (tx) => {
      let offset: Offsets = {
        appetizers: 0,
        categories: 0,
        combos: 0,
        deals: 0,
        drinks: 0,
        foods: 0,
        groups: 0,
        slides: 0,
      };
      for (const file of CATALOG_FILES) {
        const catalog = loadCatalog(file);
        offset = await seedCatalog(tx, catalog, offset);
        console.log(
          `Seeded ${file}: ${catalog.categories.length} categories, ${catalog.foods.length} foods, ${catalog.modifierGroups.length} modifier groups, ${catalog.deals.length} deals, ${catalog.hotCombos.length} hot combos`,
        );
      }

      for (const translation of modifierLabelTranslationsSeed) {
        await tx.modifierLabelTranslation.upsert({
          create: translation,
          update: { value: translation.value },
          where: {
            key_locale: { key: translation.key, locale: translation.locale },
          },
        });
      }
    },
    { maxWait: 10_000, timeout: 600_000 },
  );
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

  // Create-only: never reset provider settings an operator changed on a live server.
  for (const provider of providers) {
    await prisma.fulfilmentProvider.upsert({
      create: provider,
      update: {},
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
