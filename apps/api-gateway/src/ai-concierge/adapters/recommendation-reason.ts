import { FoodCard } from "../tools/cards.schema";
import { EffectiveContext } from "../preferences/effective-preferences.service";

const copy = {
  en: {
    dish: "This dish",
    available: (name: string, price: string) =>
      `${name} is available for ${price}.`,
    dietary: "matches your saved dietary preferences",
    category: "matches a favourite category",
    requested: "matches your requested category",
    budget: "fits your saved budget",
    search: "matches your search",
    matches: (reasons: string[]) => `It ${reasons.join(" and ")}.`,
  },
  fr: {
    dish: "Ce plat",
    available: (name: string, price: string) =>
      `${name} est disponible à ${price}.`,
    dietary: "respecte vos préférences alimentaires enregistrées",
    category: "correspond à une catégorie favorite",
    requested: "correspond à la catégorie demandée",
    budget: "respecte votre budget enregistré",
    search: "correspond à votre recherche",
    matches: (reasons: string[]) => `Il ${reasons.join(" et ")}.`,
  },
  es: {
    dish: "Este plato",
    available: (name: string, price: string) =>
      `${name} está disponible por ${price}.`,
    dietary: "coincide con tus preferencias alimentarias guardadas",
    category: "pertenece a una categoría favorita",
    requested: "pertenece a la categoría solicitada",
    budget: "se ajusta a tu presupuesto guardado",
    search: "coincide con tu búsqueda",
    matches: (reasons: string[]) => `${reasons.join(" y ")}.`,
  },
  ar: {
    dish: "هذا الطبق",
    available: (name: string, price: string) => `${name} متاح بسعر ${price}.`,
    dietary: "يتوافق مع تفضيلاتك الغذائية المحفوظة",
    category: "ينتمي إلى فئة مفضلة لديك",
    requested: "ينتمي إلى الفئة المطلوبة",
    budget: "يناسب ميزانيتك المحفوظة",
    search: "يطابق بحثك",
    matches: (reasons: string[]) => `${reasons.join("، و")}.`,
  },
};

// User-facing facts only: no model reasoning or inferred ingredients/safety.
export function recommendationReason(
  food: FoodCard,
  context: EffectiveContext,
  locale: string,
  options: {
    categories: Set<string>;
    explicitCategory: boolean;
    query?: string;
  },
): string {
  const language = locale.split("-")[0] as keyof typeof copy;
  const t = copy[language] ?? copy.en;
  const name = (food.name?.replace(/[*`<>\r\n]/g, "").trim() || t.dish).slice(
    0,
    80,
  );
  const price = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: food.price.currency,
  }).format(food.price.amountMinor / 100);
  const reasons: string[] = [];
  if (
    context.restrictions.diets.length &&
    context.restrictions.diets.every((diet) =>
      food.dietaryInfo?.dietaryTags.includes(diet),
    )
  )
    reasons.push(t.dietary);
  if (food.categoryId && options.categories.has(food.categoryId))
    reasons.push(options.explicitCategory ? t.requested : t.category);
  if (
    context.restrictions.budgets.length &&
    context.restrictions.budgets.every(
      (budget) =>
        budget.currency === food.price.currency &&
        food.price.amountMinor <= budget.maxMinor,
    )
  )
    reasons.push(t.budget);
  const query = options.query?.trim().toLocaleLowerCase(locale);
  if (
    query &&
    `${food.name ?? ""} ${food.description ?? ""}`
      .toLocaleLowerCase(locale)
      .includes(query)
  )
    reasons.push(t.search);
  return [
    t.available(`**${name}**`, price),
    ...(reasons.length ? [t.matches(reasons.slice(0, 3))] : []),
  ].join(" ");
}
