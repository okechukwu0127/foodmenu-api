import { ConciergeConfig } from "../config/config.schema";
import { EffectiveContext } from "../preferences/effective-preferences.service";
import { chatStartersCardSchema } from "../tools/cards.schema";

// Suggestions are searches, not claims that suitable meals exist.
export function preferenceChatStarters(
  context: EffectiveContext,
  config: ConciergeConfig,
  locale: string,
) {
  const label = (labels: Record<string, string>) =>
    (labels[locale] ?? labels[config.defaultLocale] ?? "").slice(0, 60);
  const dietLabels = config.questions
    .flatMap((q) => q.options)
    .filter(
      (o) =>
        o.effect?.kind === "diet" &&
        context.restrictions.diets.includes(o.effect.value!),
    )
    .map((o) => label(o.label));
  const diets = [...new Set(dietLabels)].slice(0, 2).join(", ");
  const categories = config.questions
    .filter((q) => q.optionSource === "menu-categories")
    .flatMap((q) => q.options)
    .filter((o) => context.preferredCategoryIds.includes(o.id));
  const category = categories[0] ? label(categories[0].label) : undefined;
  const starters = [
    {
      id: "match-my-preferences",
      label: diets ? `Match my ${diets} preferences` : "Match my preferences",
      prompt: diets
        ? `Find meals matching my ${diets} preferences and all my other saved requirements.`
        : "Find meals matching all my saved preferences and allergies.",
      icon: "leaf",
    },
    {
      id: "explore-another-option",
      label: category ? `Explore ${category}` : "Try another option",
      prompt: category
        ? `Search ${category} meals that meet all my saved preferences, allergies and budget.`
        : "Suggest different meal options while keeping all my saved dietary, allergy and budget requirements.",
      icon: "search",
    },
    {
      id: "browse-within-budget",
      label: context.restrictions.budgets.length
        ? "Within my budget"
        : "Browse suitable meals",
      prompt:
        "Browse the menu for meals within my saved budget that also meet my dietary preferences and allergies.",
      icon: "wallet",
    },
    {
      id: "check-menu-details",
      label: "Check ingredient details",
      prompt:
        "Find meals with declared ingredient and allergen details that meet all my saved preferences.",
      icon: "list-checks",
    },
  ];
  return chatStartersCardSchema.parse({
    version: 1,
    chatStarters: starters.map((s) => ({
      ...s,
      prompt: s.prompt.slice(0, config.chatLimits.textLength),
    })),
  });
}
