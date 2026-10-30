import { ConfigService } from "@nestjs/config";
import { ClientProxy } from "@nestjs/microservices";
import { PrismaService } from "@app/database";
import { of, throwError } from "rxjs";
import { readFileSync } from "fs";
import { MENU_PATTERNS } from "@app/common";
import { ConciergeCategoryOptionsService } from "./category-options.service";
import { ConciergeConfigService } from "./config.service";
import { configSchema } from "./config.schema";

const seed = () =>
  JSON.parse(readFileSync("prisma/ai-concierge-config.json", "utf8"));
const category = (id: string, sortOrder = 0) => ({
  id,
  slug: id,
  sortOrder,
  name: { en: id.toUpperCase() },
  displayName: null,
  imageUrl: `/assets/${id}.webp`,
  icon: "restaurant",
});
describe("Dynamic menu category configuration", () => {
  const send = jest.fn();
  const settings = new ConfigService({
    NODE_ENV: "development",
    PUBLIC_ASSET_BASE_URL: "http://localhost:4000",
  });
  const loader = new ConciergeCategoryOptionsService(
    { send } as unknown as ClientProxy,
    settings,
  );
  beforeEach(() => send.mockReset());
  it("uses the category RPC, active rows and deterministic ordering", async () => {
    send.mockReturnValue(
      of([
        category("z", 1),
        category("b"),
        category("a"),
        { ...category("inactive"), isActive: false },
      ]),
    );
    const result = await loader.load({
      supportedLocales: ["en"],
      defaultLocale: "en",
    });
    expect(send).toHaveBeenCalledWith(MENU_PATTERNS.GET_CATEGORIES, {});
    expect(result.options.map((o) => o.id)).toEqual(["a", "b", "z"]);
    expect(result.options[0]).toMatchObject({
      label: { en: "A" },
      image: "http://localhost:4000/assets/a.webp",
      icon: "restaurant",
      exclusive: false,
    });
  });
  it("resolves requested/default/display/slug labels and returns no missing labels", async () => {
    send.mockReturnValue(
      of([
        { ...category("a"), name: { fr: "Français", en: "English" } },
        { ...category("b"), name: { en: "Default" } },
        { ...category("c"), name: {}, displayName: "Display" },
        {
          ...category("d"),
          name: null,
          displayName: null,
          slug: "fallback-slug",
        },
      ]),
    );
    const result = await loader.load({
      supportedLocales: ["en", "fr"],
      defaultLocale: "en",
    });
    expect(result.options.map((o) => o.label.fr)).toEqual([
      "Français",
      "Default",
      "Display",
      "fallback-slug",
    ]);
  });
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "file:///etc/passwd",
    "http://external.example/image.webp",
    "//external.example/image.webp",
    "https://user:pass@example.com/image.webp",
    "/%2e%2e/private.webp",
    "https://example.com/a\\b.webp",
  ])("rejects unsafe images %s", async (imageUrl) => {
    send.mockReturnValue(of([{ ...category("a"), imageUrl }]));
    expect(
      (await loader.load({ supportedLocales: ["en"], defaultLocale: "en" }))
        .options[0].image,
    ).toBeUndefined();
  });
  it("accepts HTTPS and development loopback assets, and rejects HTTP in production", async () => {
    send.mockReturnValue(
      of([
        {
          ...category("a"),
          imageUrl: "https://cdn.example/image.webp",
          icon: "https://cdn.example/icon.webp",
        },
        { ...category("b"), imageUrl: "http://127.0.0.1:9000/image.webp" },
      ]),
    );
    const input = { supportedLocales: ["en"], defaultLocale: "en" };
    expect((await loader.load(input)).options[1].image).toBe(
      "http://127.0.0.1:9000/image.webp",
    );
    const production = new ConciergeCategoryOptionsService(
      { send } as unknown as ClientProxy,
      new ConfigService({
        NODE_ENV: "production",
        PUBLIC_ASSET_BASE_URL: "https://api.example",
      }),
    );
    const result = await production.load(input);
    expect(result.options[0].icon).toBe("https://cdn.example/icon.webp");
    expect(result.options[1].image).toBeUndefined();
  });
  it("fails closed on transport errors or invalid responses, without retaining an invalid snapshot", async () => {
    send
      .mockReturnValueOnce(of([category("a")]))
      .mockReturnValueOnce(
        throwError(() => new Error("private transport error")),
      )
      .mockReturnValueOnce(of({ items: [] }));
    await loader.load({ supportedLocales: ["en"], defaultLocale: "en" });
    await expect(
      loader.load({ supportedLocales: ["en"], defaultLocale: "en" }),
    ).rejects.toMatchObject({ code: "AI_MENU_UNAVAILABLE", statusCode: 503 });
    await expect(
      loader.load({ supportedLocales: ["en"], defaultLocale: "en" }),
    ).rejects.toMatchObject({ code: "AI_MENU_UNAVAILABLE" });
  });
  it("hydrates stored empty options and changes ETags without changing base version", async () => {
    const data = seed();
    const db = {
      aiConfiguration: {
        findFirst: jest.fn().mockResolvedValue({ version: "published", data }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ConciergeConfigService(
      db as unknown as PrismaService,
      loader,
    );
    send
      .mockReturnValueOnce(of([category("a")]))
      .mockReturnValueOnce(of([category("a"), category("b")]))
      .mockReturnValueOnce(
        of([{ ...category("a"), sortOrder: 5 }, category("b")]),
      );
    const first = await service.current(),
      second = await service.current(),
      third = await service.current();
    expect(first.version).toBe(second.version);
    expect(service.etag(first, "en")).not.toBe(service.etag(second, "en"));
    expect(service.etag(second, "en")).not.toBe(service.etag(third, "en"));
    const publicData = service.public(first, "en");
    expect(publicData.questions[0].options[0].label).toBe("A");
    expect(JSON.stringify(publicData)).not.toMatch(
      /optionSource|compatibleVersions|categoryFingerprints/,
    );
    expect(data.questions[0].options).toEqual([]);
    expect(() =>
      service.validate(
        first,
        first.version,
        { "favorite-categories": ["a"] },
        "profile",
      ),
    ).not.toThrow();
    expect(() =>
      service.validate(
        first,
        first.version,
        { "favorite-categories": ["b"] },
        "profile",
      ),
    ).toThrow();
    expect(() =>
      service.validate(first, first.version, {}, "profile"),
    ).not.toThrow();
  });
  it("accepts known compatible pre-category versions but not changed allergy definitions", async () => {
    const data = seed(),
      old = structuredClone(data);
    old.questions = old.questions.filter((q: any) => !q.optionSource);
    old.stages = old.stages.filter((s: any) => s.id !== "food-tastes");
    delete old.content.onboardingExplanation;
    const broken = structuredClone(old);
    broken.questions.find((q: any) => q.id === "allergies").options.pop();
    const db = {
      aiConfiguration: {
        findFirst: jest.fn().mockResolvedValue({ version: "current", data }),
        findMany: jest.fn().mockResolvedValue([
          { version: "previous", data: old },
          { version: "unsafe", data: broken },
        ]),
      },
    };
    send.mockReturnValue(of([category("a")]));
    const service = new ConciergeConfigService(
      db as unknown as PrismaService,
      loader,
    );
    const config = await service.current();
    expect(() =>
      service.validate(config, "previous", { spice: "mild" }, "profile"),
    ).not.toThrow();
    expect(() =>
      service.validate(config, "unsafe", { spice: "mild" }, "profile"),
    ).toThrow();
  });
  it("keeps seed options empty, puts category onboarding first, and forbids duplicated stages/questions", () => {
    const data = seed();
    expect(
      data.questions
        .filter((q: any) => q.optionSource)
        .every((q: any) => q.options.length === 0),
    ).toBe(true);
    expect(data.stages.map((s: any) => s.id)).toEqual([
      "food-tastes",
      "personal",
      "occasion",
    ]);
    expect(data.content.onboardingExplanation.en).toBeTruthy();
    data.questions[0].options = [
      { id: "hardcoded", label: { en: "Hardcoded" } },
    ];
    expect(() => configSchema.parse(data)).toThrow();
    const repeated = seed();
    repeated.stages[1].questionIds.push("favorite-categories");
    expect(() => configSchema.parse(repeated)).toThrow();
  });
});
