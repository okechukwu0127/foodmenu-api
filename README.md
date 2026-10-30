# foodMenu API

NestJS and TypeScript backend for the foodMenu mobile application. It exposes a
versioned HTTP API through an API Gateway and runs menu, identity, order, and
payment workloads as separate services. PostgreSQL is the system of record,
Prisma manages the schema, Stripe handles payments, and Stuart can dispatch and
track deliveries.

This repository contains the backend only. The mobile app is a separate
project; see the API and mobile integration guides below.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Docker Compose](#docker-compose)
- [Environment variables](#environment-variables)
- [Database, migrations, and seed data](#database-migrations-and-seed-data)
- [HTTP API reference](#http-api-reference)
- [Authentication and request conventions](#authentication-and-request-conventions)
- [Stripe checkout flow](#stripe-checkout-flow)
- [AI Food Concierge](#ai-food-concierge)
- [Documentation index](#documentation-index)
- [Commands and tests](#commands-and-tests)
- [Troubleshooting](#troubleshooting)

## Features

- Public menu catalog, search/filtering, categories, food details, deals, and
  modifier data.
- Email/password and Google authentication, verified email activation,
  bearer-token sessions, customer profiles, saved addresses, and profile photos.
- Server-priced checkout quotes, saved payment methods, Stripe PaymentIntents,
  payment status, refunds, and signed Stripe webhooks.
- Persistent orders, fulfilment records, delivery tracking, and Stuart dispatch
  and webhook integration.
- AI Food Concierge chat, preference profiles, account restrictions, guest
  conversations, menu-backed cards, and conversation-based checkout.
- Swagger/OpenAPI, structured request logging, Prisma migrations, seed scripts,
  unit tests, and end-to-end tests.

## Architecture

```text
apps/
  api-gateway/       Public HTTP API, validation, authentication and routing
  identity-service/  Accounts, sessions, customer profiles and addresses
  menu-service/      Menu catalog reads and authoritative cart pricing
  order-service/     Orders, delivery charge policy, fulfilment and tracking
  payment-service/   Stripe operations, checkout quotes and payment records

libs/
  common/            HTTP filters, logging, transport patterns and helpers
  config/            Environment validation
  database/          Shared Prisma client/module
  dto/               Shared request and response contracts
  errors/            Application error types
  logger/            Logging utilities
  proto/             Reserved for possible future gRPC contracts

prisma/
  schema.prisma      Database models
  migrations/        Versioned schema changes
  seed-data/         Menu catalog source data
  checkout-policy.json
                     Initial restaurant checkout and delivery policy
  ai-concierge-config.json
                     Initial AI Concierge configuration

docs/                Feature guides and mobile integration instructions
test/                End-to-end test suites
```

The API Gateway is the only public HTTP service. It communicates with internal
services over NestJS TCP transport. The payment service calls menu and order
services to calculate checkout quotes; payment-provider logic stays inside the
payment service. Do not expose the internal TCP ports to the public internet.

## Requirements

- Node.js and npm (use a currently supported Node.js LTS release).
- PostgreSQL 16 for local development, or Docker Desktop with Compose.
- A Stripe test secret key for payment-service startup and checkout testing.
- Optional provider credentials for Google sign-in, email delivery, Google
  Routes, Stuart delivery, and Gemini AI.

## Quick start

### 1. Install dependencies and configure the environment

```bash
cp .env.example .env
npm install
```

Edit `.env`. At minimum, set a reachable PostgreSQL `DATABASE_URL` and a valid
Stripe test `STRIPE_SECRET_KEY` (for example, `sk_test_...`). The sample values
in `.env.example` are development defaults and placeholders, not production
credentials. See [Environment variables](#environment-variables).

For a local PostgreSQL installation, create the database/user specified by
`POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`, or use the Compose
instructions below to start PostgreSQL in a container.

### 2. Generate Prisma Client, migrate, and seed the database

For a new local development database:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run checkout:seed
npm run ai:seed
```

`prisma:migrate` runs `prisma migrate dev` and may prompt for a migration name
when schema changes are detected. To apply migrations already checked into the
repository in a fresh or hosted environment, use:

```bash
npm run prisma:generate
npm run db:setup
npm run checkout:seed
npm run ai:seed
```

`db:setup` runs `prisma:deploy` followed by the menu/catalog seed. The checkout
and AI configuration seeds are separate so you can review and publish those
settings intentionally. The default checkout policy is in
[`prisma/checkout-policy.json`](prisma/checkout-policy.json); the default AI
configuration is in [`prisma/ai-concierge-config.json`](prisma/ai-concierge-config.json).

### 3. Start all services

```bash
npm run start:dev
```

This starts the gateway and all four TCP microservices in watch mode. The API
base URL is `http://localhost:4000/api/v1`; Swagger UI is
`http://localhost:4000/api/docs`.

Check gateway health:

```bash
curl http://localhost:4000/api/v1/health
```

For a physical mobile device, use your development machine's LAN IP instead of
`localhost` in the app's API base URL. For production, use the deployed HTTPS
gateway URL.

## Docker Compose

Docker Compose starts PostgreSQL and the backend services. It does not
automatically apply Prisma migrations, seed the catalog, or publish checkout/AI
configuration.

```bash
cp .env.example .env
# Set STRIPE_SECRET_KEY in .env to a valid Stripe test key.
npm run docker:up
```

In another terminal, apply and seed the database from the repository:

```bash
npm run prisma:generate
npm run db:setup
npm run checkout:seed
npm run ai:seed
```

Compose sets internal service hostnames (`menu-service`, `order-service`,
`payment-service`, and `identity-service`) for containers. For running the
services directly on the host, use the `127.0.0.1` values from `.env.example`.

| Service              | Local address                         |
| -------------------- | ------------------------------------- |
| API Gateway          | `http://localhost:4000`               |
| Swagger UI           | `http://localhost:4000/api/docs`      |
| OpenAPI JSON         | `http://localhost:4000/api/docs-json` |
| PostgreSQL           | `localhost:5432`                      |
| Payment TCP service  | `localhost:4010`                      |
| Menu TCP service     | `localhost:4020`                      |
| Order TCP service    | `localhost:4030`                      |
| Identity TCP service | `localhost:4050`                      |

The TCP services are internal application transports, not HTTP endpoints.
pgAdmin is not enabled in the current `docker-compose.yml`.

Stop Compose services with:

```bash
npm run docker:down
```

## Environment variables

All settings are read from `.env` in local development and validated by
[`libs/config/src/env.validation.ts`](libs/config/src/env.validation.ts).
Secrets must remain server-side: do not commit `.env`, Stripe secrets, SMTP
passwords, OAuth secrets, or provider tokens. `.env.example` documents the
expected keys and safe local defaults.

### Core application and database

| Variable                | Required / default                   | Purpose                                                                                          |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `NODE_ENV`              | Optional; `development`              | `development`, `test`, or `production`.                                                          |
| `DATABASE_URL`          | **Required**                         | PostgreSQL connection string used by Prisma.                                                     |
| `API_GATEWAY_PORT`      | Optional; `4000`                     | Public HTTP listener port.                                                                       |
| `FOODMENU_APP_URL`      | Optional; `*`                        | Allowed CORS origin. Set the exact production app origin where applicable.                       |
| `PUBLIC_ASSET_BASE_URL` | Optional; `http://localhost:4000`    | Public base URL for uploaded profile-photo assets.                                               |
| `POSTGRES_USER`         | Optional; `foodmenu`                 | Compose PostgreSQL username.                                                                     |
| `POSTGRES_PASSWORD`     | Optional; `foodmenu`                 | Compose PostgreSQL password; replace outside local development.                                  |
| `POSTGRES_DB`           | Optional; `foodmenu_api`             | Compose database name.                                                                           |
| `HTTP_LOG_HEADERS`      | Optional; `false`                    | Opt into sanitized request-header logging.                                                       |
| `HTTP_LOG_BODY`         | Optional; `false`                    | Opt into sanitized request-body logging. Keep disabled in production unless explicitly reviewed. |
| `LOG_COLOR`             | Optional; `auto`                     | Log color behavior: `auto`, `always`, or `never`.                                                |
| `LOG_PRETTY`            | Optional; `.env.example` sets `true` | Pretty-print development logs where supported.                                                   |

### Internal service connections

These are TCP service endpoints. Local host development uses loopback; Docker
Compose supplies the service DNS names.

| Variable                                          | Default              | Purpose                                                                                 |
| ------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `PAYMENT_SERVICE_HOST` / `PAYMENT_SERVICE_PORT`   | `127.0.0.1` / `4010` | Gateway connection to payment service.                                                  |
| `MENU_SERVICE_HOST` / `MENU_SERVICE_PORT`         | `127.0.0.1` / `4020` | Gateway and payment-service connection to menu service.                                 |
| `ORDER_SERVICE_HOST` / `ORDER_SERVICE_PORT`       | `127.0.0.1` / `4030` | Gateway and payment-service connection to order service.                                |
| `IDENTITY_SERVICE_HOST` / `IDENTITY_SERVICE_PORT` | `127.0.0.1` / `4050` | Gateway connection to identity service; identity binds this host when starting locally. |
| `IDENTITY_SERVICE_TIMEOUT_MS`                     | `10000`              | Gateway timeout for identity-service requests.                                          |

### Stripe and checkout

| Variable                | Required / default | Purpose                                                                                    |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `STRIPE_SECRET_KEY`     | **Required**       | Server-side Stripe API key. Use a test key locally and a live key only in production.      |
| `STRIPE_WEBHOOK_SECRET` | Optional           | Signing secret used to verify Stripe webhook requests. Configure in deployed environments. |

Checkout totals are generated server-side from menu prices and the published
restaurant charge policy. Edit
[`prisma/checkout-policy.json`](prisma/checkout-policy.json), then publish with
`npm run checkout:seed`. Delivery fees are configured in minor currency units
(for example, `500` means £5.00 for GBP); an empty postcode-prefix list allows
all postcodes in the configured countries. The current Stuart integration
creates a delivery after payment and does not provide a pre-payment price quote.

### Authentication, email, and profile photos

| Variable                         | Required / default                 | Purpose                                                                                                     |
| -------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_IDS`              | Optional; empty                    | Comma-separated Google OAuth audience/client IDs accepted for Google sign-in.                               |
| `AUTH_SESSION_TTL_SECONDS`       | Optional; `604800`                 | Login session lifetime; default is seven days.                                                              |
| `EMAIL_VERIFICATION_TTL_SECONDS` | Optional; `14400`                  | Verification-code lifetime; supported values are `7200` or `14400`.                                         |
| `EMAIL_VERIFICATION_SECRET`      | Optional; empty                    | Secret for signing/verifying email activation codes; configure a strong secret for real email verification. |
| `SMTP_HOST`                      | Optional; empty                    | SMTP server hostname.                                                                                       |
| `SMTP_PORT`                      | Optional; `587`                    | SMTP server port.                                                                                           |
| `SMTP_SECURE`                    | Optional; `false`                  | Whether SMTP uses TLS immediately.                                                                          |
| `SMTP_USER` / `SMTP_PASSWORD`    | Optional; empty                    | SMTP credentials.                                                                                           |
| `SMTP_FROM`                      | Optional; empty                    | Sender email address.                                                                                       |
| `PROFILE_PHOTO_STORAGE_DIR`      | Optional; `uploads/profile-photos` | Shared local/container storage directory for uploaded profile photos.                                       |
| `PGADMIN_DEFAULT_EMAIL`          | Optional; `admin@foodmenu.local`   | Reserved for optional pgAdmin setups; pgAdmin is not in the default Compose file.                           |
| `PGADMIN_DEFAULT_PASSWORD`       | Optional; `admin`                  | Reserved for optional pgAdmin setups; replace if using pgAdmin.                                             |

Email/password registration requires email activation when verification is
configured. For local testing, use a test SMTP service such as Mailtrap. Google
sign-in works only after `GOOGLE_CLIENT_IDS` is configured; no Google client
secret belongs in the mobile app.

### Stuart and route tracking

| Variable                                               | Required / default               | Purpose                                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STUART_API_BASE_URL`                                  | Optional; sandbox URL            | Stuart API base URL; use `https://api.stuart.com` for production.                                                                                        |
| `STUART_CLIENT_ID` / `STUART_CLIENT_SECRET`            | Optional; empty                  | Stuart API credentials.                                                                                                                                  |
| `STUART_ACCOUNT_ID`                                    | Optional; empty                  | Stuart account identifier.                                                                                                                               |
| `STUART_WEBHOOK_SECRET`                                | Optional; empty                  | Shared secret for validating Stuart webhook requests. Set it before registering/using the Stuart webhook; requests are rejected if it is not configured. |
| `STUART_PICKUP_ADDRESS`                                | Optional; empty                  | Restaurant pickup address supplied to Stuart.                                                                                                            |
| `STUART_PICKUP_LATITUDE` / `STUART_PICKUP_LONGITUDE`   | Optional                         | Restaurant pickup coordinates.                                                                                                                           |
| `STUART_PICKUP_PHONE`                                  | Optional; empty                  | Restaurant contact phone in international format.                                                                                                        |
| `STUART_PICKUP_COMPANY`                                | Optional; `FoodMenu`             | Pickup contact company.                                                                                                                                  |
| `STUART_PICKUP_FIRST_NAME` / `STUART_PICKUP_LAST_NAME` | Optional; `FoodMenu` / `Kitchen` | Pickup contact name.                                                                                                                                     |
| `STUART_PICKUP_EMAIL`                                  | Optional; empty                  | Pickup contact email.                                                                                                                                    |
| `STUART_PICKUP_COMMENT`                                | Optional; empty                  | Instructions attached to the pickup job.                                                                                                                 |
| `STUART_PICKUP_DELAY_MINUTES`                          | Optional; `15`                   | Scheduled delay before the pickup time.                                                                                                                  |
| `STUART_PACKAGE_TYPE`                                  | Optional; `medium`               | Stuart package type.                                                                                                                                     |
| `STUART_FALLBACK_CUSTOMER_PHONE`                       | Optional; empty                  | Fallback customer phone when the order has no phone.                                                                                                     |
| `GOOGLE_ROUTES_API_KEY`                                | Optional; empty                  | Server-side Google Routes API key for road route polylines.                                                                                              |

Without Stuart credentials, payment/order creation can still be tested, but
provider delivery dispatch will not be available. Without
`GOOGLE_ROUTES_API_KEY`, tracking still returns order locations and an empty
route coordinate list.

### AI Food Concierge

| Variable                       | Required / default           | Purpose                                                        |
| ------------------------------ | ---------------------------- | -------------------------------------------------------------- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Optional; empty              | Server-only Gemini API key. Required to generate AI responses. |
| `AI_CONCIERGE_MODEL`           | Optional; `gemini-3.8-flash` | Gemini model identifier.                                       |
| `AI_PROVIDER_TIMEOUT_MS`       | Optional; `45000`            | AI provider request timeout.                                   |
| `AI_GUEST_TTL_SECONDS`         | Optional; `86400`            | Guest conversation lifetime.                                   |
| `AI_RETENTION_DAYS`            | Optional; `30`               | Concierge data retention duration.                             |
| `AI_ACCOUNT_RATE_LIMIT`        | Optional; `20`               | Authenticated turns per minute.                                |
| `AI_GUEST_RATE_LIMIT`          | Optional; `5`                | Guest turns per minute.                                        |
| `AI_GUEST_CREATE_RATE_LIMIT`   | Optional; `3`                | Guest conversation creation limit.                             |

The Concierge also needs its public configuration seeded and the
`capabilities.commerce` setting enabled for conversational checkout.

## Database, migrations, and seed data

Useful Prisma commands:

```bash
npm run prisma:generate  # Generate Prisma Client
npm run prisma:migrate   # Create/apply development migrations
npm run prisma:deploy    # Apply checked-in migrations
npm run prisma:seed      # Seed menu/catalog and related development records
npm run prisma:studio    # Open Prisma Studio
npm run db:setup         # Deploy migrations, then seed
```

Additional configuration and catalog commands:

```bash
npm run checkout:seed    # Publish prisma/checkout-policy.json
npm run ai:seed           # Publish prisma/ai-concierge-config.json
npm run prisma:link-promotions
```

The menu seed is intended for development and rebuilds catalog tables. Do not
run it against production data without reviewing its effects. Migrations do not
automatically publish restaurant checkout policy or AI Concierge config.

## HTTP API reference

All routes below are relative to `/api/v1`. The gateway serves Swagger UI at
`/api/docs` and its OpenAPI document at `/api/docs-json`; the live OpenAPI
schema is the source of truth for request/response field details.

### Health and menu catalog

The health check and menu reads are public:

| Method | Route                               | Description                                    |
| ------ | ----------------------------------- | ---------------------------------------------- |
| `GET`  | `/health`                           | Gateway health status.                         |
| `GET`  | `/menu/bootstrap`                   | Initial catalog payload.                       |
| `GET`  | `/menu/categories`                  | Menu categories.                               |
| `GET`  | `/menu/foods`                       | Search/filter and paginate foods.              |
| `GET`  | `/menu/foods/:foodId`               | Food details and customization options.        |
| `GET`  | `/menu/deals`                       | Deals, including linked food where configured. |
| `GET`  | `/menu/hero-slides`                 | Home-screen hero slides.                       |
| `GET`  | `/menu/hot-combos`                  | Hot combos and linked food.                    |
| `GET`  | `/menu/drink-add-ons`               | Drink add-ons.                                 |
| `GET`  | `/menu/modifier-groups`             | Modifier groups.                               |
| `GET`  | `/menu/modifier-label-translations` | Localized modifier labels.                     |

### Identity, profile, and addresses

Authentication endpoints include:

| Method   | Route                       | Description                                      |
| -------- | --------------------------- | ------------------------------------------------ |
| `POST`   | `/auth/signup`              | Create an email/password account.                |
| `POST`   | `/auth/verify-email`        | Activate an account using its verification code. |
| `POST`   | `/auth/resend-verification` | Resend an activation code.                       |
| `POST`   | `/auth/signin`              | Sign in with email/password.                     |
| `POST`   | `/auth/google`              | Sign in/up using a Google ID token.              |
| `POST`   | `/auth/google/link`         | Link Google sign-in to the current account.      |
| `GET`    | `/auth/me`                  | Read the current profile.                        |
| `PATCH`  | `/auth/me`                  | Update profile fields.                           |
| `POST`   | `/auth/logout`              | Revoke the current session.                      |
| `POST`   | `/auth/change-password`     | Change password and revoke sessions.             |
| `POST`   | `/auth/me/photo`            | Upload a profile photo (`multipart/form-data`).  |
| `GET`    | `/me/addresses`             | List saved addresses.                            |
| `PUT`    | `/me/addresses/:id`         | Create or replace an address.                    |
| `PUT`    | `/me/addresses/default`     | Select or clear the default address.             |
| `DELETE` | `/me/addresses/:id`         | Delete a saved address.                          |

Use the returned FoodMenu bearer token as `Authorization: Bearer <token>` on
protected requests. Account ownership is derived from the token; do not rely on
client-supplied customer IDs for authorization.

### Payments and checkout

All `/payments/stripe/**` endpoints require authentication:

| Method   | Route                                               | Description                                                           |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `POST`   | `/payments/stripe/quotes`                           | Create a server-priced quote from menu line IDs and checkout details. |
| `POST`   | `/payments/stripe/payment-intent`                   | Start payment using `{ "quoteId": "..." }`.                           |
| `POST`   | `/payments/stripe/setup-intent`                     | Start saving a card with Stripe.                                      |
| `GET`    | `/payments/stripe/payment-methods`                  | List saved payment methods.                                           |
| `POST`   | `/payments/stripe/payment-methods`                  | Save Stripe payment method metadata.                                  |
| `PATCH`  | `/payments/stripe/payment-methods/:paymentMethodId` | Update saved payment method metadata.                                 |
| `DELETE` | `/payments/stripe/payment-methods/:paymentMethodId` | Remove a saved payment method.                                        |
| `POST`   | `/payments/stripe/confirm`                          | Confirm/reconcile a payment.                                          |
| `GET`    | `/payments/stripe/status/:paymentIntentId`          | Get payment status.                                                   |
| `POST`   | `/payments/stripe/refund`                           | Request a refund.                                                     |

The client must not submit trusted prices, totals, ownership, or arbitrary
payment metadata. Use the quote returned by the server to begin Stripe's
PaymentSheet/card UI.

### Orders and delivery

Order routes require authentication:

| Method  | Route                                       | Description                                                     |
| ------- | ------------------------------------------- | --------------------------------------------------------------- |
| `GET`   | `/orders`                                   | List the signed-in customer's orders; supports status grouping. |
| `GET`   | `/orders/fulfilment/providers`              | List active fulfilment providers.                               |
| `GET`   | `/orders/:orderId`                          | Read order details by ID or order number.                       |
| `GET`   | `/orders/:orderId/tracking`                 | Get tracking and route data.                                    |
| `POST`  | `/orders/:orderId/fulfilment`               | Create a fulfilment record.                                     |
| `PATCH` | `/orders/:orderId/fulfilment/:fulfilmentId` | Update fulfilment/tracking information.                         |

Provider callbacks:

| Method | Route              | Description                                                                                         |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------- |
| `POST` | `/webhooks/stripe` | Stripe webhook; signature validation uses `STRIPE_WEBHOOK_SECRET`.                                  |
| `POST` | `/webhooks/stuart` | Stuart webhook; requires `STUART_WEBHOOK_SECRET` and the matching `X-Stuart-Webhook-Secret` header. |

### AI Food Concierge

AI endpoints live under `/ai` and use bearer authentication for account-scoped
resources; guest conversations use the guest token returned when the
conversation is created. The main routes are:

| Method                   | Route                                  | Description                               |
| ------------------------ | -------------------------------------- | ----------------------------------------- |
| `GET`                    | `/ai/config`                           | Read public Concierge configuration.      |
| `GET`                    | `/ai/preference-profiles`              | List preference profiles (authenticated). |
| `POST`                   | `/ai/preference-profiles/import`       | Import guest preferences after sign-in.   |
| `PUT`                    | `/ai/preference-profiles/default`      | Select or clear the default profile.      |
| `GET` / `PUT` / `DELETE` | `/ai/preference-profiles/:id`          | Read, update, or delete a profile.        |
| `GET` / `PUT`            | `/ai/account-preferences`              | Read/update account-wide restrictions.    |
| `POST`                   | `/ai/conversations`                    | Create a conversation.                    |
| `GET`                    | `/ai/conversations`                    | List conversations.                       |
| `GET`                    | `/ai/conversations/:id`                | Read conversation details.                |
| `GET`                    | `/ai/conversations/:id/messages`       | Read paginated message history.           |
| `PUT`                    | `/ai/conversations/:id/context`        | Change conversation preference context.   |
| `POST`                   | `/ai/chat`                             | Send a chat turn (streaming response).    |
| `GET`                    | `/ai/conversations/:id/commerce`       | Read commerce state and checkout history. |
| `POST`                   | `/ai/conversations/:id/actions`        | Apply an explicit cart/checkout action.   |
| `POST`                   | `/ai/conversations/:id/payment`        | Start payment for a conversation quote.   |
| `POST`                   | `/ai/conversations/:id/payment/cancel` | Cancel/reconcile conversation payment.    |
| `POST`                   | `/ai/conversations/:id/claim`          | Claim a guest conversation after sign-in. |

See the [AI Concierge API](AI_CONCIERGE_API.md) for complete payloads, headers,
streaming behavior, rate limits, privacy, and error codes, and the
[conversation commerce guide](docs/conversation-commerce.md) for the complete
cart-to-payment lifecycle.

## Authentication and request conventions

- The API base path is `/api/v1`.
- Public routes include menu catalog reads, health, Concierge configuration,
  and provider webhooks. Payment, order, account/profile, and saved-address
  routes are authenticated.
- Authenticated app requests use `Authorization: Bearer <FoodMenu token>`.
- Use `Content-Type: application/json` for JSON bodies; photo upload uses
  multipart form data.
- Most HTTP responses use a JSON envelope with `success`, `status`,
  `statusCode`, `message`, `data` or `error`, `path`, and `timestamp`. Some
  streaming and raw configuration responses have route-specific contracts.
- The mobile client should unwrap `response.data.data` for enveloped successful
  API responses. See the endpoint-specific docs before implementing streaming
  or upload clients.
- Checkout and conversation state use server revisions/idempotency IDs where
  documented. Retry the same operation ID after an uncertain network failure;
  fetch current state before issuing a new mutation.
- Use Swagger's **Authorize** control to test protected endpoints.

## Stripe checkout flow

The standard checkout sequence is:

1. Authenticate and collect the cart's stable menu/option IDs and quantities.
2. `POST /api/v1/payments/stripe/quotes` with a client-generated UUID
   `requestId`, `items`, and `checkout` (`pickup` or `delivery`).
3. Display the returned server total to the customer.
4. `POST /api/v1/payments/stripe/payment-intent` with the returned `quoteId`.
5. Present the returned Stripe UI credentials using the Stripe mobile SDK.
6. Reconcile payment/order status with the backend; do not treat a dismissed
   PaymentSheet as proof of payment or cancellation.

Delivery coverage and fee are controlled by the published checkout policy.
Current Stuart dispatch occurs after successful payment, so the checkout fee is
the configured policy amount, not a live courier quote. The normal checkout API
and AI conversation checkout share the same quote service; conversation-linked
quotes must use the conversation payment endpoint.

Use Stripe test keys and the standard test card `4242 4242 4242 4242`, any
future expiry, any CVC, and any postcode. Never log or persist Stripe client
secrets in app storage or conversation history.

## AI Food Concierge

To enable the feature:

1. Apply database migrations and generate Prisma Client.
2. Set `GOOGLE_GENERATIVE_AI_API_KEY` on the server.
3. Review/publish AI configuration with `npm run ai:seed`.
4. Ensure the published config enables the required capabilities.
5. Follow the [AI Concierge API](AI_CONCIERGE_API.md) for chat transport and
   account/guest integration.
6. For conversational ordering, follow the
   [conversation commerce guide](docs/conversation-commerce.md).

Do not expose Gemini credentials in the mobile application. AI suggestions do
not authorize purchases: the user must explicitly submit cart actions, review
the server quote, and confirm payment through Stripe.

## Documentation index

| Guide                                                                | Covers                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [AI Concierge API](AI_CONCIERGE_API.md)                              | Configuration, profiles, restrictions, guest import, conversations, streaming, menu tools, privacy, errors. |
| [Conversation commerce](docs/conversation-commerce.md)               | Commerce deployment, cart actions, quote/payment lifecycle, retries, history and recovery.                  |
| [Mobile authentication](docs/mobile-authentication.md)               | Signup/sign-in screens, Google OAuth setup, bearer tokens, protected checkout integration.                  |
| [Identity service](docs/identity-service.md)                         | Identity-service architecture, local startup, data ownership, and rollout.                                  |
| [Customer addresses](docs/customer-addresses.md)                     | Saved address APIs, defaults, deployment, and mobile offline queue integration.                             |
| [Email verification](docs/email-verification.md)                     | SMTP setup, account activation, resend flow, and rollout.                                                   |
| [Profile photos](docs/profile-photos.md)                             | Upload/read behavior, storage, serving URLs, and deployment.                                                |
| [Password management](docs/password-management.md)                   | Change-password request, validation, and session revocation.                                                |
| [Dynamic category preferences](docs/dynamic-category-preferences.md) | Menu-derived preference options and client contract.                                                        |
| [HTTP request logging](docs/request-logging.md)                      | Structured logs, redaction, request IDs, and opt-in detail logging.                                         |

## Commands and tests

```bash
npm run start:dev                 # Start all services with watch mode
npm run start:dev:gateway         # Start one service
npm run start:dev:identity
npm run start:dev:menu
npm run start:dev:order
npm run start:dev:payment
npm run build                     # Build all services
npm test                          # Unit tests
npm run test:e2e                  # End-to-end tests
npm run lint                      # ESLint
npm run prisma:studio             # Prisma Studio
npm run docker:up                 # Build/start Compose stack
npm run docker:down               # Stop Compose stack
```

Other feature-specific scripts include `npm run test:addresses`,
`npm run test:email-verification`, `npm run test:profile-photos`, and
`npm run test:ai`.

## Troubleshooting

- **A service cannot connect to another service:** Check the TCP host/port
  variables. Use `127.0.0.1` when running services directly on the host; use
  Compose service names between containers.
- **Database connection or missing-table errors:** Check `DATABASE_URL`, start
  PostgreSQL, then run `npm run prisma:generate` and `npm run db:setup`.
- **Stripe service fails during startup:** Configure a syntactically valid
  server-side `STRIPE_SECRET_KEY`; never use a publishable key here.
- **Google login is unavailable:** Set the correct web OAuth client ID(s) in
  `GOOGLE_CLIENT_IDS` and ensure the mobile app sends a valid ID token.
- **Email activation is not delivered:** Configure SMTP variables and
  `EMAIL_VERIFICATION_SECRET`; use a test SMTP inbox locally.
- **Checkout quote is rejected:** Check that the selected menu IDs/options
  remain valid and that the checkout policy is seeded and allows the chosen
  fulfilment country/postcode.
- **AI chat is unavailable:** Check Gemini credentials, published Concierge
  configuration, rate limits, and payment/menu service connectivity for
  commerce actions.
- **Delivery tracking has no route polyline:** Set a valid
  `GOOGLE_ROUTES_API_KEY`; basic order tracking can still be returned without it.

## Development guidelines

- Keep provider SDK and secret-bearing operations inside the owning service.
- Expose app-facing HTTP endpoints through the API Gateway.
- Add shared HTTP/RPC contracts to `libs/dto` and message patterns to
  `libs/common`.
- Create and check in Prisma migrations for schema changes; regenerate Prisma
  Client after schema updates.
- Keep secrets out of source, logs, API responses, and mobile builds.
- Run focused tests and `npm run build` after behavior or contract changes.
