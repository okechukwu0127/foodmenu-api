import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const text = z
  .string()
  .min(1)
  .max(1000)
  .refine((v) => !/[<>]/.test(v), "Plain text only");
const labels = z.record(z.string().min(2).max(20), text);
const reference = z
  .string()
  .max(1000)
  .regex(/^(https:\/\/[^\s<>]+|[a-z0-9_-]+)$/i);
const effect = z
  .object({
    kind: z.enum(["allergen", "diet", "budget", "none-known"]),
    value: id.optional(),
    maxMinor: z.number().int().nonnegative().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();
const option = z
  .object({
    id,
    label: labels,
    icon: reference.optional(),
    image: reference.optional(),
    exclusive: z.boolean().default(false),
    effect: effect.optional(),
  })
  .strict();
export const questionSchema = z
  .object({
    id,
    scope: z.enum(["profile", "account"]),
    input: z.enum(["single", "multiple", "text", "number", "boolean"]),
    label: labels,
    help: labels.optional(),
    required: z.boolean(),
    optionSource: z.literal("menu-categories").optional(),
    options: z.array(option).max(100).default([]),
    limits: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        minSelections: z.number().int().nonnegative().optional(),
        maxSelections: z.number().int().nonnegative().optional(),
        maxLength: z.number().int().min(1).max(1000).optional(),
      })
      .strict(),
    default: z
      .union([
        z.string(),
        z.array(z.string()),
        z.number(),
        z.boolean(),
        z.null(),
      ])
      .optional(),
  })
  .strict();
export const configSchema = z
  .object({
    enabled: z.boolean(),
    capabilities: z
      .object({
        commerce: z.boolean().optional(),
        chat: z.boolean(),
        guests: z.boolean(),
        profiles: z.boolean(),
        recommendations: z.boolean(),
      })
      .strict(),
    supportedLocales: z
      .array(z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/))
      .min(1)
      .max(20),
    defaultLocale: z.string(),
    content: z
      .object({
        welcome: labels,
        explanation: labels,
        onboardingExplanation: labels.optional(),
        chatGreeting: labels.optional(),
        chatStarters: z
          .array(
            z
              .object({
                id,
                label: labels,
                prompt: labels,
                icon: id.optional(),
              })
              .strict(),
          )
          .max(12)
          .optional(),
      })
      .strict(),
    stages: z
      .array(
        z
          .object({ id, label: labels, questionIds: z.array(id).max(100) })
          .strict(),
      )
      .max(30),
    questions: z.array(questionSchema).max(100),
    profileLimits: z
      .object({
        maxCount: z.number().int().min(1).max(50),
        minNameLength: z.number().int().min(1),
        maxNameLength: z.number().int().max(120),
        maxImportBatch: z.number().int().min(1).max(50),
      })
      .strict(),
    chatLimits: z
      .object({
        textLength: z.number().int().min(1).max(10000),
        historyMessages: z.number().int().min(1).max(100),
        contextCharacters: z.number().int().min(1000).max(100000),
        outputTokens: z.number().int().min(100).max(8192),
        toolSteps: z.number().int().min(1).max(8),
        toolResults: z.number().int().min(1).max(20),
        menuScanPages: z.number().int().min(1).max(20),
        guestTurns: z.number().int().min(1).max(100),
        pageSize: z.number().int().min(1).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = c.questions.map((q) => q.id);
    if (
      new Set(ids).size !== ids.length ||
      !c.supportedLocales.includes(c.defaultLocale)
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate questions or invalid default locale",
      });
    for (const q of c.questions) {
      const selected = q.input === "single" || q.input === "multiple";
      if (
        q.optionSource &&
        (!selected ||
          q.options.length > 0 ||
          (q.default !== undefined &&
            q.default !== null &&
            (!Array.isArray(q.default) || q.default.length > 0)))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Dynamic category selections must keep stored options/default choices empty",
        });
      if (!q.optionSource && selected !== q.options.length > 0)
        ctx.addIssue({
          code: "custom",
          message: "Only selection inputs have nonempty options",
        });
      if (
        (q.limits.min ?? -Infinity) > (q.limits.max ?? Infinity) ||
        (q.limits.minSelections ?? 0) > (q.limits.maxSelections ?? Infinity)
      )
        ctx.addIssue({ code: "custom", message: "Invalid question limits" });
      if (
        !q.label[c.defaultLocale] ||
        q.options.some((o) => !o.label[c.defaultLocale])
      )
        ctx.addIssue({
          code: "custom",
          message: "Default-locale labels are required",
        });
      if (q.default !== undefined && q.default !== null) {
        const values = Array.isArray(q.default) ? q.default : [q.default];
        const valid =
          q.input === "single"
            ? typeof q.default === "string"
            : q.input === "multiple"
              ? Array.isArray(q.default)
              : q.input === "text"
                ? typeof q.default === "string"
                : q.input === "number"
                  ? typeof q.default === "number"
                  : typeof q.default === "boolean";
        if (
          !valid ||
          (selected &&
            (values.some((v) => !q.options.some((o) => o.id === v)) ||
              new Set(values).size !== values.length ||
              values.length >
                (q.limits.maxSelections ??
                  (q.input === "single" ? 1 : q.options.length)) ||
              values.length < (q.limits.minSelections ?? 0) ||
              (values.length > 1 &&
                values.some(
                  (v) => q.options.find((o) => o.id === v)?.exclusive,
                ))))
        )
          ctx.addIssue({
            code: "custom",
            message: "Default violates the question definition",
          });
        if (
          values.some(
            (v) =>
              q.options.find((o) => o.id === v)?.effect?.kind === "none-known",
          )
        )
          ctx.addIssue({
            code: "custom",
            message:
              "No-known-allergies must be explicitly declared, never defaulted",
          });
      }
      if (new Set(q.options.map((o) => o.id)).size !== q.options.length)
        ctx.addIssue({ code: "custom", message: "Duplicate options" });
      for (const o of q.options) {
        if (
          o.effect?.kind === "budget" &&
          (o.effect.maxMinor === undefined || !o.effect.currency)
        )
          ctx.addIssue({
            code: "custom",
            message: "Budget requires money fields",
          });
        if (
          ["allergen", "diet"].includes(o.effect?.kind ?? "") &&
          !o.effect?.value
        )
          ctx.addIssue({
            code: "custom",
            message: "Restriction requires a value",
          });
        if (o.effect?.kind === "none-known" && !o.exclusive)
          ctx.addIssue({
            code: "custom",
            message: "No-known-allergies must be exclusive",
          });
      }
      if (
        q.scope === "profile" &&
        q.options.some((o) => o.effect?.kind === "none-known")
      )
        ctx.addIssue({
          code: "custom",
          message: "No-known-allergies belongs to account scope",
        });
    }
    const stagedQuestions = c.stages.flatMap((s) => s.questionIds);
    if (new Set(stagedQuestions).size !== stagedQuestions.length)
      ctx.addIssue({
        code: "custom",
        message: "Questions must not be duplicated between onboarding stages",
      });
    if (c.stages.some((s) => s.questionIds.some((q) => !ids.includes(q))))
      ctx.addIssue({ code: "custom", message: "Unknown stage question" });
    if (c.profileLimits.minNameLength > c.profileLimits.maxNameLength)
      ctx.addIssue({ code: "custom", message: "Invalid name limits" });
    const starters = c.content.chatStarters ?? [];
    if (
      new Set(starters.map((s) => s.id)).size !== starters.length ||
      starters.some(
        (s) => !s.label[c.defaultLocale] || !s.prompt[c.defaultLocale],
      ) ||
      (c.content.chatGreeting && !c.content.chatGreeting[c.defaultLocale])
    )
      ctx.addIssue({
        code: "custom",
        message: "Chat starters require unique IDs and default-locale content",
      });
    if (
      new Set(c.stages.map((s) => s.id)).size !== c.stages.length ||
      new Set(c.supportedLocales).size !== c.supportedLocales.length ||
      !c.content.welcome[c.defaultLocale] ||
      !c.content.explanation[c.defaultLocale] ||
      (c.content.onboardingExplanation &&
        !c.content.onboardingExplanation[c.defaultLocale])
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid stages, locales or localized content",
      });
  });
export type ConciergeConfig = z.infer<typeof configSchema> & {
  version: string;
  categoryFingerprints?: Record<string, string>;
  compatibleVersions?: string[];
};
export type Answers = Record<
  string,
  string | string[] | number | boolean | null
>;
export const answersSchema = z.record(
  z.string().max(64),
  z.union([
    z.string().max(1000),
    z.array(z.string().max(128)).max(100),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]),
);
