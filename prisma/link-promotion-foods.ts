import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { assetUrl } from "./seed-data/asset-url";

type LocalizedText = Record<string, string>;
type FoodSeed = {
  id: string;
  categoryId: string;
  name: LocalizedText;
  description: LocalizedText;
  price: number;
  image: string[];
  calories?: number;
  prepTimeMinutes?: number;
  rating?: number;
  fulfillmentOptions: Prisma.InputJsonValue;
  sizeOptions: Prisma.InputJsonValue;
  sideOptions: Array<
    Record<string, Prisma.InputJsonValue> & { image?: string }
  >;
  appetizerOptions: Array<
    Record<string, Prisma.InputJsonValue> & { image?: string }
  >;
  modifierGroupIds: string[];
  tags: string[];
};
type PromotionSeed = { id: string; foodItemId: string };
const catalog = JSON.parse(
  readFileSync(join(__dirname, "seed-data/mobile-catalog.seed.json"), "utf8"),
) as { foods: FoodSeed[]; deals: PromotionSeed[]; hotCombos: PromotionSeed[] };
const prisma = new PrismaClient();
const url = (value: string) =>
  value.startsWith("/assets/") ? assetUrl(value) : value;

async function main() {
  // Validate every existing promotion before creating or linking anything.
  const [deals, combos] = await Promise.all([
    prisma.deal.findMany({ select: { id: true } }),
    prisma.hotCombo.findMany({ select: { id: true } }),
  ]);
  const foods = new Map(catalog.foods.map((food) => [food.id, food]));
  const plan = [
    ...deals.map(({ id }) => ({
      id,
      kind: "deal" as const,
      seeds: catalog.deals,
    })),
    ...combos.map(({ id }) => ({
      id,
      kind: "combo" as const,
      seeds: catalog.hotCombos,
    })),
  ].map(({ id, kind, seeds }) => {
    const targetId = seeds.find((seed) => seed.id === id)?.foodItemId;
    const food = targetId ? foods.get(targetId) : undefined;
    if (
      !food ||
      food.id !== `food-${id}` ||
      !Number.isFinite(food.price) ||
      food.price <= 0
    ) {
      throw new Error(
        `Missing dedicated food with a valid price for ${kind} ${id}`,
      );
    }
    return { id, kind, food };
  });

  const links = await prisma.$transaction(
    async (tx) => {
      const results = [];
      for (const { id, kind, food } of plan) {
        // Preserve product edits; sync combo fulfillment and add missing modifier links.
        await tx.foodItem.upsert({
          where: { id: food.id },
          update:
            kind === "combo"
              ? { fulfillmentOptions: food.fulfillmentOptions }
              : {},
          create: {
            id: food.id,
            slug: food.id,
            categoryId: food.categoryId,
            name: food.name.en,
            nameData: food.name,
            description: food.description.en,
            descriptionData: food.description,
            price: Math.round(food.price * 100),
            currency: "GBP",
            calories: food.calories,
            prepTimeMinutes: food.prepTimeMinutes,
            rating: food.rating,
            fulfillmentOptions: food.fulfillmentOptions,
            sizeOptions: food.sizeOptions,
            sideOptions: food.sideOptions.map((option) => ({
              ...option,
              ...(option.image ? { image: url(option.image) } : {}),
            })),
            appetizerOptions: food.appetizerOptions.map((option) => ({
              ...option,
              ...(option.image ? { image: url(option.image) } : {}),
            })),
            tags: food.tags,
            images: {
              create: food.image.map((image, index) => ({
                url: url(image),
                altText: food.name.en,
                sortOrder: index + 1,
              })),
            },
            modifierGroups: {
              create: food.modifierGroupIds.map((modifierGroupId, index) => ({
                modifierGroupId,
                sortOrder: index + 1,
              })),
            },
            defaultModifierGroups: {
              create: food.modifierGroupIds.map((modifierGroupId, index) => ({
                id: `${food.id}-${modifierGroupId}`,
                modifierGroupId,
                scope: "FOOD_ITEM",
                sortOrder: index + 1,
              })),
            },
          },
        });
        if (kind === "combo") {
          for (const [
            index,
            modifierGroupId,
          ] of food.modifierGroupIds.entries()) {
            await tx.foodItemModifierGroup.upsert({
              where: {
                foodItemId_modifierGroupId: {
                  foodItemId: food.id,
                  modifierGroupId,
                },
              },
              update: {},
              create: {
                foodItemId: food.id,
                modifierGroupId,
                sortOrder: index + 1,
              },
            });
            await tx.defaultModifierGroup.upsert({
              where: { id: `${food.id}-${modifierGroupId}` },
              update: {},
              create: {
                id: `${food.id}-${modifierGroupId}`,
                foodItemId: food.id,
                modifierGroupId,
                scope: "FOOD_ITEM",
                sortOrder: index + 1,
              },
            });
          }
        }
        if (kind === "deal") {
          await tx.deal.update({
            where: { id },
            data: { foodItemId: food.id },
          });
        } else {
          await tx.hotCombo.update({
            where: { id },
            data: { foodItemId: food.id },
          });
        }
        results.push({ kind, id, foodItemId: food.id });
      }
      return results;
    },
    { timeout: 30000 },
  );
  console.log(JSON.stringify({ linked: links.length, links }, null, 2));
}

main()
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
