# AI Food Concierge API

**Continuous commerce extension:** read [conversation-commerce.md](docs/conversation-commerce.md) for the current cart, claim, quote, payment and commerce-history contracts. The Stripe payment-intent endpoint now requires a server quote; client-supplied amount/order totals are no longer accepted. Keep recommendations, explicit commerce actions, payment UI and confirmed payment cards in the same conversation.


**Dynamic category onboarding:** read [dynamic-category-preferences.md](docs/dynamic-category-preferences.md) for live menu categories, category-aware ETags, profile compatibility and recommendation behavior.

The concierge runs inside the API gateway as `AiConciergeModule`. It owns only concierge configuration, profiles, restrictions, imports, conversations, messages and rate buckets. It authenticates through the existing identity client and queries menu data through the existing menu TCP service. It does not query identity/menu business tables. The shared Prisma schema supplies foreign keys to the existing customer relationship.

This phase implements text chat, menu discovery, saved preference profiles, personal restrictions, explicit temporary context, history and offline reconciliation. Voice and model-autonomous purchasing remain outside this phase. Explicit user-confirmed commerce actions now manage the cart, prepare checkout and use the existing payment flow within the conversation; see the extension above. A future transcription endpoint can pass validated text through the same `ConciergeChatService.start` workflow.

## Install, migrate and configure

Packages installed and tested: `ai` **6.0.315**, `@ai-sdk/google` **3.0.138**, `zod` **4.6.7**. These compatible releases support this repository's CommonJS NestJS/Jest setup. Use a compatible AI SDK 6 frontend and `@ai-sdk/react` 3.x. No Gemini calls or paid credentials are required by the automated suite.

```bash
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run ai:seed
npm run start:dev
```

Migration: `prisma/migrations/20261026120000_add_ai_concierge/migration.sql` adds the concierge tables and nullable `FoodItem.dietaryInfo`. It adds foreign keys, resource/retry uniqueness, one running turn per conversation and one active configuration constraints. Apply before starting the gateway and updated menu service. This feature does not move the gateway into a separate process.

Set these backend-only variables (examples are also in `.env.example`):

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=your-server-side-key
AI_CONCIERGE_MODEL=gemini-3.8-flash
AI_PROVIDER_TIMEOUT_MS=45000
AI_GUEST_TTL_SECONDS=86400
AI_RETENTION_DAYS=30
AI_ACCOUNT_RATE_LIMIT=20
AI_GUEST_RATE_LIMIT=5
AI_GUEST_CREATE_RATE_LIMIT=3
```

The default was updated to `gemini-3.8-flash` after Google stopped accepting `gemini-2.5-flash` for new users. Existing deployments must update their environment override and restart the gateway. Provider failures use sanitized structured logs instead of the SDK default raw error dump. Choose a Gemini model enabled for your Google project; the default is configurable and availability is provider/account dependent. `GOOGLE_GENERATIVE_AI_API_KEY` is separate from Google Sign-In client IDs and the Routes API key. Never place it in an Expo public environment variable. Missing credentials yield a standard 503 before a new turn is stored. Public configuration and stored conversation responses never include credentials, prompts or tool definitions.

References: [Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai), [UIMessage streams](https://ai-sdk.dev/docs/reference/ai-sdk-ui/create-ui-message-stream), [transport mapping](https://ai-sdk.dev/docs/ai-sdk-ui/transport), [Expo streaming fetch](https://ai-sdk.dev/docs/getting-started/expo).

## Common contracts

Base URL below: `http://localhost:4000/api/v1/ai`. Authenticated endpoints use the existing `Authorization: Bearer <session-token>`. No endpoint accepts customerId/accountId. UUIDs are client-generated RFC UUID strings; names do not establish identity.

JSON successes use the existing `{ "success": true, "data": ... }` envelope, normally with the gateway's other envelope metadata. JSON errors use the existing `{ "success": false, "error": { "code": "...", "details": ... }, "message": "...", ... }` format. DELETE successes are empty 204 responses. `/chat` uses SSE, not an envelope. Private JSON responses use `Cache-Control: no-store`.

All mutations reject unknown body fields. Only configuration-defined answers are accepted; arbitrary trusted roles, tool results, prices or ownership fields are rejected. Password/session auth behavior is unchanged. A supplied invalid Bearer token always fails with 401; the backend never falls back to guest mode.

## Public configuration

```bash
curl -i 'http://localhost:4000/api/v1/ai/config?locale=en'
curl -i 'http://localhost:4000/api/v1/ai/config?locale=en'
```

`GET /config?locale=en` returns HTTP 200 and `data` containing:

- `version`, `enabled`, `capabilities` (chat, guests, profiles, recommendations).
- `supportedLocales`, `defaultLocale`, localized `content.welcome`, `content.explanation` and optional `content.onboardingExplanation`, `content.chatGreeting`, `content.chatStarters`.
- Ordered `stages`: stable id, localized label, ordered questionIds.
- `questions`: id, scope (`profile`/`account`), input, localized label/help, required, options, limits, optional explicit default.
- Options: stable id, localized label, optional image/icon reference, exclusive flag, optional structured effect.
- `profileLimits`: maxCount, minNameLength, maxNameLength, maxImportBatch.
- `chatLimits`: textLength, historyMessages, contextCharacters, outputTokens, toolSteps, toolResults, menuScanPages, guestTurns, pageSize.

`ETag: "VERSION-LOCALE-CATEGORY_FINGERPRINT"` when dynamic categories are configured (otherwise `"VERSION-LOCALE"`); treat the value as opaque and use changes to detect configuration updates. The endpoint always returns HTTP 200 with a complete body and `Cache-Control: no-store`; it deliberately does not return 304 because clients must always have a body to recover from native/intermediary cache revalidation. Stored base configuration versions are immutable. Category options are hydrated from active menu rows on every configuration load; category edits refresh the ETag without publishing another base version or restarting the gateway. Clients must fetch config instead of hardcoding IDs, choices, budgets, currencies, locales, onboarding order, defaults or limits. The initial seed supports English; adding translations/locales is a backend configuration operation.

The mobile client requests config with `cache: "no-store"` and validates the full response before using it. Preserve queued preferences and show configuration/validation errors separately from actual transport failures. The mobile frontend implements this in `src/services/ai/aiConfiguration.ts` and its configuration refresh hook.

### Empty-chat greeting and starters

`data.content.chatGreeting` is a localized string with real newline characters. `data.content.chatStarters` is an ordered list of `{ id, label, prompt, icon? }`; labels and prompts are plain localized strings, and icons are optional identifiers for the frontend's existing icon mapping. Both fields are optional so older published/cached configurations remain valid. Hide missing content gracefully; no frontend text fallback is required. For each field, a missing requested-locale translation falls back to the configured default locale. The shipped configuration currently provides English and six starters.

On tapping a starter, send its `prompt` as an ordinary user message through the existing `/chat` contract, preserving the current conversation, authentication/guest proof and turn/message IDs. Do not send the whole starter as an action or treat its ID/icon as a tool invocation. Offline/busy button state remains a frontend concern. Starter messages use the same backend validation, preference filtering and ordering confirmations as typed messages. They do not modify stored preferences automatically.

The stored JSON uses localized maps for `chatGreeting`, `chatStarters[].label` and `chatStarters[].prompt`; the public API resolves them to strings. Starter IDs must be unique, default-locale translations are required, and the list is bounded to 12 entries. A content edit requires publishing a new immutable base version with `npm run ai:seed`; the version change also refreshes the response ETag. Editing the JSON file alone does not change the active database configuration.

Finite supported input types:

| input | Answer | Stored validation |
| --- | --- | --- |
| single | string option ID | Known option, one selection |
| multiple | string[] option IDs | Unique options, minSelections/maxSelections, exclusive choices cannot be combined |
| text | string | min length and maxLength; plain string data |
| number | finite number | min/max; numeric strings are rejected |
| boolean | boolean | Exact JSON boolean |

Optional answers may be null or omitted. Required answers cannot be null or omitted unless a configured default supplies them. Limits and explicit defaults are part of the stored definition. Partial temporary answers do not apply defaults or require every question. Client display labels are plain text. Configuration is strictly validated data: no HTML/JSX, arbitrary component names, executable expressions or action URLs. Optional image/icon references are HTTPS asset references or finite plain identifiers. Options can carry `effect`:

```json
{ "kind": "budget", "maxMinor": 1500, "currency": "GBP" }
```

Other supported effects are `{ "kind": "allergen", "value": "milk" }`, `{ "kind": "diet", "value": "vegan" }`, or `{ "kind": "none-known" }`. Values come from storage, not frontend arrays. No-known-allergies options must be exclusive and account-scoped, and cannot be defaulted. Food IDs/availability/prices are supplied by menu tools, not configuration.

### Backend management and retirement

No public configuration-write endpoint was added because the repository has no admin authorization framework. Edit a reviewed copy of `prisma/ai-concierge-config.json`, then publish through the backend deployment/management environment:

```bash
npm run ai:seed -- ./prisma/ai-concierge-config.json
# Optional explicit immutable version:
npm run ai:seed -- ./prisma/ai-concierge-config.json restaurant-2026-02
```

The seed validates the same Zod configuration schema as runtime handlers, generates a content-based version by default, rejects changing an existing version, and switches active versions atomically under an advisory lock. Old rows remain available for audit. Run this command from the source checkout with development tooling installed; it is not a public HTTP operation. The runtime returns 503 for missing/invalid stored configuration.

An incompatible old version returns 409 `AI_CONFIG_OUTDATED` and the current version. A known published version remains compatible when the only added questions are optional menu-category questions, all previous question definitions are unchanged and profile limits are unchanged. Existing profiles without category answers remain valid; explicit saves use the current version. Retired categories return `AI_INVALID_ANSWER` with `details.requiresPreferenceReview: true`. Unknown/retired question or option IDs fail validation; they are not silently removed. Fetch fresh config, let the user explicitly reconcile affected answers, and submit the current version with current ETags. Incompatible conversation contexts also fail closed until explicitly reconciled. Account restrictions are retained throughout; they never silently disappear because an option was retired.

## Preference profiles

All profile routes require Bearer auth.

| Method/path | Request | data / behavior |
| --- | --- | --- |
| GET /preference-profiles | none | `{ profiles: [...], defaultProfileId: string|null, defaultRevision: number }` |
| GET /preference-profiles/:id | UUID | Profile; ETag `"revision"` |
| PUT /preference-profiles/:id | body below | Create or replace; profile and ETag |
| DELETE /preference-profiles/:id | If-Match | Empty 204; deleting default atomically clears it and increments defaultRevision |
| PUT /preference-profiles/default | `{ profileId: UUID|null }`, If-Match | `{ defaultProfileId, defaultRevision }` and default ETag |

Profile response: `{ id, name, configVersion, answers, revision, createdAt, updatedAt }`. Names are trimmed user-entered content. The configured count/name limits are enforced while holding an owner-state row lock. Same names can identify distinct profiles. Saving never selects a default automatically. `/default` is registered before `/:id`.

Create requires `If-None-Match: *`. Update/delete requires `If-Match: "N"`. Default selection has a separate revision: use the `defaultRevision` from the list, not the profile revision. Initial defaultRevision is 1. A supplied default must be an owned, nondeleted profile. Null explicitly clears it. Repeated default writes with a current ETag are safe; a stale ETag is 412 even if the desired value now matches.

```bash
# Use question/option IDs returned by /config; these are initial-seed examples.
curl -i -X PUT 'http://localhost:4000/api/v1/ai/preference-profiles/16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7' \
  -H 'Authorization: Bearer YOUR_TOKEN' -H 'Content-Type: application/json' \
  -H 'If-None-Match: *' \
  -d '{"name":"Dinner with friends","configVersion":"VERSION","answers":{"spice":"mild","servings":2}}'

curl -X PUT 'http://localhost:4000/api/v1/ai/preference-profiles/default' \
  -H 'Authorization: Bearer YOUR_TOKEN' -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' \
  -d '{"profileId":"16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7"}'

curl -i -X DELETE 'http://localhost:4000/api/v1/ai/preference-profiles/16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7' \
  -H 'Authorization: Bearer YOUR_TOKEN' -H 'If-Match: "1"'
```

Missing preconditions return 428. A retry of an acknowledged/lost-response create receives 412 if already present; GET and reconcile instead of generating a second ID. Deleted IDs remain tombstones and cannot be resurrected: stale PUT/create returns 410 `AI_PROFILE_DELETED`. Repeated DELETE of an owned tombstone returns 204. The deleted profile's answers/name are cleared, but ownership/UUID/revision remain to prevent stale offline mutations. Another owner's profile is never returned, modified or claimed. A direct PUT collision returns generic 409 `AI_PROFILE_ID_CONFLICT`.

## Account-wide restrictions

```bash
curl -i 'http://localhost:4000/api/v1/ai/account-preferences' \
  -H 'Authorization: Bearer YOUR_TOKEN'

curl -i -X PUT 'http://localhost:4000/api/v1/ai/account-preferences' \
  -H 'Authorization: Bearer YOUR_TOKEN' -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' \
  -d '{"configVersion":"VERSION","answers":{"allergies":["milk"],"diet":["vegan"]}}'
```

GET/PUT return `{ answers, configVersion, revision, updatedAt }`, plus the account ETag. Empty accounts start with `{ answers: {}, configVersion: null, revision: 1, ... }`. PUT replaces the declaration explicitly, using the current config and account ETag; a stale revision returns 412. Account-scope questions cannot be submitted through saved occasion profiles.

`{}` / missing allergies / empty arrays are **unknown**, not confirmation of no allergies. Selecting the configured no-known option is an explicit declaration. Other selections represent explicit restrictions. Effective conversation restrictions are the union of account, selected profile and temporary restrictions. Diet restrictions and maximum budgets also combine conservatively. Temporary/profile answers cannot clear an account allergy; no-known options are rejected in temporary context. Only an explicit account-preference PUT changes personal restrictions.

Before each new chat turn, the server reloads account/profile state and persists the effective revision snapshot used by that turn. Changes committed during a running turn apply from the next turn, not retroactively to already streamed cards. Clients should wait for the current turn before changing restrictions and clearly show the context attached to each response.

## Offline guest import and login synchronization

`POST /preference-profiles/import` is authenticated and idempotent per customer/importId:

```bash
curl -X POST 'http://localhost:4000/api/v1/ai/preference-profiles/import' \
  -H 'Authorization: Bearer YOUR_TOKEN' -H 'Content-Type: application/json' \
  -d '{
    "importId":"a9621870-50d7-4886-8a5a-d58f8fac7fb6",
    "profiles":[{
      "id":"16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7",
      "name":"Local dinner profile",
      "configVersion":"VERSION",
      "answers":{"spice":"mild"}
    }],
    "defaultProfileId":"16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7"
  }'
```

Optional `accountPreferences` has `{ configVersion, answers }`. It is compared with account declarations but **never automatically written**. A difference returns 409 `AI_ACCOUNT_PREFERENCES_CONFLICT`, `{ accountRevision, requiresExplicitResolution: true }`, and commits no batch records. Present the declarations to the user, explicitly PUT the resolved account preferences with its ETag, then retry an import with a new appropriately resolved payload/importId. Omitting accountPreferences deliberately imports occasion profiles only; it is not an implicit resolution of guest allergies.

Response data:

```json
{
  "results": [
    {
      "localId": "16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7",
      "profileId": "177cc09f-5623-4f71-904a-78362823eb72",
      "status": "imported"
    }
  ],
  "defaultProfileId": "177cc09f-5623-4f71-904a-78362823eb72",
  "defaultRevision": 2
}
```

Fresh imports always receive a server UUID mapping, irrespective of cross-account collision, so the mapping behavior does not reveal another owner. Existing owned IDs/mappings are `skipped`; mapped deleted profiles are `deleted`. All items are validated, and over-limit batches fail atomically. An existing server default is preserved. A requested local default is selected only when no server default exists and the mapped item is nondeleted.

Retries with the same importId and canonical payload return the original result without writes; changed payload with the same importId returns 409 `AI_IMPORT_CONFLICT`. A new importId with the same local IDs still uses the saved mappings, preventing repeated-login duplicates. Import replay responses are historical operation results: **fetch current profiles/default after replay**, since an imported profile may have subsequently been edited/deleted. Replay never restores its deleted state or old default.

Frontend login sequence:

1. Bind every local queue, cache, import mapping and pending account update to the authenticated customer identity; do not reuse account A's pending writes for account B.
2. Fetch current config, backend profiles/default and account preferences/ETags.
3. Reconcile retired guest options and explicit personal restriction conflicts with the user.
4. Submit local guest profiles as an additional batch with a persisted importId. Do not match/overwrite by name.
5. Persist returned ID mappings and fetch authoritative backend state again.
6. Replay signed-in updates using their fetched revisions. On 412 fetch/merge explicitly; never blindly overwrite with old local state. Keep tombstones locally for deletes. Never generate another UUID merely because a response was lost.

Frontend owns local storage, pending writes and retry scheduling. This backend does not implement the Expo queue or make an existing mobile client compatible automatically. Preference import alone does not transfer conversation ownership; use the documented two-proof conversation claim endpoint.

## Conversations and context

| Method/path | Access | Request/response data |
| --- | --- | --- |
| POST /conversations | Bearer or guest | body below; conversation, contextRevision and optional new guestToken |
| GET /conversations | Bearer only | `?limit=&cursor=` -> `{ conversations, nextCursor }` |
| GET /conversations/:id | Owner Bearer or bound guest token | Current conversation/context and context ETag |
| GET /conversations/:id/messages | Owner Bearer or bound guest token | `?limit=&cursor=` -> `{ messages, nextCursor }` |
| DELETE /conversations/:id | Owner Bearer or bound guest token | empty 204 |
| PUT /conversations/:id/context | Owner Bearer or bound guest token | body below, If-Match context revision; updated conversation and ETag |

Creation body:

```json
{ "locale": "en", "preferenceProfileId": null }
```

Omitting preferenceProfileId selects the authenticated customer's default; explicit null selects no occasion profile while retaining personal restrictions. A supplied saved UUID must be owned. Guest creation can instead supply:

```json
{
  "locale": "en",
  "guestPreferences": {
    "configVersion": "VERSION",
    "profileAnswers": { "spice": "mild" },
    "accountAnswers": { "allergies": ["milk"] }
  }
}
```

Guests cannot select saved profiles. Authenticated creation rejects guestPreferences rather than silently importing them. Guests receive a cryptographically random 64-hex guestToken once; only its SHA-256 hash is stored. Send `X-AI-Guest-Token: TOKEN` on later guest operations. Conversation UUIDs grant no access. Guest tokens cannot list account conversations. Expired matching guest access returns 401; missing/wrong ownership returns generic 404. A Bearer header takes precedence; invalid Bearer credentials cannot be rescued by a guest header.

Conversation response fields: `id`, `locale`, `context`, `contextRevision`, `createdAt`, `updatedAt`, `expiresAt`. Context contains configVersion, preferenceProfileId, profileRevision, accountRevision, validated profileAnswers/accountAnswers/temporaryAnswers and effective restrictions. Turn records preserve the exact context used for that turn. These are private user data, not public config.

Explicit switch/update body:

```json
{
  "configVersion": "VERSION",
  "preferenceProfileId": null,
  "temporaryAnswers": { "allergies": ["peanuts"] }
}
```

Use the current context ETag (`"contextRevision"`, initially `"1"`), available from creation, GET /conversations/:id or a previous context update. After a stale context write, GET the conversation before reconciling/retrying. Omitted profile selection preserves the current conversation selection; null clears it. Omitted temporaryAnswers preserves the current temporary layer; `{}` clears that layer while leaving account/profile restrictions intact. Guests retain their validated creation snapshot and can add temporary restrictions. To change that personal guest snapshot or reconcile its retired options, explicitly create a new guest conversation with a freshly validated snapshot. Updating personal restrictions still requires the account endpoint. A running turn blocks context switches with 409. Switching affects subsequent turns and never mutates saved profiles, carts or orders.

Conversation lists are newest-first, cursor-paginated and owner scoped. History pages select the most recent messages before the cursor and return each page in chronological order. Follow nextCursor for older pages and prepend them. Config controls the page maximum/default. Messages include stable server-generated `id`, role, text, structured parts, createdAt, turnId, clientMessageId, status and errorCode. Status is RUNNING, COMPLETED, FAILED or CANCELLED. The frontend may restore `{ id, role, parts }` as UIMessage objects and display incomplete/failed status separately. Prices in historical cards are snapshots, not a checkout quote.

```bash
curl -X POST 'http://localhost:4000/api/v1/ai/conversations' \
  -H 'Content-Type: application/json' -d '{"locale":"en"}'

curl 'http://localhost:4000/api/v1/ai/conversations/CONVERSATION_UUID/messages?limit=20' \
  -H 'X-AI-Guest-Token: YOUR_GUEST_TOKEN'
```

## Streaming chat

```bash
curl -N -X POST 'http://localhost:4000/api/v1/ai/chat' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "conversationId":"CONVERSATION_UUID",
    "clientMessageId":"f3c29e45-f5d8-49a7-8bc3-0e8f25b60309",
    "text":"Recommend dinner from the menu",
    "locale":"en"
  }'
```

Guests substitute X-AI-Guest-Token. Only those four body fields are accepted. Locale must be supported and match the conversation. New text length comes from config. The backend loads trusted completed history; clients cannot submit system/assistant messages, tool outputs, prices or payment status.

Returns the installed SDK's UIMessage SSE protocol: `Content-Type: text/event-stream`, `x-vercel-ai-ui-message-stream: v1`, start/messageId, text-start/text-delta/text-end, validated custom data chunks, finish, and `data: [DONE]`. Internal tool inputs/results, reasoning and private prompts are not forwarded as tool stream events. The normal response interceptor is explicitly bypassed. JSON errors are returned before streaming; provider/timeout failures after headers are safe `{ "type":"error", "errorText":"AI_PROVIDER_TIMEOUT" }` protocol events. Stream failure details/credentials are never forwarded.

One turn per conversation can run at a time, enforced by a row lock and a partial unique index. `(conversationId, clientMessageId)` is unique:

- A completed identical retry replays the persisted assistant message/cards with the same server message ID. It does not call Gemini again.
- Reusing an ID for different text/locale returns 409 AI_MESSAGE_ID_CONFLICT.
- An active retry or competing turn returns 409 AI_TURN_IN_PROGRESS. Recover via history; do not generate a new ID just to bypass it.
- Failed/cancelled turns are not automatically regenerated. Fetch history, show the outcome, and use a new ID only for an explicit user retry.
- The frontend SDK's regenerate/edit-last-message actions are not this contract; disable them or implement an explicit new user turn.

Disconnects abort provider work and persist CANCELLED/partial content. Provider timeouts persist FAILED and a safe error code. Text/cards checkpoint roughly once per second during text generation and finally before success. A process crash can lose the last uncheckpointed fragment; a persisted lease is failed after expiry and is never silently regenerated. The UI should recover from history after disconnection, not assume every received partial fragment committed. There is no resumable live SSE/reconnect endpoint in this phase.

### Expo/React transport mapping

Create the conversation first. Do not send DefaultChatTransport's default full-message body to this endpoint. Example (adapt token storage and base URL to your app):

```typescript
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';

const transport = new DefaultChatTransport({
  api: `${apiBase}/api/v1/ai/chat`,
  fetch: expoFetch as typeof globalThis.fetch,
  headers: () => sessionToken
    ? { Authorization: `Bearer ${sessionToken}` }
    : { 'X-AI-Guest-Token': guestToken },
  prepareSendMessagesRequest: ({ messages, trigger }) => {
    if (trigger !== 'submit-message') throw new Error('Use a new user turn');
    const message = messages.at(-1);
    if (!message || message.role !== 'user') throw new Error('User text required');
    return {
      body: {
        conversationId,
        clientMessageId: message.id,
        text: message.parts
          .filter(part => part.type === 'text')
          .map(part => part.text)
          .join('\n'),
        locale,
      },
    };
  },
});

const chat = useChat({
  id: conversationId,
  generateId: () => Crypto.randomUUID(),
  transport,
  // Restore server history through messages: [{ id, role, parts }, ...].
  // Do not enable automatic resume; recover via the messages endpoint.
});
```

Keep transport state scoped to the current conversation/account. Persist the original client message UUID for network retries. Generic SDK message IDs may not be UUIDs: explicitly supply a UUID generator. Native rendering handles only documented text/data parts. The mobile implementation is separate from this backend change.

## Menu tools and cards

Allowlisted Gemini tools: searchMenu(query?), getRecommendations(query?), getFoodDetails(foodId). Inputs use strict Zod schemas. The model cannot add tools, pass ownership IDs, execute order/payment operations or alter stored preferences. A menu tool is required on the first generation step when recommendations are enabled. Tool calls/results are bounded by configured step, result, scan and character budgets. Errors become safe tool results; no invented fallback meals are produced by the backend.

The existing menu RPC returns major-unit prices. The adapter converts to integer minor units with a three-letter uppercase currency. The entire concierge card contract uses minor units; the rest of the existing mobile menu API is unchanged. Unavailable foods are excluded. Explicit diets must be restaurant declared. Budgets apply to the base meal in the selected currency, not unknown extras, taxes or delivery fees; incompatible currencies are excluded rather than converted. Eligible results are ranked by authoritative base price then ID. Bounded scans may omit later matches; cards include scanned/truncated.

Restaurant staff/backend management can populate menu-owned `FoodItem.dietaryInfo` through existing backend data-management tooling. No public write route was introduced. Exact declaration shape:

```json
{
  "dietaryTags": ["vegan"],
  "allergensKnown": true,
  "allergens": [],
  "mayContain": [],
  "crossContact": "controlled",
  "ingredients": ["Restaurant supplied ingredient"]
}
```

All fields except ingredients are required for a known declaration. Null, incomplete or invalid data is unknown. Dietary tags/allergen values must correspond to configured effect values to match constraints. No ingredient/allergen inference is made from food names, tags or descriptions. With explicit allergens, a food is eligible only when allergensKnown is true, crossContact is controlled, and neither allergens nor mayContain intersects restrictions. Existing menu rows default to unknown; this may yield no eligible allergy-restricted recommendations until the restaurant supplies data. Customisation allergen safety remains unknown even if the base meal has declarations. New recommendation and detail cards retain the `disclaimer` field as an empty string for response-shape compatibility; the blanket warning is no longer displayed. The model must still describe actual missing declarations when relevant and cannot claim allergen safety.

Recommendation responses distinguish missing dietary/allergen declarations from declared conflicts, unavailable meals and saved-budget mismatches. `missingInformation` contains the applicable exclusion explanations when a search has no eligible meals. A search with no matching rows does not claim a dietary conflict. Saved restrictions remain applied and are never silently changed to satisfy a chat request.

Empty recommendation cards are not emitted or persisted as UI cards. The model receives the empty tool result and its reasons, then explains the main supported reason and one next step in at most two short sentences (target: 40 words). It should not enumerate the full profile or add headings. Instructions call out conflicts such as a meat request against vegan preferences and suggest switching profiles or explicitly updating dietary choices. The final model step is reserved for an answer when the configured step allowance is greater than one. If the model produces no text after a recommendation search, the backend supplies a brief grounded English fallback using the main exclusion reason and relevant dietary labels. That text is streamed, saved and replayed like normal assistant text. The shipped configuration supports English; additional locales need translated deterministic fallback templates. Successful food cards are still emitted. The frontend should omit disclaimer UI when the value is empty. Previously stored cards and text remain unchanged.

Versioned custom UIMessage data parts (authoritative Zod schemas in `tools/cards.schema.ts`):

| type | data |
| --- | --- |
| data-food-recommendations | `{ version: 1, foods: FoodCard[], scanned, truncated, missingInformation: string[], disclaimer }` |
| data-food-details | `{ version: 1, food: FoodCard, disclaimer }` |
| data-preference-summary | `{ version: 1, profileId: UUID|null, profileRevision: number|null, accountRevision: number|null, allergyState, allergens: string[], diets: string[], preferredCategoryIds: string[] }` |
| data-chat-starters | `{ version: 1, chatStarters: [{ id, label, prompt, icon }] }` (exactly four searches) |

### Food names and contextual search starters

Every newly produced `data-food-recommendations.data.foods[]` item includes a nonempty `recommendationReason` string (maximum 600 characters). This is a short, user-facing explanation based on that item's actual price and applicable validated search/category/diet/budget matches. It does not expose private model reasoning, infer ingredients, or promise allergen safety. Templates support English, French, Spanish and Arabic according to the conversation locale. Dish names use Markdown bold. Even without explicit preferences, a reason identifies the item and its current menu price.

Example food fields: `{ "id": "food-id", "name": "Vegetable Curry", "recommendationReason": "**Vegetable Curry** is available for £12.50. It matches your saved dietary preferences and fits your saved budget." }` (other FoodCard fields omitted here). Reasons are generated by the backend menu adapter rather than taken from free-form model output, emitted with the card immediately, and persisted for history and retry replay. Existing stored cards may omit the field and remain valid; this change needs no database migration. Food-details cards may also omit it.

The mobile tooltip prefers `food.recommendationReason`, then the turn-level explanation for older messages, then a localized generic fallback. Its strict card schema accepts the optional field so a new reason does not make cards unrenderable. The fallback guarantees a tooltip even for old recommendation cards without assistant text. Different items can have the same matching criteria; reasons are not artificially invented to make every explanation unique.

Assistant prose uses Markdown bold for food/dish names and the selected dining profile name, for example `**Suya**` and `**Sunday Dining**`. The selected profile name is loaded within the authenticated customer scope and treated as display data. The model is instructed to format names, and the backend also formats names returned by menu tools. Each text block is buffered until its `text-end` event so names split across model deltas are handled consistently. Existing bold spans are preserved. History and replay retain the same Markdown. Render assistant text with Markdown support. Structured `FoodCard.name` values remain plain strings; style the name in the card renderer rather than treating Markdown as part of the food's identity.

When a completed recommendation-enabled turn returns no eligible food and the user has saved preferences (dietary, allergy, budget, category or profile answers), the response includes one `data-chat-starters` part after the brief explanation. This does not depend on exclusion-reason strings: empty search rows, ineligible food-details lookups and text-only conflict explanations are covered. It contains exactly four distinct search suggestions derived from the current validated profile, preferred categories and budget. These are search prompts, not claims that matching dishes are available. They never remove saved restrictions. A simple unmatched search without saved preferences does not trigger them. No starter part is added if that turn returned an eligible recommendation or food-details card. Existing saved replies are not retroactively changed: submit a new client message ID to test updated behavior; retrying a completed ID replays the original stored reply.

The frontend must register the new `data-chat-starters` part in its stream/history schema and render `data.chatStarters` as four buttons. Tapping a button submits its `prompt` as a normal user message in the same conversation with a new client message ID. Keep the usual offline/busy disabling. The part is persisted with the assistant message and replays with its original ID/content, so do not append duplicated suggestions during recovery. Its structure follows the configuration starters (`id`, `label`, `prompt`, `icon`), but the values are specific to this turn. These dynamic prompts currently use English templates with localized dietary/category labels, matching the shipped English configuration; further locales require translated templates.

`FoodCard` is `{ id, categoryId: string|null, name: string|null, description: string|null, price: { amountMinor, currency }, available, images: string[], dietaryInfo: declaration|null, informationStatus: "restaurant-declared"|"unknown", customisationStatus, modifierGroups, sizes, extras }`. Modifier groups have id, localized title, selectionType, minSelections, maxSelections|null, required and options. Options have id, localized name/description and price (the modifier offset in minor units, which can be negative). `customisationStatus` is available, unknown or details-required. Recommendation cards omit customisation lists and use details-required; fetch details with the details tool before rendering those controls. Sizes are `{ id, label, measurementLabel, priceOffset: { amountMinor, currency } }`. Extras are `{ sides, appetizers }`, each a list (or null when unknown) of `{ id, name, description, price: { amountMinor, currency }, image, unitLabel }`. Sizes/extras are validated and localized from existing menu JSON shapes; unsupported shapes become null. Every monetary field is in minor units, including offsets. No component/code/action instruction is executed from these values.

Each custom chunk carries a stable id; the persisted part retains its type/id/data. Card content is generated by domain adapters and validated, not taken from arbitrary model-generated JSON. No profile-selection card is required yet: the app switches profiles through its own selector and the explicit context endpoint.

## Reliability, logs and deployment

- Persistent fixed-minute rate buckets enforce accepted turns per account/guest token; guest conversation creation is also limited by the gateway-observed IP. Account creation consumes an account rate slot. Config guestTurns additionally limits total turns per guest conversation. The existing gateway ThrottlerGuard remains an independent IP safeguard.
- Behind a proxy, configure trusted proxy handling at your deployment boundary if using the real client IP. Do not blindly trust arbitrary forwarded headers. Without it, guests behind one proxy share the conservative observed-IP limit.
- Chat limits are runtime database configuration. Provider timeout, session retention and operational rates are server env settings. The textual context window reserves half its character budget for cumulative tool results. Fixed tool definitions/protocol overhead and provider token accounting are separate; maxOutputTokens caps generation. Oversized preference context fails rather than discarding allergies.
- JSON operational events record requestId, conversationId, turnId, final status, safe errorCode, durationMs and available token usage. Aggregate these logs for usage/latency/error metrics. They do not include message text, preferences, credentials or raw provider errors. General verbose request logging omits all AI body/query content. Request IDs are not propagated into existing menu/identity TCP transports in this phase.
- Every ten minutes an unref'd maintenance timer expires abandoned leases, removes expired rate buckets and purges up to 200 expired/deleted conversations with no running turn. It runs in each gateway instance; operations are idempotent. Related messages/turns cascade. Expired guests remain inaccessible even before purge. Profile UUID tombstones/import mappings are intentionally retained while the account exists to preserve offline retry safety.
- Use HTTPS. Disable proxy buffering/compression for `/api/v1/ai/chat`, allow a timeout longer than AI_PROVIDER_TIMEOUT_MS, and avoid CDN caching. The endpoint emits X-Accel-Buffering: no and Cache-Control: no-cache, no-transform. Do not add response-envelope or response-buffering interceptors to this route. Configure CORS for the mobile/web origin; ETag/request/stream headers are exposed by the gateway.
- Run identity and menu services alongside the gateway. The model has no autonomous order/payment tool. Explicit commerce action endpoints use the existing authentication system and server-issued quotes; checkout request contracts have changed as described in the extension.
- Model output remains probabilistic. Backend eligibility and card facts are deterministic, but natural-language compliance is enforced through the private instructions and tool policy, not a clinical guarantee. Test your chosen live model, prompts and real menu declarations before release. No paid/live Gemini test was run automatically.

## Error codes

| HTTP / stream | Codes |
| --- | --- |
| 400 | AI_INVALID_INPUT, AI_UNSUPPORTED_LOCALE, AI_UNKNOWN_QUESTION, AI_ANSWER_REQUIRED, AI_INVALID_ANSWER, AI_INVALID_PROFILE_NAME, AI_IMPORT_LIMIT, AI_INVALID_CURSOR, AI_CONTEXT_LIMIT |
| 401 | Existing invalid-session errors, AI_UNAUTHORIZED, AI_GUEST_EXPIRED |
| 403 | AI_GUEST_DISABLED |
| 404 | AI_PROFILE_NOT_FOUND, AI_CONVERSATION_NOT_FOUND |
| 409 | AI_CONFIG_OUTDATED, AI_PROFILE_ID_CONFLICT, AI_PROFILE_LIMIT, AI_IMPORT_CONFLICT, AI_ACCOUNT_PREFERENCES_CONFLICT, AI_MESSAGE_ID_CONFLICT, AI_TURN_IN_PROGRESS, AI_TURN_FAILED |
| 410 | AI_PROFILE_DELETED, AI_CONVERSATION_EXPIRED |
| 412 | AI_STALE_REVISION |
| 428 | AI_PRECONDITION_REQUIRED |
| 429 | AI_RATE_LIMITED, AI_GUEST_LIMIT, existing gateway throttling errors |
| 503 before stream | AI_NOT_CONFIGURED, AI_CONFIG_INVALID, AI_DISABLED, AI_FEATURE_DISABLED, AI_PROVIDER_UNAVAILABLE |
| error event after stream | AI_PROVIDER_UNAVAILABLE, AI_PROVIDER_TIMEOUT, AI_CANCELLED, AI_STREAM_FAILED, AI_HISTORY_INVALID |

Menu provider failures and ineligible details are converted to safe tool results (AI_MENU_UNAVAILABLE_OR_INELIGIBLE), not leaked exception payloads. Tool/result bounds return AI_TOOL_LIMIT / AI_TOOL_RESULT_LIMIT. A lost worker is recorded as AI_WORKER_LOST in history.

## Verification

```bash
npm test -- --runInBand --watchman=false
npm run test:ai
npm run test:e2e -- --runInBand --watchman=false
npx tsc --noEmit --incremental false
ESLINT_USE_FLAT_CONFIG=false npm run lint
npm run build
```

`test:ai` reads AI_TEST_DATABASE_URL or a local DATABASE_URL and uses an isolated randomly named schema; it never resets public application tables. Remote test databases require an explicit AI_TEST_DATABASE_URL. Tests mock Gemini, identity responses and menu RPC transport, retaining real HTTP, SDK streaming parsing, Prisma transactions and migrations. Existing authentication integration suites separately cover the real identity TCP/session lifecycle.

Current verification (2026-10-27): 76 unit tests, 46 concierge/commerce database/HTTP integration tests, and 30 existing HTTP/TCP integration tests passed (152 total). TypeScript, ESLint, all five Nest builds and diff checks passed. Provider calls were mocked. The additive conversation-commerce migration was applied to the configured application database, and Prisma reports the schema up to date. Integration data uses disposable isolated schemas. Other opt-in database suites remain opt-in. See the commerce extension for quote-only checkout compatibility and restaurant charge configuration.
