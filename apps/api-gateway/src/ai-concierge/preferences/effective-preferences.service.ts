import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ConciergeConfigService } from "../config/config.service";
import { Answers, ConciergeConfig } from "../config/config.schema";
import { fail } from "../persistence/contracts";

function hasSavedAnswers(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length > 0;
}

export type EffectiveContext = {
  configVersion: string;
  preferenceProfileId: string | null;
  profileRevision: number | null;
  accountRevision: number | null;
  profileAnswers: Answers;
  accountAnswers: Answers;
  temporaryAnswers: Answers;
  preferredCategoryIds: string[];
  restrictions: {
    allergens: string[];
    diets: string[];
    allergyState: "unknown" | "none-known" | "restricted";
    budgets: { currency: string; maxMinor: number }[];
  };
};
@Injectable()
export class EffectivePreferencesService {
  constructor(private readonly configs: ConciergeConfigService) {}
  derive(config: ConciergeConfig, layers: Answers[]) {
    const allergens = new Set<string>(),
      diets = new Set<string>();
    const budgets = new Map<string, number>();
    let noneKnown = false;
    for (const [index, answers] of layers.entries()) {
      for (const [id, answer] of Object.entries(answers)) {
        const question = config.questions.find((q) => q.id === id);
        for (const value of Array.isArray(answer) ? answer : [answer]) {
          const effect = question?.options.find((o) => o.id === value)?.effect;
          if (effect?.kind === "allergen" && effect.value)
            allergens.add(effect.value);
          if (effect?.kind === "diet" && effect.value) diets.add(effect.value);
          if (effect?.kind === "none-known" && index === 0) noneKnown = true;
          if (
            effect?.kind === "budget" &&
            effect.currency &&
            effect.maxMinor !== undefined
          )
            budgets.set(
              effect.currency,
              Math.min(
                budgets.get(effect.currency) ?? Infinity,
                effect.maxMinor,
              ),
            );
        }
      }
    }
    return {
      allergens: [...allergens].sort(),
      diets: [...diets].sort(),
      allergyState: allergens.size
        ? ("restricted" as const)
        : noneKnown
          ? ("none-known" as const)
          : ("unknown" as const),
      budgets: [...budgets].map(([currency, maxMinor]) => ({
        currency,
        maxMinor,
      })),
    };
  }
  preferredCategories(config: ConciergeConfig, layers: Answers[]): string[] {
    const ids = new Set<string>();
    for (const q of config.questions.filter(
      (q) => q.optionSource === "menu-categories",
    )) {
      for (const layer of layers) {
        const value = layer[q.id];
        for (const id of Array.isArray(value) ? value : [value])
          if (typeof id === "string" && q.options.some((o) => o.id === id))
            ids.add(id);
      }
    }
    return [...ids].sort();
  }
  async build(
    tx: Prisma.TransactionClient,
    config: ConciergeConfig,
    customerId: string | undefined,
    selected: string | null | undefined,
    temporary: Answers = {},
    guest?: { profileAnswers: Answers; accountAnswers: Answers },
  ): Promise<EffectiveContext> {
    let preferenceProfileId = selected ?? null,
      profileRevision: number | null = null,
      accountRevision: number | null = null;
    let profileAnswers: Answers = {},
      accountAnswers: Answers = {};
    if (customerId) {
      const state = await tx.aiCustomerState.findUniqueOrThrow({
        where: { customerId },
      });
      if (selected === undefined) preferenceProfileId = state.defaultProfileId;
      accountRevision = state.accountRevision;
      accountAnswers = this.configs.validate(
        config,
        hasSavedAnswers(state.accountAnswers)
          ? state.accountConfigVersion ?? config.version
          : config.version,
        state.accountAnswers,
        "account",
      );
      if (preferenceProfileId) {
        const profile = await tx.aiPreferenceProfile.findFirst({
          where: { id: preferenceProfileId, customerId, deletedAt: null },
        });
        if (!profile && selected !== undefined)
          fail(
            "AI_PROFILE_NOT_FOUND",
            "Selected profile no longer exists; explicitly switch conversation context",
            404,
          );
        if (!profile) preferenceProfileId = null;
        else {
          profileAnswers = this.configs.validate(
            config,
            hasSavedAnswers(profile.answers) ? profile.configVersion : config.version,
            profile.answers,
            "profile",
          );
          profileRevision = profile.revision;
        }
      }
    } else {
      if (preferenceProfileId)
        fail(
          "AI_INVALID_INPUT",
          "Guest conversations cannot select saved profiles",
        );
      if (guest) {
        profileAnswers = this.configs.validate(
          config,
          config.version,
          guest.profileAnswers,
          "profile",
        );
        accountAnswers = this.configs.validate(
          config,
          config.version,
          guest.accountAnswers,
          "account",
        );
      }
    }
    const temporaryAnswers = this.configs.validate(
      config,
      config.version,
      temporary,
      "temporary",
      true,
    );
    return {
      configVersion: config.version,
      preferenceProfileId,
      profileRevision,
      accountRevision,
      profileAnswers,
      accountAnswers,
      temporaryAnswers,
      preferredCategoryIds: this.preferredCategories(config, [
        accountAnswers,
        profileAnswers,
        temporaryAnswers,
      ]),
      restrictions: this.derive(config, [
        accountAnswers,
        profileAnswers,
        temporaryAnswers,
      ]),
    };
  }
}
