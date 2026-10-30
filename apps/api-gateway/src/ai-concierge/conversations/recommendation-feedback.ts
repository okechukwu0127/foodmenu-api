import { z } from "zod";
import { ConciergeConfig } from "../config/config.schema";
import { EffectiveContext } from "../preferences/effective-preferences.service";
import { recommendationCardSchema } from "../tools/cards.schema";

export type RecommendationFeedback = z.infer<typeof recommendationCardSchema>;

// Ground the fallback in the actual filtered results, not guessed food ingredients.
export function recommendationFeedback(
  result: RecommendationFeedback,
  context: EffectiveContext,
  config: ConciergeConfig,
  locale: string,
): string {
  if (result.foods.length)
    return "Here are some meals that match your current preferences. Which one would you like to explore?";
  const reasons = result.missingInformation;
  if (reasons.some((reason) => reason.includes("missing"))) {
    return "No matches could be confirmed: the menu is missing details needed to check your saved dietary or allergy requirements. Try another dish or ask the restaurant for details.";
  }
  if (reasons.some((reason) => reason.includes("dietary requirements"))) {
    const diets = context.restrictions.diets
      .map((value) => {
        const option = config.questions
          .flatMap((q) => q.options)
          .find((o) => o.effect?.kind === "diet" && o.effect.value === value);
        return (
          option?.label[locale] ??
          option?.label[config.defaultLocale] ??
          value
        ).slice(0, 60);
      })
      .slice(0, 3);
    return `No meals matched your ${diets.join(", ")} dietary preferences. Switch dining profiles or try another dish.`;
  }
  if (reasons.some((reason) => reason.includes("saved allergies")))
    return "Matching meals conflict with your saved allergies. Try another dish.";
  if (reasons.length) return `${reasons[0]} Try another dish.`;
  return result.truncated
    ? "No matches in the menu items checked. Try a more specific dish name."
    : "No menu items matched that search. Try another dish name.";
}
