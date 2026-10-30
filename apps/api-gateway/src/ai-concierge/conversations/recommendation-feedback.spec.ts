import { readFileSync } from "fs";
import { configSchema } from "../config/config.schema";
import { EffectiveContext } from "../preferences/effective-preferences.service";
import { recommendationFeedback } from "./recommendation-feedback";

const config = {
  ...configSchema.parse(
    JSON.parse(readFileSync("prisma/ai-concierge-config.json", "utf8")),
  ),
  version: "test",
};
const context = {
  restrictions: { diets: ["vegan"], allergens: ["milk"], budgets: [] },
} as unknown as EffectiveContext;

it.each([
  [[], "No menu items matched that search."],
  [
    ["Matching meals do not meet all of your saved dietary requirements."],
    "Vegan dietary preferences",
  ],
  [
    [
      "The menu is missing dietary information needed to check your saved dietary requirements.",
    ],
    "menu is missing details",
  ],
  [
    [
      "Matching meals list an allergen or possible cross-contact that conflicts with your saved allergies.",
    ],
    "conflict with your saved allergies",
  ],
])(
  "keeps the empty-result explanation brief and grounded (%j)",
  (reasons, expected) => {
    const text = recommendationFeedback(
      {
        version: 1,
        foods: [],
        scanned: 1,
        truncated: false,
        missingInformation: reasons,
        disclaimer: "",
      },
      context,
      config,
      "en",
    );
    expect(text).toContain(expected);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(40);
    expect(text).not.toContain("allergy-safety guarantee");
  },
);
