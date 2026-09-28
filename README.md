# foodMenu API

Production-ready NestJS monorepo backend for the foodMenu mobile app.

The backend currently implements Stripe payments and the public Menu Catalog API,
while keeping the project ready for future services such as orders, users,
wallet, and notifications.

## Architecture

```text
apps/
  api-gateway/       Public HTTP API consumed by the mobile app
  menu-service/      Public read menu/catalog data service
  payment-service/   Stripe + payment persistence microservice

libs/
  common/            Filters, interceptors, response helpers, message patterns
  config/            Environment validation
  database/          Prisma module/service
  dto/               Shared request/response DTOs
  errors/            Application error primitives
  logger/            Logger helpers
  proto/             Reserved for future gRPC contracts

prisma/
  schema.prisma      Payment and menu catalog models
  seed-data/         Modular local seed data
```

The API Gateway communicates with payment-service and menu-service through Nest
TCP transport. Stripe SDK usage stays isolated inside payment-service, while
menu-service owns catalog database reads.

## Local Setup

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

## Docker

```bash
cp .env.example .env
npm run docker:up
```

Services:

- API Gateway: `http://localhost:4000`
  - npm run start:dev:gateway
- Payment service TCP: `localhost:4010`
  - npm run start:dev:payment
- Menu service TCP: `localhost:4020`
  - npm run start:dev:menu
- Swagger: `http://localhost:4000/api/docs`
- OpenAPI JSON: `http://localhost:4000/api/docs-json`
- Postgres: `localhost:5432`
- pgAdmin: `http://localhost:5050`

pgAdmin credentials are controlled by:

```text
PGADMIN_DEFAULT_EMAIL
PGADMIN_DEFAULT_PASSWORD
```

## Environment

Required values:

```text
NODE_ENV
API_GATEWAY_PORT
PAYMENT_SERVICE_HOST
PAYMENT_SERVICE_PORT
MENU_SERVICE_HOST
MENU_SERVICE_PORT
DATABASE_URL
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
PGADMIN_DEFAULT_EMAIL
PGADMIN_DEFAULT_PASSWORD
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
FOODMENU_APP_URL
```

Never commit real Stripe keys.

## Menu Catalog Endpoints

The mobile app expects direct payloads, not `{ success, message, data }` wrappers.

### Bootstrap

```bash
curl http://localhost:4000/api/v1/menu/bootstrap
```

Response shape:

```json
{
  "heroSlides": [],
  "categories": [],
  "deals": [],
  "hotBurgerCombos": [],
  "drinkAddOns": [],
  "modifierGroups": [],
  "modifierLabelTranslations": [],
  "defaultModifierGroupIds": [],
  "foodItems": []
}
```

### Categories

```bash
curl http://localhost:4000/api/v1/menu/categories
```

### Foods

```bash
curl "http://localhost:4000/api/v1/menu/foods?categoryId=burgers&isPopular=true&limit=10"
```

Supported filters:

```text
categoryId
search
isPopular
limit
cursor
page
```

### Food Details

```bash
curl http://localhost:4000/api/v1/menu/foods/classic-cheeseburger
```

### Other Menu Routes

```text
GET /api/v1/menu/deals
GET /api/v1/menu/hero-slides
GET /api/v1/menu/hot-combos
GET /api/v1/menu/drink-add-ons
GET /api/v1/menu/modifier-groups
GET /api/v1/menu/modifier-label-translations
```

## Payment Endpoints

The mobile app expects direct payloads, not `{ success, message, data }` wrappers.

### Create Payment Intent

```bash
curl -X POST http://localhost:4000/api/v1/payments/stripe/payment-intent \
  -H "Content-Type: application/json" \
  -d '{"amount":2500,"currency":"gbp","orderId":"order_123"}'
```

Response:

```json
{
  "clientSecret": "pi_...",
  "paymentIntentId": "pi_...",
  "status": "requires_payment_method"
}
```

### Confirm Payment

```bash
curl -X POST http://localhost:4000/api/v1/payments/stripe/confirm \
  -H "Content-Type: application/json" \
  -d '{"paymentIntentId":"pi_..."}'
```

### Payment Status

```bash
curl http://localhost:4000/api/v1/payments/stripe/status/pi_...
```

### Refund

```bash
curl -X POST http://localhost:4000/api/v1/payments/stripe/refund \
  -H "Content-Type: application/json" \
  -d '{"paymentIntentId":"pi_...","amount":500,"reason":"requested_by_customer"}'
```

### Stripe Webhook

```text
POST /api/v1/webhooks/stripe
```

If `STRIPE_WEBHOOK_SECRET` is set, the service verifies the Stripe signature.

## Stripe Testing

Use Stripe test keys and test card:

```text
4242 4242 4242 4242
Any future expiry
Any CVC
Any postcode
```

## Prisma

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run prisma:studio
```

Seed data lives in `prisma/seed-data/` and uses stable ids/slugs with upserts, so
it can be run repeatedly during development.

## Tests

```bash
npm run test
npm run test:e2e
```

## Adding the Next Microservice

1. Create a new app under `apps/<service-name>`.
2. Add TCP message pattern constants in `libs/common/src/constants`.
3. Add shared DTOs in `libs/dto`.
4. Register a `ClientsModule` provider in api-gateway.
5. Keep SDK/vendor-specific logic inside the owning service.
6. Expose only mobile-safe HTTP routes through api-gateway.

## Migrating Mobile Menu Data

The React Native app can move from local `menuData.ts`, `drinksData.ts`, and
`heroSlides.ts` files to `GET /api/v1/menu/bootstrap` first. After bootstrap is
stable, individual screens can switch to smaller endpoints such as
`/menu/foods`, `/menu/categories`, and `/menu/modifier-groups`.

Future admin write endpoints should live behind auth and role checks. This phase
intentionally implements public read APIs and seed data only.

## Future gRPC Upgrade

`libs/proto` is reserved for future proto contracts. When the service boundaries
are stable, TCP patterns can be replaced with gRPC contracts without changing the
mobile app-facing HTTP API.
