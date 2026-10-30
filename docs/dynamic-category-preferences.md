# Dynamic category preferences

The first AI onboarding stage is `food-tastes`, containing the optional multiple-choice `favorite-categories` question (up to six selections), followed by `personal` and `occasion`. The welcome explanation is preserved; `content.onboardingExplanation` supplies the separate onboarding introduction.

## Deployment and source

No database migration is needed. Publish the updated question definition once:

```bash
npm run ai:seed
```

This reads `prisma/ai-concierge-config.json` and publishes an immutable base configuration. The stored question has `optionSource: "menu-categories"` and empty `options`. Do not copy category rows into this file. Subsequent category changes need neither a configuration publication nor a gateway restart.

`ConciergeCategoryOptionsService` uses the existing `MENU_PATTERNS.GET_CATEGORIES` TCP request. The menu service queries active `Category` rows ordered by `sortOrder ASC, id ASC`. The gateway never queries the Category table. Each `ConciergeConfigService.current()` call hydrates all menu-category questions from one loader snapshot; saves and chat context validation use the same loader. There is no category cache. A menu timeout, outage or invalid response returns HTTP 503 `AI_MENU_UNAVAILABLE`, including during saves. Such failures do not become an authoritative empty category list or overwrite saved answers.

## Frontend contract

Fetch `GET /api/v1/ai/config?locale=en`, render stages in their returned order, and render the question options returned in `data.questions`. Each category option contains `id`, a single localized `label`, `exclusive: false`, and optional `image`/`icon`. The internal `optionSource`, compatibility list and fingerprints are not included in the JSON body.

Labels resolve from requested locale, default locale, `displayName`, then `slug`. Images and icons come from category records. Relative assets resolve against `PUBLIC_ASSET_BASE_URL`; use an HTTPS base in production. HTTPS URLs are allowed; HTTP is allowed only for loopback hosts outside production. Unsafe or malformed assets are omitted. Icon identifiers are also supported. The frontend should render labels as plain text.

The response also includes localized `content.onboardingExplanation` when configured. Keep `content.explanation` for the welcome screen.

Save selected IDs through the existing authenticated preference-profile endpoints, preserving their revision/If-Match contracts:

```json
{
  "configVersion": "<data.version>",
  "name": "My favourites",
  "answers": {
    "favorite-categories": ["<active category ID>"],
    "diet": ["<configured diet option ID>"]
  }
}
```

Use real IDs from configuration; this example is illustrative. The category question is optional, so omitting it or submitting an empty array is valid. Preserve the user's other answers when replacing a profile.

Store the exact configuration response ETag as a change fingerprint. Its format is `"BASE_VERSION-LOCALE-CATEGORY_FINGERPRINT"`. The deterministic fingerprint includes active IDs, resolved labels, safe images/icons and sort order. An addition, removal, rename, asset change or reorder changes the relevant ETag while `data.version` remains unchanged. The config endpoint always returns HTTP 200 with a full body and `Cache-Control: no-store`; it does not use 304 because a missing body can strand clients behind native cache revalidation. Revalidate rather than pinning configuration indefinitely by base version.

Inactive, deleted and unknown IDs return HTTP 400 `AI_INVALID_ANSWER`, with `error.details.requiresPreferenceReview: true` and reason `OPTION_RETIRED_OR_UNKNOWN`. Refresh configuration and ask the user to review affected selections. The backend preserves the previously saved profile and revision on rejection; it never silently drops a retired choice. Starting a conversation with a profile containing a retired choice also requires review.

## Compatibility and recommendations

Existing profiles without this optional answer remain valid. Known previous published versions are accepted only if every previous question definition and the profile limits are unchanged and any added questions are optional menu-category questions without defaults. Existing records are not rewritten on reads; an explicit accepted save stores the current version. Breaking configuration edits still require explicit reconciliation through `AI_CONFIG_OUTDATED`. Existing allergies, diet, budget, spice, serving-size and profile answers retain their existing semantics and customer ownership checks.

Validated selections become `EffectiveContext.preferredCategoryIds` and appear in the `data-preference-summary` stream part. Recommendation tools query the menu using its supported `categoryId` filter, reserve a broader query for soft preferences within the configured scan limit, and rank eligible preferred-category meals first. The model can pass validated `categoryIds` for an explicit current request, or `usePreferredCategories: false` to broaden tastes. These are internal tool inputs, not new frontend endpoints. Category overrides never bypass allergy, dietary, availability or budget checks. Food cards now include nullable `categoryId`; previously stored cards remain readable.

## Verification

Unit tests cover source validation, localization, assets, deterministic sorting/fingerprints, seed structure, compatibility and category-aware menu tools. The AI HTTP/PostgreSQL integration suite uses real Category rows through the menu catalog service with a mocked TCP boundary and mocked Gemini. It covers public configuration refreshes, saves, retired choices, account isolation, old profiles, recommendation queries and menu outages. No paid/live model calls are used.

Validated on October 28, 2026:

- `npm test -- --runInBand --watchman=false`: 15 suites, 104 tests passed.
- `npm run test:ai`: 52 integration tests passed in an isolated PostgreSQL schema.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run build`: all five service builds passed.
- Prettier and `git diff --check`: passed.
- `ESLINT_USE_FLAT_CONFIG=false npm run lint`: passed using the repository's existing `.eslintrc.cjs`. Plain `npm run lint` requires ESLint flat-config migration or this legacy compatibility setting.

After the usage-limit reset, `npm run test:e2e -- --runInBand --watchman=false` completed successfully: 3 suites and 30 tests passed; 4 suites and 126 tests were skipped by their existing test configuration. The AI integration suite's separate 52-test result is listed above. The updated seed was subsequently published on October 28, 2026 together with the empty-chat greeting and starters as configuration `f966d468af4f1c854e3f`. Other environments must run the deployment command above to activate it.

## Files changed for this feature

Paths below are relative to `apps/api-gateway/src/ai-concierge/` unless otherwise specified:

- `config/category-options.service.ts` (new) and `config/category-options.service.spec.ts` (new).
- `config/config.schema.ts`, `config/config.service.ts`, `config/config.service.spec.ts`.
- `ai-concierge.module.ts`, `ai-concierge.controller.ts`.
- `preferences/effective-preferences.service.ts`, `preferences/preferences.service.ts`.
- `adapters/menu.adapter.ts`, `conversations/chat.service.ts`.
- `tools/cards.schema.ts`, `tools/menu-tools.service.ts`, `tools/menu-tools.service.spec.ts`.
- `apps/menu-service/src/menu/menu-catalog.service.ts` and its `.spec.ts`.
- `test/ai-concierge.e2e-spec.ts`.
- `prisma/ai-concierge-config.json`.
- `AI_CONCIERGE_API.md` and this document.
