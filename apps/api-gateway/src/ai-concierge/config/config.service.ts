import { Injectable } from "@nestjs/common";
import { PrismaService } from "@app/database";
import {
  Answers,
  ConciergeConfig,
  configSchema,
  answersSchema,
} from "./config.schema";
import { ConciergeCategoryOptionsService } from "./category-options.service";
import { digest, fail, parse } from "../persistence/contracts";

@Injectable()
export class ConciergeConfigService {
  constructor(
    private readonly db: PrismaService,
    private readonly categories: ConciergeCategoryOptionsService,
  ) {}
  async current(): Promise<ConciergeConfig> {
    const row = await this.db.aiConfiguration.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!row)
      fail(
        "AI_NOT_CONFIGURED",
        "Concierge configuration has not been published",
        503,
      );
    const parsed = configSchema.safeParse(row.data);
    if (!parsed.success || !/^[a-zA-Z0-9._-]{1,100}$/.test(row.version))
      fail("AI_CONFIG_INVALID", "Concierge configuration is invalid", 503);
    const config: ConciergeConfig = { ...parsed.data, version: row.version };
    if (config.questions.some((q) => q.optionSource === "menu-categories")) {
      // Compatibility is deliberately narrow: only optional dynamic questions
      // can be added while retaining the old question validation definitions.
      const versions = await this.db.aiConfiguration.findMany({
        where: { version: { not: row.version } },
        select: { version: true, data: true },
      });
      config.compatibleVersions = versions
        .filter((old) => {
          const previous = configSchema.safeParse(old.data);
          return (
            previous.success &&
            this.additiveCategoryUpgrade(previous.data, parsed.data)
          );
        })
        .map((v) => v.version);
      const snapshot = await this.categories.load(config);
      config.questions = config.questions.map((q) =>
        q.optionSource === "menu-categories"
          ? { ...q, options: snapshot.options }
          : q,
      );
      config.categoryFingerprints = snapshot.fingerprints;
    }
    return config;
  }
  private additiveCategoryUpgrade(
    previous: Omit<ConciergeConfig, "version">,
    current: Omit<ConciergeConfig, "version">,
  ) {
    const oldIds = new Set(previous.questions.map((q) => q.id));
    const additions = current.questions.filter((q) => !oldIds.has(q.id));
    if (
      additions.some(
        (q) =>
          q.optionSource !== "menu-categories" ||
          q.required ||
          q.default !== undefined,
      )
    )
      return false;
    return (
      previous.questions.every((q) => {
        const next = current.questions.find((n) => n.id === q.id);
        return next && digest(next) === digest(q);
      }) && digest(previous.profileLimits) === digest(current.profileLimits)
    );
  }
  etag(config: ConciergeConfig, locale: string) {
    this.locale(config, locale);
    const fingerprint = config.categoryFingerprints?.[locale];
    return `"${config.version}-${locale}${fingerprint ? "-" + fingerprint : ""}"`;
  }
  requireEnabled(config: ConciergeConfig) {
    if (!config.enabled)
      fail("AI_DISABLED", "The food concierge is currently unavailable", 503);
  }
  locale(config: ConciergeConfig, locale: string) {
    if (!config.supportedLocales.includes(locale))
      fail("AI_UNSUPPORTED_LOCALE", "Unsupported locale", 400, {
        supportedLocales: config.supportedLocales,
      });
  }
  version(config: ConciergeConfig, version: string) {
    if (
      version !== config.version &&
      !config.compatibleVersions?.includes(version)
    )
      fail(
        "AI_CONFIG_OUTDATED",
        "Refresh configuration and explicitly reconcile retired questions/options",
        409,
        { configVersion: config.version },
      );
  }
  validate(
    config: ConciergeConfig,
    version: string,
    value: unknown,
    scope: "profile" | "account" | "temporary",
    partial = false,
  ): Answers {
    this.version(config, version);
    const input = parse(answersSchema, value);
    const questions = config.questions.filter(
      (q) => scope === "temporary" || q.scope === scope,
    );
    const result: Answers = {};
    for (const key of Object.keys(input)) {
      if (!questions.some((q) => q.id === key))
        fail(
          "AI_UNKNOWN_QUESTION",
          "Unknown question or incorrect scope",
          400,
          { questionId: key },
        );
    }
    for (const q of questions) {
      const answer =
        input[q.id] !== undefined
          ? input[q.id]
          : !partial
            ? q.default
            : undefined;
      if (answer === undefined || answer === null) {
        if (q.required && !partial)
          fail(
            "AI_ANSWER_REQUIRED",
            "A configured question requires an answer",
            400,
            { questionId: q.id },
          );
        if (answer === null) result[q.id] = null;
        continue;
      }
      let valid = true;
      if (q.input === "single" || q.input === "multiple") {
        valid =
          q.input === "single"
            ? typeof answer === "string"
            : Array.isArray(answer);
        const values = Array.isArray(answer) ? answer : [answer];
        if (
          q.optionSource === "menu-categories" &&
          values.some(
            (v) => typeof v !== "string" || !q.options.some((o) => o.id === v),
          )
        )
          fail(
            "AI_INVALID_ANSWER",
            "A selected food category is unavailable. Review your preferences.",
            400,
            {
              questionId: q.id,
              requiresPreferenceReview: true,
              reason: "OPTION_RETIRED_OR_UNKNOWN",
            },
          );
        valid =
          valid &&
          values.every(
            (v) => typeof v === "string" && q.options.some((o) => o.id === v),
          );
        valid = valid && new Set(values).size === values.length;
        valid =
          valid &&
          values.length >= (q.limits.minSelections ?? (q.required ? 1 : 0)) &&
          values.length <=
            (q.limits.maxSelections ??
              (q.input === "single" ? 1 : q.options.length));
        valid =
          valid &&
          !(
            values.length > 1 &&
            values.some((v) => q.options.find((o) => o.id === v)?.exclusive)
          );
        if (
          scope === "temporary" &&
          values.some(
            (v) =>
              q.options.find((o) => o.id === v)?.effect?.kind === "none-known",
          )
        )
          valid = false;
      } else if (q.input === "text") {
        valid =
          typeof answer === "string" &&
          answer.trim().length >= (q.limits.min ?? (q.required ? 1 : 0)) &&
          answer.length <= (q.limits.maxLength ?? 1000);
      } else if (q.input === "number") {
        valid =
          typeof answer === "number" &&
          answer >= (q.limits.min ?? -Infinity) &&
          answer <= (q.limits.max ?? Infinity);
      } else valid = typeof answer === "boolean";
      if (!valid)
        fail(
          "AI_INVALID_ANSWER",
          "Answer violates the stored question definition",
          400,
          { questionId: q.id },
        );
      result[q.id] = answer;
    }
    return result;
  }
  public(config: ConciergeConfig, locale: string) {
    this.locale(config, locale);
    const label = (v: Record<string, string>) =>
      v[locale] ?? v[config.defaultLocale];
    return {
      version: config.version,
      enabled: config.enabled,
      capabilities: config.capabilities,
      supportedLocales: config.supportedLocales,
      defaultLocale: config.defaultLocale,
      profileLimits: config.profileLimits,
      chatLimits: config.chatLimits,
      content: {
        welcome: label(config.content.welcome),
        explanation: label(config.content.explanation),
        ...(config.content.chatGreeting
          ? { chatGreeting: label(config.content.chatGreeting) }
          : {}),
        ...(config.content.chatStarters
          ? {
              chatStarters: config.content.chatStarters.map((starter) => ({
                id: starter.id,
                label: label(starter.label),
                prompt: label(starter.prompt),
                ...(starter.icon ? { icon: starter.icon } : {}),
              })),
            }
          : {}),
        ...(config.content.onboardingExplanation
          ? {
              onboardingExplanation: label(
                config.content.onboardingExplanation,
              ),
            }
          : {}),
      },
      stages: config.stages.map((s) => ({ ...s, label: label(s.label) })),
      questions: config.questions.map((q) => ({
        id: q.id,
        scope: q.scope,
        input: q.input,
        required: q.required,
        limits: q.limits,
        label: label(q.label),
        ...(q.help ? { help: label(q.help) } : {}),
        ...(q.default !== undefined ? { default: q.default } : {}),
        options: q.options.map((o) => ({ ...o, label: label(o.label) })),
      })),
    };
  }
}
