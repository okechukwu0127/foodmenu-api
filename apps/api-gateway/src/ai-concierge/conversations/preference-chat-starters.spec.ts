import { readFileSync } from "fs";
import { configSchema } from "../config/config.schema";
import { EffectiveContext } from "../preferences/effective-preferences.service";
import { preferenceChatStarters } from "./preference-chat-starters";

it("builds four distinct searches from validated preferences without changing restrictions", () => {
  const config = {
    ...configSchema.parse(
      JSON.parse(readFileSync("prisma/ai-concierge-config.json", "utf8")),
    ),
    version: "test",
  };
  config.questions.find((q) => q.optionSource === "menu-categories")!.options =
    [{ id: "chosen", label: { en: "Pasta" }, exclusive: false }];
  const context = {
    preferredCategoryIds: ["chosen"],
    restrictions: {
      diets: ["vegan"],
      allergens: ["milk"],
      budgets: [{ currency: "GBP", maxMinor: 1500 }],
    },
  } as EffectiveContext;
  const before = structuredClone(context);
  const result = preferenceChatStarters(context, config, "en");
  expect(result.chatStarters).toHaveLength(4);
  expect(new Set(result.chatStarters.map((s) => s.id)).size).toBe(4);
  expect(result.chatStarters[0].prompt).toContain("Vegan");
  expect(result.chatStarters[1].prompt).toContain("Pasta");
  expect(result.chatStarters[2].label).toBe("Within my budget");
  expect(
    result.chatStarters.every(
      (s) => s.prompt.length <= config.chatLimits.textLength,
    ),
  ).toBe(true);
  expect(context).toEqual(before);
});
