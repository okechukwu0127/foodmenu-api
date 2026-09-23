# foodMenu API

Production-ready NestJS monorepo backend for the foodMenu mobile app.

The first milestone implements Stripe payments only, while keeping the project
ready for future services such as orders, menu catalog, users, wallet, and
notifications.

## Architecture

```text
apps/
  api-gateway/       Public HTTP API consumed by the mobile app
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
  schema.prisma      PaymentTransaction and PaymentRefund models
```

The API Gateway communicates with payment-service through Nest TCP transport.
Stripe SDK usage stays isolated inside payment-service.

## Local Setup

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

## Docker

```bash
cp .env.example .env
npm run docker:up
```

Services:

- API Gateway: `http://localhost:4000`
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
npm run prisma:studio
```

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

## Future gRPC Upgrade

`libs/proto` is reserved for future proto contracts. When the service boundaries
are stable, TCP patterns can be replaced with gRPC contracts without changing the
mobile app-facing HTTP API.
