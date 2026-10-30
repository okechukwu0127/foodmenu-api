import { readFileSync } from "fs";
import { PrismaService } from "@app/database";
import { ConciergeConfigService } from "./config.service";
import { ConciergeCategoryOptionsService } from "./category-options.service";
import { configSchema, ConciergeConfig } from "./config.schema";
import { EffectivePreferencesService } from "../preferences/effective-preferences.service";
import { eligible } from "../adapters/menu.adapter";
import { foodCardSchema } from "../tools/cards.schema";

const seed = () =>
  JSON.parse(readFileSync("prisma/ai-concierge-config.json", "utf8"));
const config = (): ConciergeConfig => ({
  ...configSchema.parse(seed()),
  version: "test-v1",
});
describe("Stored concierge configuration and restrictions", () => {
  const service = new ConciergeConfigService(
    {} as PrismaService,
    {} as ConciergeCategoryOptionsService,
  );
  it("validates the shipped seed and exposes localized data without private fields", () => {
    const publicData = service.public(config(), "en");
    expect(publicData.content.welcome).toBe(seed().content.welcome.en);
    expect(JSON.stringify(publicData)).not.toMatch(/API_KEY|systemPrompt/);
    expect(() => configSchema.parse({ ...seed(), apiKey: "secret" })).toThrow();
    expect(() =>
      configSchema.parse({
        ...seed(),
        content: {
          welcome: { en: "<script>bad</script>" },
          explanation: { en: "text" },
        },
      }),
    ).toThrow();
  });
  it("reads newly stored option IDs and enforces their rules without source-code changes", () => {
    const c = config();
    c.questions
      .find((q) => q.id === "spice")!
      .options.push({
        id: "restaurant-special",
        label: { en: "Special" },
        exclusive: false,
      });
    expect(
      service.validate(
        c,
        c.version,
        { spice: "restaurant-special" },
        "profile",
      ),
    ).toEqual({ spice: "restaurant-special" });
    expect(() =>
      service.validate(c, c.version, { spice: "invented" }, "profile"),
    ).toThrow();
    expect(() =>
      service.validate(c, c.version, { unknown: true }, "profile"),
    ).toThrow();
    expect(() =>
      service.validate(c, c.version, { allergies: ["milk"] }, "profile"),
    ).toThrow();
  });
  it("localizes chat greetings, starter labels and prompts with default-locale fallback", () => {
    const stored = seed();
    stored.supportedLocales.push("fr");
    stored.content.chatGreeting.fr = "Bonjour !";
    stored.content.chatStarters[0].label.fr = "Un plat épicé";
    stored.content.chatStarters[0].prompt.fr = "Recommande un plat épicé.";
    const c = { ...configSchema.parse(stored), version: "localized" };
    const content = service.public(c, "fr").content;
    expect(content.chatGreeting).toBe("Bonjour !");
    expect(content.chatStarters![0]).toEqual({
      id: "something-spicy",
      label: "Un plat épicé",
      prompt: "Recommande un plat épicé.",
      icon: "flame",
    });
    expect(content.chatStarters![1].prompt).toBe(
      stored.content.chatStarters[1].prompt.en,
    );
    expect(service.public(c, "en").content.chatGreeting).toContain("\n");
    expect(JSON.stringify(content)).not.toContain('"en":');
  });
  it("keeps older configurations without empty-chat fields valid", () => {
    const stored = seed();
    delete stored.content.chatGreeting;
    delete stored.content.chatStarters;
    const c = { ...configSchema.parse(stored), version: "legacy" };
    const content = service.public(c, "en").content;
    expect(content).not.toHaveProperty("chatGreeting");
    expect(content).not.toHaveProperty("chatStarters");
  });
  it("rejects ambiguous, missing-default and unsafe starter definitions", () => {
    for (const change of [
      (s: any) => s.content.chatStarters.push(s.content.chatStarters[0]),
      (s: any) => {
        s.content.chatGreeting = { fr: "Bonjour" };
      },
      (s: any) => {
        s.content.chatStarters[0].prompt = { fr: "Bonjour" };
      },
      (s: any) => {
        s.content.chatStarters[0].label.en = "<script>bad</script>";
      },
      (s: any) => {
        s.content.chatStarters[0].icon = "javascript:alert(1)";
      },
      (s: any) => {
        s.content.chatStarters[0].action = "checkout";
      },
    ]) {
      const stored = seed();
      change(stored);
      expect(configSchema.safeParse(stored).success).toBe(false);
    }
  });
  it("rejects stale configuration, exclusive combinations, duplicate options and temporary allergy clearing", () => {
    const c = config();
    for (const value of [
      { allergies: ["none-known", "milk"] },
      { allergies: ["milk", "milk"] },
    ])
      expect(() => service.validate(c, c.version, value, "account")).toThrow();
    expect(() => service.validate(c, "old", {}, "account")).toThrow();
    expect(() =>
      service.validate(
        c,
        c.version,
        { allergies: ["none-known"] },
        "temporary",
        true,
      ),
    ).toThrow();
  });
  it("enforces configured number, boolean, text, required and selection limits", () => {
    const c = config();
    expect(() =>
      service.validate(c, c.version, { servings: 21 }, "profile"),
    ).toThrow();
    expect(() =>
      service.validate(c, c.version, { servings: "2" }, "profile"),
    ).toThrow();
    c.questions.push({
      id: "notes",
      scope: "profile",
      input: "text",
      label: { en: "Notes" },
      required: true,
      options: [],
      limits: { maxLength: 5 },
    });
    expect(() => service.validate(c, c.version, {}, "profile")).toThrow();
    expect(() =>
      service.validate(c, c.version, { notes: "too long" }, "profile"),
    ).toThrow();
    c.questions.push({
      id: "cutlery",
      scope: "profile",
      input: "boolean",
      label: { en: "Cutlery" },
      required: false,
      options: [],
      limits: {},
    });
    expect(
      service.validate(
        c,
        c.version,
        { notes: "hello", cutlery: false },
        "profile",
      ),
    ).toMatchObject({ cutlery: false });
    expect(() =>
      service.validate(
        c,
        c.version,
        { notes: "hello", cutlery: "false" },
        "profile",
      ),
    ).toThrow();
  });
  it("unions account restrictions with temporary and occasion restrictions", () => {
    const effective = new EffectivePreferencesService(service);
    const result = effective.derive(config(), [
      { allergies: ["milk"], diet: ["vegan"] },
      { "occasion-diet": ["halal"] },
      { allergies: ["peanuts"] },
    ]);
    expect(result).toMatchObject({
      allergens: ["milk", "peanuts"],
      diets: ["halal", "vegan"],
      allergyState: "restricted",
    });
    expect(effective.derive(config(), [{}]).allergyState).toBe("unknown");
    expect(effective.derive(config(), [{ allergies: [] }]).allergyState).toBe(
      "unknown",
    );
    expect(
      effective.derive(config(), [{ allergies: ["none-known"] }]).allergyState,
    ).toBe("none-known");
  });
  it("allows a chat when an account has empty outdated preferences and a deleted default profile", async () => {
    const effective = new EffectivePreferencesService(service);
    const tx = {
      aiCustomerState: {
        findUniqueOrThrow: async () => ({
          defaultProfileId: "deleted-profile",
          accountRevision: 3,
          accountConfigVersion: "old-version",
          accountAnswers: {},
        }),
      },
      aiPreferenceProfile: { findFirst: async () => null },
    };

    const context = await effective.build(tx as never, config(), "customer", undefined);

    expect(context).toMatchObject({
      preferenceProfileId: null,
      profileAnswers: {},
      accountAnswers: {},
      restrictions: { allergyState: "unknown", allergens: [] },
    });
    await expect(
      effective.build(tx as never, config(), "customer", "deleted-profile"),
    ).rejects.toMatchObject({ code: "AI_PROFILE_NOT_FOUND" });
  });
  it("excludes unknown allergens, cross-contact risks, unavailable foods and incompatible budgets", () => {
    const food = foodCardSchema.parse({
      id: "food",
      name: "Meal",
      description: null,
      price: { amountMinor: 1000, currency: "GBP" },
      available: true,
      images: [],
      dietaryInfo: null,
      informationStatus: "unknown",
      modifierGroups: [],
      sizes: null,
      extras: null,
    });
    const context: any = {
      restrictions: { allergens: ["milk"], diets: [], budgets: [] },
    };
    expect(eligible(food, context)).toBe(false);
    food.dietaryInfo = {
      dietaryTags: ["vegan"],
      allergensKnown: true,
      allergens: [],
      mayContain: [],
      crossContact: "controlled",
    };
    expect(eligible(food, context)).toBe(true);
    food.dietaryInfo.mayContain = ["milk"];
    expect(eligible(food, context)).toBe(false);
    context.restrictions = { allergens: [], diets: ["halal"], budgets: [] };
    expect(eligible(food, context)).toBe(false);
    context.restrictions = {
      allergens: [],
      diets: [],
      budgets: [{ currency: "GBP", maxMinor: 500 }],
    };
    expect(eligible(food, context)).toBe(false);
  });
});
