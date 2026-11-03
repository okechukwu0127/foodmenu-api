# FoodMenu API

NestJS backend for the FoodMenu mobile application: customer identity, menu discovery, AI-assisted recommendations, saved dining preferences, carts, server-priced checkout, Stripe payments, orders and delivery tracking.

This repository contains the **backend**. The Expo/React Native application is a separate project. The mobile app connects to the HTTP gateway; it does not connect directly to the database or private microservices.

## Contents

- [Features and architecture](#features-and-architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Database and configuration](#database-and-configuration)
- [API reference](#api-reference)
- [End-to-end flows](#end-to-end-flows)
- [Docker](#docker)
- [Mobile integration and tester builds](#mobile-integration-and-tester-builds)
- [Testing and development commands](#testing-and-development-commands)
- [Deployment and troubleshooting](#deployment-and-troubleshooting)
- [Documentation index](#documentation-index)

## Features and architecture

- Email/password registration, six-digit email activation, resend, Google sign-in and account linking.
- Persistent bearer sessions, protected customer resources, profile editing, password changes and photo uploads.
- Saved addresses with retry-safe replacement and an atomic default address.
- Public catalogue, categories, food details, modifiers, promotions and menu assets.
- Gemini text chat with persistent history, guest access, account claiming, saved dining profiles and preference imports.
- Menu-backed recommendations with dietary/allergy/availability/budget checks, dynamic category preferences, brief feedback, contextual search starters and per-item tooltip explanations.
- Conversation-linked selections, customisations, cart revisions, checkout and verified payment history.
- Server-calculated quotes, Stripe PaymentSheet integration, saved cards, payment reconciliation and refunds.
- Orders, fulfilment records, Stuart delivery integration and optional Google Routes map polylines.
- Sanitized JSON request/error logs, OpenAPI, database migrations and automated tests.

All services currently share the PostgreSQL database and Prisma schema, with domain operations owned by the appropriate service. Communication between services uses Nest TCP transport.

```mermaid
flowchart LR
  Mobile[Mobile application] --> Gateway[API Gateway]
  Gateway --> Identity[Identity service]
  Gateway --> Menu[Menu service]
  Gateway --> Orders[Order service]
  Gateway --> Payment[Payment service]
  Payment --> Menu
  Payment --> Orders
  Gateway --> Gemini[Gemini API]
  Identity --> SMTP[SMTP provider]
  Payment --> Stripe[Stripe]
  Orders --> Stuart[Stuart and Google Routes]
  Identity --> DB[(PostgreSQL)]
  Menu --> DB
  Orders --> DB
  Payment --> DB
  Gateway --> DB
```

| Service     | Default local address | Responsibility                                                                       | Development command          |
| ----------- | --------------------- | ------------------------------------------------------------------------------------ | ---------------------------- |
| API gateway | HTTP `localhost:4000` | Public APIs, authentication enforcement, AI concierge and conversation orchestration | `npm run start:dev:gateway`  |
| Payment     | TCP `127.0.0.1:4010`  | Quotes, Stripe, payment records and durable commerce events                          | `npm run start:dev:payment`  |
| Menu        | TCP `127.0.0.1:4020`  | Catalogue reads and authoritative cart pricing                                       | `npm run start:dev:menu`     |
| Order       | TCP `127.0.0.1:4030`  | Orders, checkout charges, fulfilment and tracking                                    | `npm run start:dev:order`    |
| Identity    | TCP `127.0.0.1:4050`  | Accounts, sessions, activation, profiles, addresses and photos                       | `npm run start:dev:identity` |

Port `4040` is not the identity-service default. Update the shared environment if a service port changes. TCP services are private backend interfaces, not mobile URLs.

```text
apps/                 Gateway and four domain microservices
libs/common/          HTTP filters, responses, logging and TCP message patterns
libs/config/          Environment validation
libs/database/        Shared Prisma module
libs/dto/             Shared API/RPC contracts and validation
libs/errors/          Application errors
libs/logger/          Logger helpers
libs/proto/           Reserved for future gRPC contracts
prisma/               Schema, migrations, catalogue seeds and configuration JSON
public/assets/        Menu images and public static assets
uploads/              Managed profile photos; excluded from Git
scripts/              Configuration publishers and database-test runners
docs/                 Feature guides and integration contracts
```

## Local setup

### 1. Prerequisites

Use Node.js **22** and npm (matching the Docker image), PostgreSQL **16** or a compatible PostgreSQL server, and optionally Docker Compose for the database. Run commands from this repository root.

Third-party credentials are feature-specific: Stripe for payments, SMTP for form signup, Google OAuth for Google login, Gemini for AI chat, and Stuart for courier dispatch. You can browse the menu without configuring every integration.

### 2. Install and configure

```bash
npm ci
cp .env.example .env
```

Edit `.env` using the [environment reference](#environment-variables). Do not replace an existing environment file containing your own settings. The shared environment validator requires `DATABASE_URL` and a nonempty `STRIPE_SECRET_KEY`; the example Stripe value is a placeholder and cannot process payments.

For form signup, generate a verification secret and place the output in `EMAIL_VERIFICATION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Configure the SMTP credentials before testing signup. For local email capture, use the Mailtrap Sandbox integration described below.

### 3. Start PostgreSQL

Use your existing server, or start only the database from Compose:

```bash
docker compose up -d postgres
```

With the example credentials, the host-run services use:

```dotenv
DATABASE_URL=postgresql://foodmenu:foodmenu@localhost:5432/foodmenu_api?schema=public
```

Wait for PostgreSQL to be ready before continuing. Its database/user/password must match the URL.

### 4. Apply the schema and initial data

```bash
npm run prisma:generate
npm run prisma:deploy

# Fresh development database only: rebuild the sample menu catalogue.
npm run prisma:seed

# Publish the AI configuration and restaurant checkout policy.
npm run ai:seed
npm run checkout:seed
```

Review `prisma/ai-concierge-config.json` and `prisma/checkout-policy.json` before publishing. Catalogue seeding resets catalogue data; do not use it to update an established restaurant catalogue. Migration deployment and configuration publishing are separate operations.

### 5. Start all five processes

```bash
npm run start:dev
```

The script starts the gateway, identity, menu, order and payment services with watch mode. Start a single service with the commands in the architecture table when debugging it; dependent services must still be running.

### 6. Check the application

```bash
curl http://localhost:4000/api/v1/health
curl http://localhost:4000/api/v1/menu/bootstrap
curl 'http://localhost:4000/api/v1/ai/config?locale=en'
```

- Swagger UI: <http://localhost:4000/api/docs>
- OpenAPI JSON: <http://localhost:4000/api/docs-json>
- All application HTTP endpoints use `/api/v1` once.

The health endpoint checks gateway responsiveness, not the readiness of every dependency. Menu/configuration requests exercise additional dependencies. A missing Gemini key blocks chat generation, not public configuration retrieval.

## Environment variables

[`.env.example`](.env.example) is the starting template. [Environment validation](libs/config/src/env.validation.ts) defines validated defaults. Restart the affected processes after changing environment settings. Values below describe defaults or examples, not credentials to use in production. Keep real secrets in `.env` or your deployment secret manager.

### Runtime, network, database and assets

| Variable                                            | Default/example                                  | Purpose                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                          | `development`                                    | `development`, `test` or `production`                                                                                  |
| `API_GATEWAY_PORT`                                  | `4000`                                           | Public HTTP listener                                                                                                   |
| `DATABASE_URL`                                      | PostgreSQL connection URL                        | Required Prisma connection, including target database/schema                                                           |
| `PAYMENT_SERVICE_HOST`, `PAYMENT_SERVICE_PORT`      | `127.0.0.1`, `4010`                              | Payment TCP listener/client destination                                                                                |
| `MENU_SERVICE_HOST`, `MENU_SERVICE_PORT`            | `127.0.0.1`, `4020`                              | Menu TCP listener/client destination                                                                                   |
| `ORDER_SERVICE_HOST`, `ORDER_SERVICE_PORT`          | `127.0.0.1`, `4030`                              | Order TCP listener/client destination                                                                                  |
| `IDENTITY_SERVICE_HOST`, `IDENTITY_SERVICE_PORT`    | `127.0.0.1`, `4050`                              | Identity TCP listener/client destination                                                                               |
| `IDENTITY_SERVICE_TIMEOUT_MS`                       | `10000`                                          | Gateway-to-identity timeout                                                                                            |
| `FOODMENU_APP_URL`                                  | Validator: `*`; example: `http://localhost:8082` | Allowed browser origin for CORS; set your deployed frontend origin                                                     |
| `PUBLIC_ASSET_BASE_URL`                             | `http://localhost:4000`                          | Public origin/base for uploaded photos and menu asset URLs; use a device-reachable URL locally and HTTPS in production |
| `PROFILE_PHOTO_STORAGE_DIR`                         | `uploads/profile-photos`                         | Shared photo directory: identity writes, gateway serves                                                                |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `foodmenu`, `foodmenu`, `foodmenu_api`           | Compose database initialization; changing these does not rewrite an existing database volume                           |
| `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD` | Example pgAdmin login                            | Used only if you enable the commented pgAdmin service                                                                  |

For services on the host, use loopback TCP addresses. In separate containers, use service DNS names for clients and `0.0.0.0` for listeners; see [Docker](#docker). `localhost` inside a container refers to that container.

### Identity, Google login and email activation

| Variable                         | Default/example                        | Purpose                                                                                                                |
| -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_IDS`              | Empty                                  | Comma-separated Google OAuth Web/server client IDs accepted as ID-token audiences; no Google client secret is required |
| `AUTH_SESSION_TTL_SECONDS`       | `604800`                               | Bearer session lifetime: seven days by default                                                                         |
| `EMAIL_VERIFICATION_SECRET`      | Empty; generate at least 32 characters | HMAC secret for activation challenges; keep stable across identity instances                                           |
| `EMAIL_VERIFICATION_TTL_SECONDS` | `14400`                                | Code expiry: only `7200` (two hours) or `14400` (four hours) is accepted                                               |
| `SMTP_HOST`                      | Example: `sandbox.smtp.mailtrap.io`    | SMTP server; required for activation delivery                                                                          |
| `SMTP_PORT`                      | Validator: `587`; example: `2525`      | SMTP port                                                                                                              |
| `SMTP_SECURE`                    | `false`                                | `true` for immediate TLS, typically port 465; `false` for STARTTLS connections                                         |
| `SMTP_USER`, `SMTP_PASSWORD`     | Empty                                  | SMTP provider credentials                                                                                              |
| `SMTP_FROM`                      | Example: `no-reply@example.com`        | Sender email; use a verified sender/domain for live email delivery                                                     |

**Mailtrap Sandbox setup:** open your Mailtrap sandbox → Integration → SMTP, copy its username/password into `SMTP_USER` and `SMTP_PASSWORD`, and use the host/port displayed there. The template uses port 2525 with `SMTP_SECURE=false`. Sandbox captures messages in Mailtrap instead of delivering them to the user's real inbox. For live delivery, use your provider's verified sending-domain credentials. See [email verification](docs/email-verification.md) for the complete setup and recovery behavior.

`GOOGLE_CLIENT_IDS` configures login only. It is distinct from the Gemini key and Routes key. See the [Google/mobile authentication guide](docs/mobile-authentication.md) for Android signing certificates, iOS bundle IDs and native SDK configuration.

### AI concierge

| Variable                       | Default            | Purpose                                                        |
| ------------------------------ | ------------------ | -------------------------------------------------------------- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Empty              | Backend-only Gemini API key; required to generate chat replies |
| `AI_CONCIERGE_MODEL`           | `gemini-3.8-flash` | Model ID; choose one available to your Google project          |
| `AI_PROVIDER_TIMEOUT_MS`       | `45000`            | Generation timeout                                             |
| `AI_GUEST_TTL_SECONDS`         | `86400`            | Guest conversation lifetime                                    |
| `AI_RETENTION_DAYS`            | `30`               | Conversation retention setting                                 |
| `AI_ACCOUNT_RATE_LIMIT`        | `20`               | Accepted account chat turns per minute                         |
| `AI_GUEST_RATE_LIMIT`          | `5`                | Accepted guest chat turns per minute                           |
| `AI_GUEST_CREATE_RATE_LIMIT`   | `3`                | Guest conversation creations per minute per observed IP        |

The gateway also has general HTTP throttling. Restaurant content, questions, supported locales, chat limits and capabilities live in the published AI configuration, not these environment variables. Private provider keys must never be placed in `EXPO_PUBLIC_*` variables.

### Stripe

| Variable                | Default/example                  | Purpose                                                                              |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `STRIPE_SECRET_KEY`     | `sk_test_replace_me` in template | Required by shared startup validation; replace with your Stripe test/live secret key |
| `STRIPE_WEBHOOK_SECRET` | Empty                            | Endpoint signing secret for Stripe event verification                                |

Use Stripe test mode for development. The mobile Stripe publishable key belongs in the frontend; the secret key and webhook signing secret stay on the backend.

### Stuart courier and Google Routes

| Variable                                              | Default/example                   | Purpose                                                                                         |
| ----------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `STUART_API_BASE_URL`                                 | `https://api.sandbox.stuart.com`  | Courier API environment                                                                         |
| `STUART_CLIENT_ID`, `STUART_CLIENT_SECRET`            | Empty                             | Stuart API credentials                                                                          |
| `STUART_ACCOUNT_ID`                                   | Empty                             | Account identifier when required by the provider configuration                                  |
| `STUART_PICKUP_ADDRESS`                               | Restaurant address                | Pickup address; replace the template value                                                      |
| `STUART_PICKUP_LATITUDE`, `STUART_PICKUP_LONGITUDE`   | Restaurant coordinates            | Must describe the same location as the pickup address                                           |
| `STUART_PICKUP_COMPANY`                               | `FoodMenu`                        | Pickup business name                                                                            |
| `STUART_PICKUP_FIRST_NAME`, `STUART_PICKUP_LAST_NAME` | `FoodMenu`, `Kitchen`             | Pickup contact                                                                                  |
| `STUART_PICKUP_PHONE`, `STUART_PICKUP_EMAIL`          | Restaurant contact details        | Courier pickup contact                                                                          |
| `STUART_PICKUP_COMMENT`                               | Example pickup note               | Instructions for the courier                                                                    |
| `STUART_PICKUP_DELAY_MINUTES`                         | `15`                              | Pickup scheduling delay                                                                         |
| `STUART_PACKAGE_TYPE`                                 | `medium`                          | Provider package type                                                                           |
| `STUART_FALLBACK_CUSTOMER_PHONE`                      | Empty; template has a test number | Optional fallback delivery contact; collect a real customer phone for live delivery             |
| `STUART_WEBHOOK_SECRET`                               | Empty                             | Expected `X-Stuart-Webhook-Secret` header                                                       |
| `GOOGLE_ROUTES_API_KEY`                               | Empty                             | Optional road-route polyline lookup; tracking still returns without a polyline when unavailable |

Courier settings do not enable checkout delivery by themselves. Publish an enabled checkout policy with the correct country/postcode coverage and fee. The current delivery fee is policy-based, not a live Stuart quote. See [conversation commerce](docs/conversation-commerce.md).

### Logging

| Variable           | Default                   | Purpose                                                                         |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------- |
| `HTTP_LOG_HEADERS` | `false`                   | Include allowlisted/redacted headers                                            |
| `HTTP_LOG_BODY`    | `false`                   | Include sanitized body/query metadata                                           |
| `LOG_PRETTY`       | Development pretty output | Set `false` for one JSON object per line; production uses compact output        |
| `LOG_COLOR`        | `auto`                    | `auto`, `always` or `never`; use `always` for red errors through `concurrently` |
| `NO_COLOR`         | Unset                     | Disables terminal colouring when present                                        |

Request IDs correlate completion and HTTP error logs. Tokens, passwords, codes, payment secrets and sensitive fields are redacted; AI body/query content is omitted. Full response bodies are not logged. See [request logging](docs/request-logging.md).

## Database and configuration

| Command                          | Effect                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `npm run prisma:generate`        | Regenerate the Prisma client after schema/package changes                      |
| `npm run prisma:deploy`          | Apply checked-in migrations without creating new ones                          |
| `npm run prisma:migrate`         | Development workflow for creating/applying schema migrations                   |
| `npm run prisma:seed`            | Reset/rebuild development catalogue seed data and seed fulfilment providers    |
| `npm run db:setup`               | Run migrations and catalogue seed; intended for a fresh development database   |
| `npm run prisma:link-promotions` | Link/update dedicated promotion foods without resetting the entire catalogue   |
| `npm run prisma:studio`          | Open the database browser                                                      |
| `npm run ai:seed`                | Validate and publish an immutable AI base configuration                        |
| `npm run checkout:seed`          | Publish/update restaurant charge policy; changed settings advance its revision |

Configuration sources:

- [`prisma/ai-concierge-config.json`](prisma/ai-concierge-config.json): localized welcome/onboarding content, greeting, initial starters, stages, questions and limits. Editing this file alone does not change the active database configuration; publish it with `npm run ai:seed`.
- [`prisma/checkout-policy.json`](prisma/checkout-policy.json): currency, pickup/delivery availability, delivery fee/coverage and tax surcharge. Review before running `npm run checkout:seed`. Monetary amounts in this policy are minor units; `500` means £5 for GBP.
- [`prisma/seed-data/`](prisma/seed-data/): catalogue seed data and asset URL helpers. Set the public asset base before seeding when URLs should point at a LAN/deployed origin.

`db:setup` does **not** publish AI or checkout configuration. Run their publishers separately. Publishers accept an alternative JSON path; `ai:seed` also accepts an explicit version:

```bash
npm run ai:seed -- ./prisma/ai-concierge-config.json restaurant-v2
npm run checkout:seed -- ./prisma/checkout-policy.json
```

Major relationships include `Customer` → authentication accounts/sessions, addresses and orders; AI customer state/profiles → conversations → turns/messages; and conversation commerce → quotes → payments/orders. Durable payment events reconcile verified results into chat history. The checked-in migrations include both the concierge and continuous-commerce tables: deploy them before services begin polling.

Active category options are loaded through the menu service from `Category`; they are not copied into the AI JSON. Category edits update the configuration representation without publishing another base version. Existing compatible profiles remain usable; retired choices require explicit review. See [dynamic preferences](docs/dynamic-category-preferences.md).

Catalogue visibility excludes foods attached to deals/hot combos from ordinary catalogue/search results, even when a promotion is inactive or expired. Active foods remain available by direct ID lookup, and promotion endpoints include linked food data. Promotion links alone do not apply checkout discounts.

## API reference

Use Swagger for DTOs and the guides below for full workflows, streaming, retries and ownership rules. Some AI/commerce bodies use runtime Zod validation, so the guides and shared schemas supplement OpenAPI.

### Authentication and responses

Protected endpoints require:

```http
Authorization: Bearer YOUR_FOODMENU_SESSION_TOKEN
```

This is the backend-issued session token, not a Google ID token. The server derives customer ownership from the session. Do not send a customer ID to select another customer's data. Missing/invalid sessions return `401`; inactive password accounts return `403 ACCOUNT_NOT_ACTIVATED` after valid credentials.

Ordinary JSON successes contain the resource under `data`:

```json
{
  "success": true,
  "status": "success",
  "statusCode": 200,
  "message": "Request successful",
  "data": {},
  "path": "/api/v1/example",
  "timestamp": "2026-10-30T00:00:00.000Z"
}
```

Errors include `success: false`, `message`, `statusCode` and `error: { code, details? }`. Inspect `error.code`, not only the text. Empty `204` responses have no JSON body. AI chat streams SSE instead of this envelope. Public AI configuration returns `{ success: true, data }` with a full HTTP `200` and `Cache-Control: no-store`, including when older clients send `If-None-Match`; its ETag is representation metadata. Versioned resource writes still require their documented `If-Match`/`If-None-Match` revision rules.

### Endpoint index

Every path below starts with `/api/v1`.

| Area                   | Method and path                                                                                                           | Access / behavior                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Health                 | `GET /health`                                                                                                             | Public; gateway liveness                                                              |
| Catalogue              | `GET /menu/bootstrap`, `/menu/categories`, `/menu/foods`, `/menu/foods/:foodId`                                           | Public menu data; foods support categoryId, search, isPopular, page, limit and cursor |
| Promotions/assets      | `GET /menu/deals`, `/menu/hot-combos`, `/menu/hero-slides`, `/menu/drink-add-ons`                                         | Public                                                                                |
| Modifiers              | `GET /menu/modifier-groups`, `/menu/modifier-label-translations`                                                          | Public                                                                                |
| Registration           | `POST /auth/signup`, `/auth/verify-email`, `/auth/resend-verification`                                                    | Public, rate-limited; signup sends an activation code                                 |
| Login                  | `POST /auth/signin`, `/auth/google`                                                                                       | Public; Google accepts `{ idToken }`                                                  |
| Account linking        | `POST /auth/google/link`                                                                                                  | Session plus Google identity proof                                                    |
| Profile                | `GET /auth/me`, `PATCH /auth/me`                                                                                          | Session; current customer only                                                        |
| Photo                  | `POST /auth/me/photo`                                                                                                     | Session; multipart `photo` upload                                                     |
| Session/password       | `POST /auth/logout`, `/auth/change-password`                                                                              | Session; password change revokes all sessions                                         |
| Addresses              | `GET /me/addresses`, `PUT /me/addresses/:id`, `DELETE /me/addresses/:id`                                                  | Session; client-generated address IDs, scoped to customer                             |
| Default address        | `PUT /me/addresses/default`                                                                                               | Session; `{ addressId }`, including null                                              |
| AI configuration       | `GET /ai/config?locale=en`                                                                                                | Public localized configuration                                                        |
| Dining profiles        | `GET /ai/preference-profiles`, `GET/PUT/DELETE /ai/preference-profiles/:id`                                               | Session; revision-aware writes                                                        |
| Profile import/default | `POST /ai/preference-profiles/import`, `PUT /ai/preference-profiles/default`                                              | Session; documented import/default revision contracts                                 |
| Account restrictions   | `GET/PUT /ai/account-preferences`                                                                                         | Session; personal restrictions are separate from dining profiles                      |
| Conversations          | `POST/GET /ai/conversations`, `GET/DELETE /ai/conversations/:id`                                                          | Authenticated or supported guest flow; ownership enforced                             |
| Context/history        | `PUT /ai/conversations/:id/context`, `GET /ai/conversations/:id/messages`                                                 | Bound conversation owner                                                              |
| Chat                   | `POST /ai/chat`                                                                                                           | Session or bound guest proof; AI SDK UIMessage SSE stream                             |
| Conversation commerce  | `GET /ai/conversations/:id/commerce`, `POST /ai/conversations/:id/actions`                                                | Owner; validated selections, cart mutations and checkout preparation                  |
| Guest transfer         | `POST /ai/conversations/:id/claim`                                                                                        | Both account session and original guest proof                                         |
| Conversation payment   | `POST /ai/conversations/:id/payment`, `/ai/conversations/:id/payment/cancel`                                              | Session; verified quote/payment ownership                                             |
| Standard checkout      | `POST /payments/stripe/quotes`, `/payments/stripe/payment-intent`                                                         | Session; backend quote, then `{ quoteId }`                                            |
| Save cards             | `POST /payments/stripe/setup-intent`, `GET/POST /payments/stripe/payment-methods`                                         | Session; collect card details through Stripe UI                                       |
| Manage saved cards     | `PATCH/DELETE /payments/stripe/payment-methods/:paymentMethodId`                                                          | Session; ownership enforced                                                           |
| Payment state          | `POST /payments/stripe/confirm`, `GET /payments/stripe/status/:paymentIntentId`                                           | Session; actual Stripe status                                                         |
| Refund                 | `POST /payments/stripe/refund`                                                                                            | Session and existing resource-ownership checks                                        |
| Orders                 | `GET /orders`, `GET /orders/:orderId`                                                                                     | Session; list active/completed/cancelled groups; ID or order number                   |
| Tracking               | `GET /orders/:orderId/tracking`                                                                                           | Session; courier state and optional route coordinates                                 |
| Fulfilment             | `GET /orders/fulfilment/providers`, `POST /orders/:orderId/fulfilment`, `PATCH /orders/:orderId/fulfilment/:fulfilmentId` | Session and existing ownership checks                                                 |
| Provider callbacks     | `POST /webhooks/stripe`, `/webhooks/stuart`                                                                               | Provider verification, not a user login session                                       |

Saved addresses can omit coordinates; delivery checkout currently needs a structured address with coordinates. There is no `/me/addresses/sync` endpoint: the four address endpoints replace that older mobile contract.

### Authentication smoke test

Configure SMTP first. Replace the email/phone with test values you control:

```bash
curl -X POST http://localhost:4000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Customer","email":"tester@example.com","phone":"+447700900123","password":"ExamplePassword123!"}'

# Replace the sample code with the six-digit string from the email.
curl -X POST http://localhost:4000/api/v1/auth/verify-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"tester@example.com","code":"123456"}'

curl -X POST http://localhost:4000/api/v1/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"email":"tester@example.com","password":"ExamplePassword123!"}'

curl http://localhost:4000/api/v1/auth/me \
  -H 'Authorization: Bearer YOUR_FOODMENU_SESSION_TOKEN'
```

Signup and verification do not issue a session; successful signin does. Codes are single-use, expire two/four hours after SMTP accepts delivery and can be resent subject to cooldown/attempt limits. An email-send failure can leave an inactive account; use resend instead of registering repeatedly.

## End-to-end flows

### Customer account

Form signup → email code → verify → signin → store session securely → edit profile/upload photo/save addresses. Google signup/signin verifies the provider identity and uses the same FoodMenu session system. Google-only accounts cannot change a password they have not set; follow the documented password-account behavior.

### AI-assisted ordering

1. Fetch `/ai/config` and render its localized stages, questions, greeting and initial starters.
2. Select/save a dining profile and account restrictions, or begin the supported guest conversation flow.
3. Create a conversation; submit text with its conversationId, a new clientMessageId and matching locale.
4. Render assistant Markdown and supported data parts: food recommendations/details, preference summaries, contextual starters and commerce cards.
5. Each new recommendation includes `food.recommendationReason` for its tooltip. Food/profile names in prose use bold. When no eligible meals are returned for a user with saved preferences, a brief explanation and four `data-chat-starters` search prompts are supplied.
6. Send explicit selection/customisation/cart actions. The model does not autonomously modify the cart or spend money.
7. Sign in before checkout. Claim an existing guest conversation with both proofs to keep its history/cart; importing preferences alone does not transfer it.
8. Prepare checkout; confirm the backend quote and open Stripe PaymentSheet through the documented payment endpoint.
9. Recover actual payment/order status after cancellation, disconnection or restart. Persisted verified commerce events keep the conversation continuous through confirmation.

User dietary/allergy settings are not silently removed to satisfy a request. Foods without sufficient declarations may be excluded. Search starters are suggestions to search, not guarantees of available matching meals. See [AI API](AI_CONCIERGE_API.md) and [commerce API](docs/conversation-commerce.md) for exact payloads, action revisions and retry rules.

### Standard cart checkout

Create a server quote before a payment intent. The quote endpoint accepts food/option IDs, quantities and fulfilment input, not client totals:

```bash
curl -X POST http://localhost:4000/api/v1/payments/stripe/quotes \
  -H 'Authorization: Bearer YOUR_FOODMENU_SESSION_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "requestId":"5ae7a115-8a5e-4d21-967e-0c542c7c4346",
    "items":[{
      "lineId":"e6cf849b-2455-428b-a3ee-b6a51376fb2d",
      "foodId":"REPLACE_WITH_MENU_FOOD_ID",
      "quantity":1,
      "modifiers":[],
      "extras":[]
    }],
    "checkout":{"fulfilment":"pickup"}
  }'

curl -X POST http://localhost:4000/api/v1/payments/stripe/payment-intent \
  -H 'Authorization: Bearer YOUR_FOODMENU_SESSION_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"quoteId":"SERVER_QUOTE_UUID"}'
```

Select required sizes/modifiers from the real menu; the illustrative empty selections above are valid only for foods without those requirements. Generate a new request UUID for a new checkout; reuse the same ID/body when retrying an uncertain response. A conversation quote must use its conversation payment endpoint. Treat payment secrets as transient and use the server's verified status instead of a client-supplied success flag.

### Webhooks and tracking

Forward Stripe test events to the gateway, then set the printed signing secret in `.env` and restart payment-service:

```bash
stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe
```

Configure Stuart with a publicly reachable HTTPS callback ending in `/api/v1/webhooks/stuart` and matching `X-Stuart-Webhook-Secret`. Use a tunnel for local provider callbacks; use a stable deployed URL for testers. Successful payment drives the order/fulfilment flow; dispatch requires valid Stuart credentials and restaurant/contact settings. Tracking can return an empty route when Google Routes is unconfigured or unavailable.

## Docker

The easiest local workflow is **PostgreSQL in Docker, services on the host** using the local-setup steps above. `docker compose up -d postgres` does not start the other services. pgAdmin is currently commented out in [`docker-compose.yml`](docker-compose.yml); it is not available at port 5050 unless enabled.

For the full stack, the current Compose file needs container-appropriate database and listener/client settings. With the example PostgreSQL credentials, save this as `docker-compose.local.yml` (replace credentials consistently if yours differ):

```yaml
x-database: &database
  DATABASE_URL: postgresql://foodmenu:foodmenu@postgres:5432/foodmenu_api?schema=public

services:
  api-gateway:
    environment:
      <<: *database
    volumes:
      - ./public/assets:/app/public/assets:ro
  identity-service:
    environment:
      <<: *database
      IDENTITY_SERVICE_HOST: 0.0.0.0
  menu-service:
    environment:
      <<: *database
      MENU_SERVICE_HOST: 0.0.0.0
  order-service:
    environment:
      <<: *database
      ORDER_SERVICE_HOST: 0.0.0.0
  payment-service:
    environment:
      <<: *database
      PAYMENT_SERVICE_HOST: 0.0.0.0
      MENU_SERVICE_HOST: menu-service
```

The base Compose file already overrides gateway client hosts to service DNS names and payment's order client to `order-service`. Apply migrations and seed/publish initial configuration from the host against the exposed database before starting application containers:

```bash
docker compose up -d postgres
# Run the schema/seed/publisher steps from Local setup, against localhost:5432.
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

Compose dependencies do not guarantee database/service readiness. Check logs if a process starts before a dependency is ready. The asset mount supplies catalogue images, which the current runtime image does not copy. The runtime image contains built services but omits development tooling and the source publisher scripts: run catalogue/AI/policy publishers from a management checkout with development dependencies installed, not inside the lean runtime image.

The photo volume is shared read/write by identity and read-only by the gateway. Persist it and the PostgreSQL volume. Use `docker compose down` to stop the base stack; include the same `-f` arguments when managing the overridden stack. Removing volumes deletes persisted data.

## Mobile integration and tester builds

Use a URL reachable from the device as the frontend API base, for example `EXPO_PUBLIC_API_BASE_URL=https://api.your-domain.example`. A physical phone cannot use your laptop's `localhost`; use a LAN address on the same network or a deployed HTTPS gateway. Set `PUBLIC_ASSET_BASE_URL` consistently so images are reachable too. The frontend should unwrap JSON `data`, preserve authentication/revision headers, and parse `/ai/chat` as an AI SDK UIMessage stream rather than ordinary JSON.

The backend uses AI SDK 6; the mobile app uses a compatible UIMessage client. Disable proxy response buffering for `/api/v1/ai/chat` and allow a timeout longer than `AI_PROVIDER_TIMEOUT_MS`. Client message/action IDs support recovery; reusing a completed message ID replays the stored reply, not a fresh model response.

For Expo tester distribution from the **frontend** project (not this backend repository):

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

Use an internal-distribution preview profile that produces an APK. Android testers can download and install it without a Play Store account; they may need to allow installation from that download source. Configure preview API URLs and native Google/Stripe settings before building. A standalone preview build should not depend on your laptop's Metro server.

For iOS, remote installation through ad hoc distribution requires paid Apple Developer membership and registered devices; TestFlight requires App Store Connect setup. A free Apple Account permits limited personal-device testing with Xcode, with seven-day provisioning expiry, rather than general download-link distribution. This app uses native integrations, so Expo Go is not a substitute for testing the complete native build.

References: [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/) and [Apple account capabilities](https://developer.apple.com/help/account/basics/about-your-developer-account/).

## Testing and development commands

```bash
npm test -- --runInBand --watchman=false
npm run test:e2e -- --runInBand --watchman=false
npm run test:addresses
npm run test:email-verification
npm run test:profile-photos
npm run test:ai
npx tsc --noEmit --incremental false
ESLINT_USE_FLAT_CONFIG=false npm run lint
npm run build
```

The dedicated database-test runners create disposable schemas and use local `DATABASE_URL` by default. They require database credentials with permission to create/drop schemas and apply migrations. For an explicitly chosen remote test database, use the respective variable: `ADDRESSES_TEST_DATABASE_URL`, `EMAIL_VERIFICATION_TEST_DATABASE_URL`, `PROFILE_PHOTOS_TEST_DATABASE_URL` or `AI_TEST_DATABASE_URL`. Generic `test:e2e` may skip database suites unless their test settings are supplied; use the dedicated runners for those features.

Automated AI tests mock Gemini rather than making paid model calls. Passing mocked tests does not verify your live provider credentials/model availability. SMTP/Stripe test doubles similarly do not replace testing configured provider integrations.

The repository currently uses `.eslintrc.cjs` with ESLint 9, so the legacy compatibility environment variable above is needed. `npm run format` formats source files broadly; scope Prettier to the files you intend to change when working in a dirty checkout.

`npm run build` builds all five services. For compiled execution, start each in its own process:

```bash
npm run start:identity
npm run start:menu
npm run start:order
npm run start:payment
npm run start:gateway
```

## Deployment and troubleshooting

Deploy migrations before updated services, generate/build with the locked dependencies, publish reviewed AI/checkout configuration, and start all five processes. Use HTTPS for the public gateway and assets, persistent photo storage, appropriate CORS origins, private TCP networking and configured provider webhooks. In production, prefer compact JSON logs and `LOG_COLOR=never`. Keep database backups and restaurant configuration outside disposable development resets.

| Symptom                                                                          | What to check                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `P2021`, missing `AuthAccount`, `AiConversation` or `PaymentCommerceEvent` table | Correct `DATABASE_URL`; run `npm run prisma:deploy` and `npm run prisma:generate` before restart                                                                                                       |
| `EADDRINUSE`                                                                     | Stop the old process or change that service's configured port for both listener and clients                                                                                                            |
| TCP `ECONNREFUSED`, menu unavailable or quote RPC failure                        | Owning service running; matching hosts/ports; container DNS versus loopback; dependency readiness                                                                                                      |
| `AI_NOT_CONFIGURED`                                                              | Run `npm run ai:seed` against the database used by the gateway                                                                                                                                         |
| AI JSON edits do not appear                                                      | Publish a new immutable configuration, then reload the frontend configuration                                                                                                                          |
| `AI_CONFIG_OUTDATED` or retired choices                                          | Fetch config and explicitly review affected preferences; do not discard saved allergy answers                                                                                                          |
| Frontend says offline while `/ai/config` succeeds                                | Current config returns full HTTP 200; reload the current app bundle, validate the payload and inspect the frontend cache/error state. An older server's 304 is cache validation, not a network failure |
| Empty recommendations                                                            | Check selected profile/account restrictions, real menu availability, catalogue visibility and restaurant `dietaryInfo`; the AI cannot invent a suitable dish                                           |
| Unsupported/blank AI card or tooltip                                             | Update the frontend schema/renderers for current card types, including `data-chat-starters` and per-food `recommendationReason`; keep legacy fallbacks                                                 |
| Provider/model unavailable                                                       | Correct server-only Gemini key, model override and Google project access; restart after env edits                                                                                                      |
| `EMAIL_DELIVERY_NOT_CONFIGURED` or email-send failure                            | SMTP host/from/credentials, stable verification secret, provider TLS/port settings; resend for an already-created inactive account                                                                     |
| `ACCOUNT_NOT_ACTIVATED`                                                          | Verify the emailed code, then sign in for a new session                                                                                                                                                |
| Checkout unavailable                                                             | Publish checkout policy; enable fulfilment/country/postcode coverage; ensure menu, order and payment services are reachable                                                                            |
| Delivery fails or pickup is wrong                                                | Valid Stuart environment/credentials, matching restaurant address/coordinates, contact phone and callback secret                                                                                       |
| Broken image URLs                                                                | Reachable `PUBLIC_ASSET_BASE_URL`, correct seed URLs, static assets and shared photo storage                                                                                                           |
| Signup/email/AI works locally but not for testers                                | Public HTTPS backend URL in the built frontend, reachable assets, all services deployed and correct provider environment                                                                               |

Apple/Facebook social login, forgot-password/email-based password recovery, voice transcription, wallets and notification APIs are not implemented by the current backend. Password change is authenticated and separate from password recovery. A future admin catalogue editor also needs its own authorization model.

## Documentation index

| Guide                                                                                              | Covers                                                                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [OpenAPI UI](http://localhost:4000/api/docs) / [OpenAPI JSON](http://localhost:4000/api/docs-json) | Running gateway's request/response API descriptions                                                 |
| [Mobile authentication](docs/mobile-authentication.md)                                             | Google Cloud/native setup, form login, session tokens and protected resources                       |
| [Identity service](docs/identity-service.md)                                                       | Service boundary, private TCP startup and profile ownership                                         |
| [Email verification](docs/email-verification.md)                                                   | Six-digit codes, Mailtrap/SMTP, resend, expiry and activation errors                                |
| [Password management](docs/password-management.md)                                                 | Current/new password API, Google-only accounts and session revocation                               |
| [Profile photos](docs/profile-photos.md)                                                           | Multipart upload, supported files, storage, image processing and returned URLs                      |
| [Saved addresses](docs/customer-addresses.md)                                                      | Four address endpoints, defaults, isolation and mobile offline-queue changes                        |
| [Order presentation](docs/order-presentation.md)                                                   | Item images, blank details and repairing earlier order images                                       |
| [AI Concierge API](AI_CONCIERGE_API.md)                                                            | Configuration, profiles, guest/account conversations, SSE/card contracts and recommendation reasons |
| [Dynamic category preferences](docs/dynamic-category-preferences.md)                               | Live categories, localization, assets, validation and saved-profile compatibility                   |
| [Conversation commerce](docs/conversation-commerce.md)                                             | Actions/cart, guest claiming, trusted quotes, Stripe integration and order/payment recovery         |
| [Request logging](docs/request-logging.md)                                                         | JSON formatting, red errors, request IDs and redaction                                              |
| [Environment template](.env.example)                                                               | Copyable development settings                                                                       |
| [Prisma schema](prisma/schema.prisma)                                                              | Database models and relationships                                                                   |
| [Shared commerce contracts](libs/dto/src/commerce/contracts.ts)                                    | Validated cart, checkout address and quote RPC shapes                                               |

When extending the system, add domain operations to the owning service, define shared DTOs/TCP patterns, and expose mobile-safe gateway endpoints with the existing validation, authentication and response conventions.
