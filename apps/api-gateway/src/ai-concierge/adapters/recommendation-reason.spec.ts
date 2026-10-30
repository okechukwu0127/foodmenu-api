import { foodCardSchema } from "../tools/cards.schema";
import { EffectiveContext } from "../preferences/effective-preferences.service";
import { recommendationReason } from "./recommendation-reason";

const food = foodCardSchema.parse({
  id: "curry",
  categoryId: "favourite",
  name: "Vegetable Curry",
  description: "A restaurant dish",
  price: { amountMinor: 1250, currency: "GBP" },
  available: true,
  images: [],
  dietaryInfo: {
    dietaryTags: ["vegan"],
    allergensKnown: true,
    allergens: [],
    mayContain: [],
    crossContact: "controlled",
  },
  informationStatus: "restaurant-declared",
  modifierGroups: [],
  sizes: null,
  extras: null,
});
const context: EffectiveContext = {
  configVersion: "test",
  preferenceProfileId: null,
  profileRevision: null,
  accountRevision: null,
  profileAnswers: {},
  accountAnswers: {},
  temporaryAnswers: {},
  preferredCategoryIds: [],
  restrictions: {
    diets: ["vegan"],
    allergens: [],
    allergyState: "unknown",
    budgets: [{ currency: "GBP", maxMinor: 1500 }],
  },
};
const options = { categories: new Set(["favourite"]), explicitCategory: false };

it("explains only verified item-specific matches without allergen-safety claims", () => {
  const reason = recommendationReason(food, context, "en", options);
  expect(reason).toContain("**Vegetable Curry**");
  expect(reason).toContain("£12.50");
  expect(reason).toContain("dietary preferences");
  expect(reason).toContain("favourite category");
  expect(reason).toContain("saved budget");
  expect(reason).not.toMatch(/allergen.safe|guarantee|healthy/i);
  expect(reason.length).toBeLessThanOrEqual(600);
});
it("always supplies a reason without claiming unverified preferences", () => {
  const reason = recommendationReason(
    { ...food, dietaryInfo: null, categoryId: null },
    context,
    "en",
    { categories: new Set(), explicitCategory: false },
  );
  expect(reason).toContain("available for");
  expect(reason).not.toContain("dietary preferences");
  expect(reason).not.toContain("category");
  expect(
    recommendationReason(food, context, "en", {
      ...options,
      explicitCategory: true,
    }),
  ).toContain("requested category");
});
it.each(["fr", "es", "ar"])("localizes the reason for %s", (locale) => {
  const reason = recommendationReason(food, context, locale, options);
  expect(reason).toContain("**Vegetable Curry**");
  expect(reason).not.toContain("is available for");
  expect(reason.length).toBeGreaterThan(20);
});
