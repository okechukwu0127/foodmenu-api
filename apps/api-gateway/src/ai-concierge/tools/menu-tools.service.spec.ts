import { of, throwError } from "rxjs";
import { ClientProxy } from "@nestjs/microservices";
import { readFileSync } from "fs";
import { ConciergeMenuAdapter } from "../adapters/menu.adapter";
import { configSchema } from "../config/config.schema";
import { MenuToolsService } from "./menu-tools.service";
import { cardSchemas } from "./cards.schema";
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
    await tools.getFoodDetails.execute!({ foodId: "real-id" }, {} as never);
    await tools.searchMenu.execute!({}, {} as never);
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
      { foodId: "real-id" },
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
    const result = await tools.getRecommendations.execute!({}, {} as never);
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
    const result: any = await tools.searchMenu.execute!({}, {} as never);
    expect(result.truncated).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    await tools.searchMenu.execute!({}, {} as never);
    await tools.searchMenu.execute!({}, {} as never);
    expect(await tools.searchMenu.execute!({}, {} as never)).toEqual({
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
      JSON.stringify(await tools.searchMenu.execute!({}, {} as never)),
    ).not.toContain("private credentials");
    const abort = new AbortController();
    abort.abort();
    const cancelled = service.create(config, context, "en", emit, abort.signal);
    expect(await cancelled.searchMenu.execute!({}, {} as never)).toEqual({
      error: "AI_CANCELLED",
    });
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
