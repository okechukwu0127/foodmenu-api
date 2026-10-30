import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout } from "rxjs";
import { MENU_PATTERNS } from "@app/common";
import { z } from "zod";
import {
  dietaryInfoSchema,
  FoodCard,
  foodCardSchema,
} from "../tools/cards.schema";
import { fail } from "../persistence/contracts";
import { EffectiveContext } from "../preferences/effective-preferences.service";
import { ConciergeConfig } from "../config/config.schema";
import { recommendationReason } from "./recommendation-reason";

const localized = (value: unknown, locale: string): string | null => {
  const selected =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? ((value as Record<string, unknown>)[locale] ??
          (value as Record<string, unknown>).en)
        : null;
  return typeof selected === "string" ? selected.slice(0, 1000) : null;
};
const rawFood = z.object({
  id: z.string().max(128),
  categoryId: z.string().min(1).max(128).optional(),
  name: z.unknown(),
  description: z.unknown(),
  currency: z.string().regex(/^[A-Z]{3}$/i),
  price: z.number().finite().nonnegative(),
  isFoodAvailable: z.boolean(),
  images: z.array(z.object({ url: z.string().max(1000) })).max(50),
  dietaryInfo: z.unknown().optional(),
  modifierGroups: z.array(z.any()).max(50),
  sizeOptions: z.unknown().optional(),
  appetizerOptions: z.unknown().optional(),
  sideOptions: z.unknown().optional(),
});
export function exclusionReasons(
  food: FoodCard,
  context: EffectiveContext,
): string[] {
  const r = context.restrictions;
  const reasons: string[] = [];
  if (!food.available)
    reasons.push("Matching meals are currently unavailable.");
  if (
    r.budgets.some(
      (b) =>
        b.currency !== food.price.currency ||
        food.price.amountMinor > b.maxMinor,
    )
  )
    reasons.push("Matching meals do not fit your saved budget and currency.");
  if (r.diets.some((d) => !food.dietaryInfo?.dietaryTags.includes(d)))
    reasons.push(
      food.dietaryInfo
        ? "Matching meals do not meet all of your saved dietary requirements."
        : "The menu is missing dietary information needed to check your saved dietary requirements.",
    );
  if (r.allergens.length) {
    const info = food.dietaryInfo;
    if (!info?.allergensKnown || info.crossContact !== "controlled")
      reasons.push(
        "The menu is missing the ingredient or cross-contact information needed to check your saved allergies.",
      );
    else if (
      r.allergens.some(
        (a) => info.allergens.includes(a) || info.mayContain.includes(a),
      )
    )
      reasons.push(
        "Matching meals list an allergen or possible cross-contact that conflicts with your saved allergies.",
      );
  }
  return reasons;
}
export function eligible(food: FoodCard, context: EffectiveContext): boolean {
  return exclusionReasons(food, context).length === 0;
}
@Injectable()
export class ConciergeMenuAdapter {
  constructor(
    @Inject("AI_MENU_SERVICE") private readonly client: ClientProxy,
  ) {}
  private async send(pattern: string, payload: unknown) {
    try {
      return await firstValueFrom(
        this.client.send(pattern, payload).pipe(timeout(5000)),
      );
    } catch {
      fail("AI_MENU_UNAVAILABLE", "Menu information is unavailable", 503);
    }
  }
  map(value: unknown, locale: string): FoodCard {
    const parsed = rawFood.safeParse(value);
    if (!parsed.success)
      fail(
        "AI_MENU_INVALID",
        "The menu returned unsupported food information",
        503,
      );
    const f = parsed.data;
    const dietary = dietaryInfoSchema.safeParse(f.dietaryInfo);
    const currency = f.currency.toUpperCase();
    // The existing public menu RPC returns major units, including modifier offsets.
    const amount = (v: number) => Math.round(v * 100);
    const sizes = z
      .array(
        z.object({
          id: z.string(),
          label: z.unknown(),
          measurementLabel: z.unknown().optional(),
          priceOffset: z.number().finite(),
        }),
      )
      .max(50)
      .safeParse(f.sizeOptions);
    const rawExtra = z
      .array(
        z.object({
          id: z.string(),
          name: z.unknown(),
          description: z.unknown().optional(),
          price: z.number().finite().nonnegative(),
          image: z.string().optional(),
          unitLabel: z.unknown().optional(),
        }),
      )
      .max(50);
    const sides = rawExtra.safeParse(f.sideOptions),
      appetizers = rawExtra.safeParse(f.appetizerOptions);
    const extra = (e: z.infer<typeof rawExtra>[number]) => ({
      id: e.id,
      name: localized(e.name, locale),
      description: localized(e.description, locale),
      price: { amountMinor: amount(e.price), currency },
      image: e.image && /^https?:\/\//.test(e.image) ? e.image : null,
      unitLabel: localized(e.unitLabel, locale),
    });
    const card = {
      id: f.id,
      categoryId: f.categoryId ?? null,
      name: localized(f.name, locale),
      description: localized(f.description, locale),
      price: { amountMinor: amount(f.price), currency },
      available: f.isFoodAvailable,
      images: f.images.map((i) => i.url).filter((u) => /^https?:\/\//.test(u)),
      dietaryInfo: dietary.success ? dietary.data : null,
      informationStatus: dietary.success ? "restaurant-declared" : "unknown",
      modifierGroups: f.modifierGroups.map((g) => ({
        id: g.id,
        title: localized(g.name ?? g.title, locale),
        selectionType: g.selectionType,
        minSelections: g.minSelections,
        maxSelections: g.maxSelections ?? null,
        required: Boolean(g.required ?? g.isRequired),
        options: (g.options ?? []).slice(0, 50).map((o: any) => ({
          id: o.id,
          name: localized(o.name, locale),
          description: localized(o.description, locale),
          price: { amountMinor: amount(o.priceOffset), currency },
        })),
      })),
      customisationStatus:
        sizes.success && sides.success && appetizers.success
          ? "available"
          : "unknown",
      sizes: sizes.success
        ? sizes.data.map((s) => ({
            id: s.id,
            label: localized(s.label, locale),
            measurementLabel: localized(s.measurementLabel, locale),
            priceOffset: { amountMinor: amount(s.priceOffset), currency },
          }))
        : null,
      extras: {
        sides: sides.success ? sides.data.map(extra) : null,
        appetizers: appetizers.success ? appetizers.data.map(extra) : null,
      },
    };
    const result = foodCardSchema.safeParse(card);
    if (!result.success)
      fail("AI_MENU_INVALID", "Menu customisation information is invalid", 503);
    return result.data;
  }
  async search(
    query: string | undefined,
    config: ConciergeConfig,
    context: EffectiveContext,
    locale: string,
    options: { categoryIds?: string[]; usePreferredCategories?: boolean } = {},
  ) {
    const activeIds = new Set(
      config.questions
        .filter((q) => q.optionSource === "menu-categories")
        .flatMap((q) => q.options.map((o) => o.id)),
    );
    const preferredIds =
      options.usePreferredCategories === false
        ? []
        : (context.preferredCategoryIds ?? []);
    const requestedIds = options.categoryIds;
    if (
      [...preferredIds, ...(requestedIds ?? [])].some(
        (id) => !activeIds.has(id),
      )
    )
      fail(
        "AI_INVALID_ANSWER",
        "A selected food category is unavailable. Review your preferences.",
        400,
        { requiresPreferenceReview: true },
      );
    const preferred = new Set(requestedIds ?? preferredIds);
    // Reserve an unrestricted scan for soft tastes. Explicit category filters
    // apply to this request only and never bypass dietary/allergy eligibility.
    const maxPages = config.chatLimits.menuScanPages;
    const categoryFilters: (string | undefined)[] = requestedIds?.length
      ? [...new Set(requestedIds)]
      : preferredIds.length && maxPages > 1
        ? [...preferredIds.slice(0, maxPages - 1), undefined]
        : [undefined];
    const queue = categoryFilters.map((categoryId) => ({
      categoryId,
      page: 1,
    }));
    let scanned = 0,
      truncated =
        (requestedIds?.length ?? 0) > maxPages ||
        (!requestedIds && preferredIds.length > Math.max(0, maxPages - 1));
    const foods: FoodCard[] = [],
      seen = new Set<string>();
    const exclusions = new Set<string>();
    for (let attempt = 0; attempt < maxPages && queue.length; attempt++) {
      const source = queue.shift()!;
      const response = await this.send(MENU_PATTERNS.GET_FOODS, {
        search: query,
        ...(source.categoryId ? { categoryId: source.categoryId } : {}),
        page: source.page,
        limit: 50,
      });
      if (!Array.isArray(response?.items))
        fail("AI_MENU_INVALID", "Invalid menu results", 503);
      for (const raw of response.items.slice(0, 50)) {
        const food = this.map(raw, locale);
        scanned++;
        // Defensively enforce the filter even if a menu response is malformed.
        if (source.categoryId && food.categoryId !== source.categoryId)
          continue;
        const reasons = exclusionReasons(food, context);
        reasons.forEach((reason) => exclusions.add(reason));
        if (!seen.has(food.id) && !reasons.length) {
          seen.add(food.id);
          foods.push(food);
        }
      }
      if (response.nextCursor) queue.push({ ...source, page: source.page + 1 });
    }
    truncated = truncated || queue.length > 0;
    foods.sort(
      (a, b) =>
        Number(preferred.has(b.categoryId ?? "")) -
          Number(preferred.has(a.categoryId ?? "")) ||
        a.price.amountMinor - b.price.amountMinor ||
        a.id.localeCompare(b.id),
    );
    return {
      version: 1 as const,
      foods: foods.slice(0, config.chatLimits.toolResults).map((f) => ({
        ...f,
        recommendationReason: recommendationReason(f, context, locale, {
          categories: preferred,
          explicitCategory: Boolean(requestedIds?.length),
          query,
        }),
        customisationStatus: "details-required" as const,
        modifierGroups: [],
        sizes: null,
        extras: null,
      })),
      scanned,
      truncated,
      missingInformation: foods.length ? [] : [...exclusions],
      // Preserve the existing card shape without displaying a blanket warning.
      disclaimer: "",
    };
  }
  async details(id: string, context: EffectiveContext, locale: string) {
    const food = this.map(
      await this.send(MENU_PATTERNS.GET_FOOD_BY_ID, id),
      locale,
    );
    if (!eligible(food, context))
      fail(
        "AI_FOOD_NOT_ELIGIBLE",
        "Food is unavailable, conflicts with explicit restrictions, or lacks required dietary/allergen information",
        409,
      );
    return {
      version: 1 as const,
      food,
      disclaimer: "",
    };
  }
}
