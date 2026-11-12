import { of, throwError } from "rxjs";
import { ClientProxy } from "@nestjs/microservices";
import { readFileSync } from "fs";
import {
  ConciergeMenuAdapter,
  MAX_AI_FOOD_RESULTS,
} from "../adapters/menu.adapter";
import { configSchema } from "../config/config.schema";
import { MenuToolsService, scopeTools } from "./menu-tools.service";
import { cardSchemas, foodCardSchema } from "./cards.schema";
import { EffectiveContext } from "../preferences/effective-preferences.service";
const config = {
  ...configSchema.parse(
    JSON.parse(readFileSync("prisma/ai-concierge-config.json", "utf8")),
  ),
  version: "v1",
};
const context: EffectiveContext = {
  configVersion: "v1",
  preferenceProfileId: null,
  profileRevision: null,
  accountRevision: 1,
  profileAnswers: {},
  accountAnswers: {},
  temporaryAnswers: {},
  preferredCategoryIds: [],
  restrictions: {
    allergens: [],
    diets: [],
    budgets: [],
    allergyState: "unknown",
  },
};
const food = {
  id: "real-id",
  name: { en: "Meal" },
  description: { en: "Restaurant description" },
  price: 12.5,
  currency: "GBP",
  isFoodAvailable: true,
  images: [],
  modifierGroups: [],
  dietaryInfo: null,
};
describe("Concierge menu tools and structured cards", () => {
  const send = jest.fn();
  const adapter = new ConciergeMenuAdapter({ send } as unknown as ClientProxy);
  const service = new MenuToolsService(adapter);
  beforeEach(() => send.mockReset());
  it("searches with card projections, accepts image URL lists, and caps results at 6", async () => {
    // Card projection: no images objects, no modifier groups.
    const card = (id: string, price: number) => ({
      id,
      name: { en: `Dish ${id}` },
      description: { en: "Restaurant description" },
      price,
      currency: "GBP",
      isFoodAvailable: true,
      image: [`https://img.example.com/${id}.jpg`],
      dietaryInfo: null,
    });
    send.mockReturnValue(
      of({
        items: Array.from({ length: 10 }, (_, i) => card(`f${i}`, 10 - i)),
        nextCursor: null,
      }),
    );
    const result = await adapter.search(
      undefined,
      { ...config, chatLimits: { ...config.chatLimits, toolResults: 20 } },
      context,
      "en",
    );
    expect(send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        hideAppetizerOptions: true,
        hideFulfillmentOptions: true,
        hideImages: true,
        hideModifierGroups: true,
        hideSideOptions: true,
        hideSizeOptions: true,
      }),
    );
    expect(MAX_AI_FOOD_RESULTS).toBe(6);
    expect(result.foods).toHaveLength(6);
    expect(result.foods[0].images).toEqual(["https://img.example.com/f9.jpg"]);
  });
  it("returns deals and hot combos as badged food cards", async () => {
    const bundle = (id: string, extra: object = {}) => ({
      ...food,
      id,
      name: { en: id },
      image: [`https://img.example.com/${id}.jpg`],
      images: undefined,
      ...extra,
    });
    send.mockImplementation((pattern) =>
      of(
        pattern.includes("Deals")
          ? {
              items: [
                {
                  id: "deal-1",
                  imageUrl: "https://img.example.com/deal-1-banner.jpg",
                  offerDelivery: { en: "Delivery only" },
                  foodItem: bundle("twin-deal"),
                },
                // No linked food: cannot be customised, so it is skipped.
                { id: "deal-2", foodItem: null },
                ...Array.from({ length: 8 }, (_, i) => ({
                  id: `deal-x${i}`,
                  foodItem: bundle(`deal-food-${i}`),
                })),
              ],
              nextCursor: null,
            }
          : {
              items: [
                {
                  id: "combo-1",
                  categoryLabel: { en: "Pizza combo" },
                  foodItem: bundle("meal-for-1"),
                },
              ],
              nextCursor: null,
            },
      ),
    );
    const deals = await adapter.offers(
      undefined,
      "deal",
      config,
      context,
      "en",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining("Deals"),
      expect.objectContaining({ hideModifierGroups: true, hideImages: true }),
    );
    expect(deals.foods).toHaveLength(6);
    expect(deals.foods[0]).toMatchObject({
      id: "twin-deal",
      kind: "deal",
      offer: { id: "deal-1", label: "Delivery only" },
      images: [
        "https://img.example.com/deal-1-banner.jpg",
        "https://img.example.com/twin-deal.jpg",
      ],
      customisationStatus: "details-required",
    });
    expect(cardSchemas["data-food-recommendations"].parse(deals)).toBeTruthy();

    send.mockClear();
    const combos = await adapter.offers(
      undefined,
      "combo",
      config,
      context,
      "en",
    );
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining("Combo"),
      expect.anything(),
    );
    expect(combos.foods).toEqual([
      expect.objectContaining({
        id: "meal-for-1",
        kind: "combo",
        offer: { id: "combo-1", label: "Pizza combo" },
      }),
    ]);
  });
  it("keeps older saved cards valid with a food badge", () => {
    const saved = foodCardSchema.parse({
      id: "old",
      name: "Old card",
      description: null,
      price: { amountMinor: 100, currency: "GBP" },
      available: true,
      images: [],
      dietaryInfo: null,
      informationStatus: "unknown",
      modifierGroups: [],
      sizes: null,
      extras: null,
    });
    expect(saved).toMatchObject({ kind: "food", offer: null });
  });
  it("limits tools to the chat input's search scope", async () => {
    send.mockReturnValue(of({ items: [], nextCursor: null }));
    const tools = service.create(
      config,
      context,
      "en",
      jest.fn(),
      new AbortController().signal,
    );
    expect(Object.keys(scopeTools(tools, "all")).sort()).toEqual([
      "getFoodDetails",
      "getRecommendations",
      "searchMenu",
      "searchOffers",
    ]);
    expect(Object.keys(scopeTools(tools, "food")).sort()).toEqual([
      "getFoodDetails",
      "getRecommendations",
      "searchMenu",
    ]);
    const combo = scopeTools(tools, "combo");
    expect(Object.keys(combo).sort()).toEqual([
      "getFoodDetails",
      "searchOffers",
    ]);
    // The model cannot widen a combo-only search to deals.
    await combo.searchOffers!.execute!(
      { showCard: false, kind: "deal" },
      {} as never,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("Combo");
  });
  it("ranks foods whose name matches the query above option or description matches", async () => {
    send.mockReturnValue(
      of({
        items: [
          // Cheaper, but only matched through an option (e.g. a naan bread).
          { ...food, id: "doner", name: { en: "Lamb Doner" }, price: 6 },
          {
            ...food,
            id: "desc",
            name: { en: "Mix Special" },
            description: { en: "Served with garlic naan" },
            price: 7,
          },
          { ...food, id: "naan", name: { en: "Garlic Naan" }, price: 9 },
        ],
        nextCursor: null,
      }),
    );
    const result = await adapter.search("naan", config, context, "en");
    expect(result.foods.map((f) => f.id)).toEqual(["naan", "desc", "doner"]);
  });
  it("builds validated detail and recommendation parts exclusively from menu RPC results", async () => {
    send.mockImplementation((pattern) =>
      of(
        pattern.includes("getFoodById")
          ? food
          : { items: [food], nextCursor: null },
      ),
    );
    const emit = jest.fn();
    const tools = service.create(
      config,
      context,
      "en",
      emit,
      new AbortController().signal,
    );
    await tools.getFoodDetails.execute!(
      { foodId: "real-id", showCard: true },
      {} as never,
    );
    await tools.searchMenu.execute!({ showCard: true }, {} as never);
    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      "data-food-details",
      "data-food-recommendations",
    ]);
    for (const [type, value] of emit.mock.calls)
      expect(
        cardSchemas[type as keyof typeof cardSchemas].safeParse(value).success,
      ).toBe(true);
    expect(emit.mock.calls[0][1].food.price.amountMinor).toBe(1250);
    expect(emit.mock.calls[0][1].food.informationStatus).toBe("unknown");
    expect(emit.mock.calls[1][1].foods[0].recommendationReason).toMatch(
      /\*\*Meal\*\*.*£12\.50/,
    );
  });
  it("returns menu data without repeating a card for conversational follow-ups", async () => {
    send.mockReturnValue(of({ items: [food], nextCursor: null }));
    const emit = jest.fn();
    const tools = service.create(
      config,
      context,
      "en",
      emit,
      new AbortController().signal,
    );

    const result = await tools.searchMenu.execute!(
      { query: "pizza", showCard: false },
      {} as never,
    );

    expect(result).toMatchObject({
      foods: [expect.objectContaining({ id: food.id })],
    });
    expect(emit).not.toHaveBeenCalled();
  });
  it("does not return details for unavailable or restricted/unknown-allergen foods", async () => {
    send.mockReturnValue(of(food));
    const emit = jest.fn();
    const tools = service.create(
      config,
      {
        ...context,
        restrictions: { ...context.restrictions, allergens: ["milk"] },
      },
      "en",
      emit,
      new AbortController().signal,
    );
    const result = await tools.getFoodDetails.execute!(
      { foodId: "real-id", showCard: true },
      {} as never,
    );
    expect(result).toHaveProperty("error");
    expect(emit).not.toHaveBeenCalled();
  });
  it("reports an empty eligible set without inventing food or allergen facts", async () => {
    send.mockReturnValue(of({ items: [food], nextCursor: null }));
    const emit = jest.fn();
    const tools = service.create(
      config,
      {
        ...context,
        restrictions: { ...context.restrictions, diets: ["vegan"] },
      },
      "en",
      emit,
      new AbortController().signal,
    );
    const result = await tools.getRecommendations.execute!(
      { showCard: true },
      {} as never,
    );
    expect(result).toMatchObject({ foods: [] });
    expect(result).toMatchObject({
      disclaimer: "",
      missingInformation: [
        expect.stringContaining("missing dietary information"),
      ],
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("distinguishes known dietary conflicts from missing declarations and no search matches", async () => {
    const ctx = {
      ...context,
      restrictions: { ...context.restrictions, diets: ["vegan"] },
    };
    send.mockReturnValue(
      of({
        items: [
          {
            ...food,
            dietaryInfo: {
              dietaryTags: [],
              allergensKnown: true,
              allergens: [],
              mayContain: [],
              crossContact: "controlled",
            },
          },
        ],
        nextCursor: null,
      }),
    );
    expect(await adapter.search(undefined, config, ctx, "en")).toMatchObject({
      foods: [],
      disclaimer: "",
      missingInformation: [
        "Matching meals do not meet all of your saved dietary requirements.",
      ],
    });
    send.mockReturnValue(of({ items: [], nextCursor: null }));
    expect(
      await adapter.search("missing dish", config, ctx, "en"),
    ).toMatchObject({
      foods: [],
      scanned: 0,
      missingInformation: [],
    });
  });
  it("bounds menu scans, tool calls and cumulative result size", async () => {
    send.mockReturnValue(of({ items: [food], nextCursor: "next" }));
    const emit = jest.fn();
    const tools = service.create(
      {
        ...config,
        chatLimits: {
          ...config.chatLimits,
          menuScanPages: 1,
          toolSteps: 1,
          contextCharacters: 2000,
        },
      },
      context,
      "en",
      emit,
      new AbortController().signal,
    );
    const result: any = await tools.searchMenu.execute!(
      { showCard: true },
      {} as never,
    );
    expect(result.truncated).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    await tools.searchMenu.execute!({ showCard: true }, {} as never);
    await tools.searchMenu.execute!({ showCard: true }, {} as never);
    expect(
      await tools.searchMenu.execute!({ showCard: true }, {} as never),
    ).toEqual({
      error: "AI_TOOL_LIMIT",
    });
  });
  it("sanitizes menu errors and handles cancellation without emitting cards", async () => {
    send.mockReturnValue(throwError(() => new Error("private credentials")));
    const emit = jest.fn();
    const tools = service.create(
      config,
      context,
      "en",
      emit,
      new AbortController().signal,
    );
    expect(
      JSON.stringify(
        await tools.searchMenu.execute!({ showCard: true }, {} as never),
      ),
    ).not.toContain("private credentials");
    const abort = new AbortController();
    abort.abort();
    const cancelled = service.create(config, context, "en", emit, abort.signal);
    expect(
      await cancelled.searchMenu.execute!({ showCard: true }, {} as never),
    ).toEqual({ error: "AI_CANCELLED" });
    expect(emit).not.toHaveBeenCalled();
  });
  it("normalizes sizes and extras into validated localized minor-unit prices", async () => {
    const mapped = adapter.map(
      {
        ...food,
        sizeOptions: [
          {
            id: "small",
            label: { en: "Small" },
            measurementLabel: "Single",
            priceOffset: -2,
          },
        ],
        sideOptions: [
          {
            id: "rings",
            name: { en: "Onion rings" },
            description: "Side",
            price: 2.25,
          },
        ],
        appetizerOptions: [],
      },
      "en",
    );
    expect(mapped.sizes?.[0]).toMatchObject({
      label: "Small",
      priceOffset: { amountMinor: -200, currency: "GBP" },
    });
    expect(mapped.extras?.sides?.[0].price).toEqual({
      amountMinor: 225,
      currency: "GBP",
    });
    expect(mapped.customisationStatus).toBe("available");
    const invalid = adapter.map(
      { ...food, sizeOptions: { component: "untrusted" } },
      "en",
    );
    expect(invalid.sizes).toBeNull();
    expect(invalid.customisationStatus).toBe("unknown");
  });
  it("queries preferred categories, ranks eligible preferred food first and broadens when needed", async () => {
    const c = structuredClone(config);
    const question = c.questions.find(
      (q) => q.optionSource === "menu-categories",
    )!;
    question.options = [
      { id: "favorite", label: { en: "Favorite" }, exclusive: false },
      { id: "other", label: { en: "Other" }, exclusive: false },
    ];
    const preferred = {
      ...food,
      id: "preferred-food",
      categoryId: "favorite",
      price: 20,
    };
    const other = { ...food, id: "other-food", categoryId: "other", price: 5 };
    send.mockImplementation((_pattern, payload) =>
      of({
        items:
          payload.categoryId === "favorite" ? [preferred] : [other, preferred],
        nextCursor: null,
      }),
    );
    const result = await adapter.search(
      undefined,
      c,
      { ...context, preferredCategoryIds: ["favorite"] },
      "en",
    );
    expect(send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ categoryId: "favorite" }),
    );
    expect(result.foods.map((f) => f.id)).toEqual([
      "preferred-food",
      "other-food",
    ]);
    expect(result.foods.every((f) => f.recommendationReason?.trim())).toBe(
      true,
    );
    expect(result.foods[0].recommendationReason).toContain(
      "favourite category",
    );
    expect(result.foods[1].recommendationReason).not.toContain(
      "favourite category",
    );
    expect(result.foods[0].recommendationReason).not.toBe(
      result.foods[1].recommendationReason,
    );
    send.mockClear();
    const override = await adapter.search(
      "other",
      c,
      { ...context, preferredCategoryIds: ["favorite"] },
      "en",
      { usePreferredCategories: false },
    );
    expect(override.foods[0].id).toBe("other-food");
    expect(send.mock.calls.every((c) => c[1].categoryId === undefined)).toBe(
      true,
    );
  });
  it("uses explicit validated category filters while keeping allergies and diets authoritative", async () => {
    const c = structuredClone(config);
    c.questions.find((q) => q.optionSource === "menu-categories")!.options = [
      { id: "favorite", label: { en: "Favorite" }, exclusive: false },
      { id: "other", label: { en: "Other" }, exclusive: false },
    ];
    const unsafe = { ...food, id: "unsafe-favorite", categoryId: "favorite" };
    const safe = {
      ...food,
      id: "safe-other",
      categoryId: "other",
      dietaryInfo: {
        dietaryTags: ["vegan"],
        allergensKnown: true,
        allergens: [],
        mayContain: [],
        crossContact: "controlled",
      },
    };
    send.mockImplementation((_p, input) =>
      of({
        items: input.categoryId === "favorite" ? [unsafe] : [safe, unsafe],
        nextCursor: null,
      }),
    );
    const ctx = {
      ...context,
      preferredCategoryIds: ["favorite"],
      restrictions: {
        ...context.restrictions,
        allergens: ["milk"],
        diets: ["vegan"],
      },
    };
    expect(
      (await adapter.search(undefined, c, ctx, "en")).foods.map((f) => f.id),
    ).toEqual(["safe-other"]);
    send.mockClear();
    const explicit = await adapter.search(undefined, c, ctx, "en", {
      categoryIds: ["other"],
    });
    expect(explicit.foods.map((f) => f.id)).toEqual(["safe-other"]);
    expect(send.mock.calls.every((c) => c[1].categoryId === "other")).toBe(
      true,
    );
    send.mockClear();
    await expect(
      adapter.search(
        undefined,
        c,
        { ...ctx, preferredCategoryIds: ["retired"] },
        "en",
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
