import { z } from "zod";
export const dietaryInfoSchema = z
  .object({
    dietaryTags: z.array(z.string().max(64)).max(40),
    allergensKnown: z.boolean(),
    allergens: z.array(z.string().max(64)).max(40),
    mayContain: z.array(z.string().max(64)).max(40),
    crossContact: z.enum(["unknown", "controlled"]),
    ingredients: z.array(z.string().max(200)).max(100).optional(),
  })
  .strict();
const money = z
  .object({
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
const option = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    price: money.extend({ amountMinor: z.number().int() }),
  })
  .strict();
const group = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    selectionType: z.string(),
    minSelections: z.number().int(),
    maxSelections: z.number().int().nullable(),
    required: z.boolean(),
    options: z.array(option),
  })
  .strict();
const size = z
  .object({
    id: z.string(),
    label: z.string().nullable(),
    measurementLabel: z.string().nullable(),
    priceOffset: money.extend({ amountMinor: z.number().int() }),
  })
  .strict();
const extra = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    price: money,
    image: z.string().nullable(),
    unitLabel: z.string().nullable(),
  })
  .strict();
export const foodCardSchema = z
  .object({
    id: z.string(),
    categoryId: z.string().nullable().default(null),
    name: z.string().nullable(),
    // Optional for older saved cards; every new recommendation supplies it.
    recommendationReason: z.string().trim().min(1).max(600).optional(),
    description: z.string().nullable(),
    price: money,
    available: z.boolean(),
    images: z.array(z.string()),
    dietaryInfo: dietaryInfoSchema.nullable(),
    informationStatus: z.enum(["restaurant-declared", "unknown"]),
    modifierGroups: z.array(group),
    customisationStatus: z
      .enum(["available", "unknown", "details-required"])
      .default("unknown"),
    sizes: z.array(size).max(50).nullable(),
    extras: z
      .object({
        sides: z.array(extra).max(50).nullable(),
        appetizers: z.array(extra).max(50).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type FoodCard = z.infer<typeof foodCardSchema>;
export const recommendationCardSchema = z
  .object({
    version: z.literal(1),
    foods: z.array(foodCardSchema).max(20),
    scanned: z.number().int(),
    truncated: z.boolean(),
    missingInformation: z.array(z.string()),
    disclaimer: z.string(),
  })
  .strict();
export const detailsCardSchema = z
  .object({
    version: z.literal(1),
    food: foodCardSchema,
    disclaimer: z.string(),
  })
  .strict();
export const preferenceSummarySchema = z
  .object({
    version: z.literal(1),
    profileId: z.string().uuid().nullable(),
    profileRevision: z.number().int().nullable(),
    accountRevision: z.number().int().nullable(),
    preferredCategoryIds: z.array(z.string()).optional(),
    allergyState: z.enum(["unknown", "none-known", "restricted"]),
    allergens: z.array(z.string()),
    diets: z.array(z.string()),
  })
  .strict();
export const chatStartersCardSchema = z
  .object({
    version: z.literal(1),
    chatStarters: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            label: z.string().min(1).max(160),
            prompt: z.string().min(1).max(1000),
            icon: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          })
          .strict(),
      )
      .length(4),
  })
  .strict();
const commerceMoney = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.string(),
});
const commerceState = z.object({
  conversationId: z.string().uuid(),
  revision: z.number().int().positive(),
  stage: z.string(),
  cart: z
    .array(
      z
        .object({
          lineId: z.string().uuid(),
          foodId: z.string(),
          quantity: z.number().int().positive(),
          name: z.string(),
          currency: z.string(),
          unitAmount: z.number().int().nonnegative(),
          lineAmount: z.number().int().nonnegative(),
        })
        .passthrough(),
    )
    .max(30),
  draft: z.unknown().nullable(),
  quoteId: z.string().uuid().nullable(),
  updatedAt: z.union([z.date(), z.string()]),
  subtotal: z.number().int().nonnegative(),
  pricesAreEstimates: z.boolean(),
});
const commerceCard = z
  .object({
    version: z.literal(1),
    state: commerceState,
    quote: z
      .object({
        quoteId: z.string().uuid(),
        amount: z.number().int().positive(),
        currency: z.string(),
        expiresAt: z.union([z.date(), z.string()]),
        state: z.string(),
        snapshot: z.unknown(),
      })
      .optional(),
  })
  .strict();
const paymentCard = commerceMoney
  .extend({
    version: z.literal(1),
    verified: z.literal(true),
    quoteId: z.string().uuid(),
    conversationId: z.string().uuid(),
    customerId: z.string(),
    observation: z.number().int().positive(),
    paymentIntentId: z.string(),
    orderId: z.string(),
    status: z.string(),
  })
  .strict();
export const cardSchemas = {
  "data-chat-starters": chatStartersCardSchema,
  "data-commerce-selection": commerceCard,
  "data-cart-summary": commerceCard,
  "data-checkout-prepared": commerceCard,
  "data-payment-status": paymentCard,
  "data-food-recommendations": recommendationCardSchema,
  "data-food-details": detailsCardSchema,
  "data-preference-summary": preferenceSummarySchema,
} as const;
export type CardType = keyof typeof cardSchemas;
