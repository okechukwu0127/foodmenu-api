# Mobile authentication

Email/password and Google signup/signin are implemented. Checkout, payment and order routes now require a FoodMenu bearer token. Follow the [step-by-step mobile authentication setup](docs/mobile-authentication.md) for Google Cloud configuration, API examples, migrations and app integration.

Customer address APIs are documented in the [saved addresses guide](docs/customer-addresses.md), including the database migration and Expo offline queue integration changes.

Form signup now requires [email activation](docs/email-verification.md). Configure SMTP to send codes; signin on an inactive account returns `403 ACCOUNT_NOT_ACTIVATED`.

Authenticated [profile photo uploads](docs/profile-photos.md) are available at `POST /api/v1/auth/me/photo`; profile queries return the uploaded image URL.

The [Password Manager API](docs/password-management.md) is available at `POST /api/v1/auth/change-password`; it verifies the current password and revokes all sessions after a successful change.

The [AI Food Concierge API](AI_CONCIERGE_API.md) adds Gemini text chat, menu-backed cards, saved profiles, personal restrictions, guest access, and offline reconciliation. Apply its migration, publish configuration with `npm run ai:seed`, and configure a server-only Gemini key before use.

# foodMenu API

Production-ready NestJS monorepo backend for the foodMenu mobile app.

The backend currently implements Stripe payments, order persistence, and the
public Menu Catalog API, while keeping the project ready for future services
such as wallet and notifications. Authentication and profile management run in the dedicated [identity service](docs/identity-service.md).

## Architecture

```text
apps/
  api-gateway/       Public HTTP API consumed by the mobile app
  menu-service/      Public read menu/catalog data service
  order-service/     Order, order item, delivery and order status service
  identity-service/  Authentication, sessions and customer profiles
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
  seed-data/         Full mobile catalog seed snapshot and seed helpers
```

The API Gateway communicates with identity-service, payment-service, order-service, and
menu-service through Nest TCP transport. Stripe SDK usage stays isolated inside
payment-service, identity-service owns authentication/customer profiles, order-service owns orders/order items, and
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

For a fresh hosted environment, use deploy migrations instead of development
migrations:

```bash
npm install
npm run prisma:generate
npm run db:setup
```

`db:setup` runs:

```bash
npm run prisma:deploy
npm run prisma:seed
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
- Order service TCP: `localhost:4030`
  - npm run start:dev:order
- Identity service TCP: `localhost:4050` (private network in Docker)
  - npm run start:dev:identity
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
ORDER_SERVICE_HOST
ORDER_SERVICE_PORT
IDENTITY_SERVICE_HOST
IDENTITY_SERVICE_PORT
IDENTITY_SERVICE_TIMEOUT_MS
DATABASE_URL
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
PGADMIN_DEFAULT_EMAIL
PGADMIN_DEFAULT_PASSWORD
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STUART_WEBHOOK_SECRET
STUART_API_BASE_URL
STUART_CLIENT_ID
STUART_CLIENT_SECRET
STUART_ACCOUNT_ID
STUART_PICKUP_ADDRESS
STUART_PICKUP_LATITUDE
STUART_PICKUP_LONGITUDE
STUART_PICKUP_PHONE
STUART_PICKUP_COMPANY
STUART_PICKUP_EMAIL
STUART_PICKUP_DELAY_MINUTES
STUART_PACKAGE_TYPE
GOOGLE_ROUTES_API_KEY
FOODMENU_APP_URL
```

Never commit real Stripe keys.

## Menu Catalog Endpoints

All public HTTP API Gateway responses use the same response envelope:

```json
{
  "success": true,
  "status": "success",
  "statusCode": 200,
  "message": "Request successful",
  "data": {},
  "path": "/api/v1/example",
  "timestamp": "2026-09-29T00:00:00.000Z"
}
```

Error responses use the same metadata with an `error` object:

```json
{
  "success": false,
  "status": "error",
  "statusCode": 400,
  "message": "Invalid request payload",
  "error": {
    "code": "REQUEST_FAILED",
    "details": []
  },
  "path": "/api/v1/example",
  "timestamp": "2026-09-29T00:00:00.000Z"
}
```

The mobile app should unwrap the actual payload from `response.data.data`.

### Bootstrap

```bash
curl http://localhost:4000/api/v1/menu/bootstrap
```

Response shape:

```json
{
  "success": true,
  "status": "success",
  "statusCode": 200,
  "message": "Request successful",
  "data": {
    "heroSlides": [],
    "categories": [],
    "deals": [],
    "hotCombos": [],
    "drinkAddOns": [],
    "modifierGroups": [],
    "modifierLabelTranslations": [],
    "defaultModifierGroupIds": [],
    "foodItems": []
  },
  "path": "/api/v1/menu/bootstrap",
  "timestamp": "2026-09-29T00:00:00.000Z"
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

Payment endpoints also use the standard API response envelope. The payment
result is returned inside `data`.

### Save Cards With Stripe

The mobile app should collect card details with Stripe UI components only. The
backend stores safe card metadata and Stripe ids, never raw card numbers.

Create a SetupIntent before confirming the card in the mobile app:

```bash
curl -X POST http://localhost:4000/api/v1/payments/stripe/setup-intent \
  -H "Content-Type: application/json" \
  -d '{"customerId":"customer_123"}'
```

After the mobile app confirms the SetupIntent with Stripe SDK, save the returned
payment method id:

```bash
curl -X POST http://localhost:4000/api/v1/payments/stripe/payment-methods \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer_123",
    "paymentMethodId": "pm_123",
    "alias": "Personal Visa",
    "holderName": "John Doe"
  }'
```

List saved cards:

```bash
curl "http://localhost:4000/api/v1/payments/stripe/payment-methods?customerId=customer_123"
```

Update a saved card alias/default state:

```bash
curl -X PATCH http://localhost:4000/api/v1/payments/stripe/payment-methods/card_db_id \
  -H "Content-Type: application/json" \
  -d '{"alias":"Work card","isDefault":true}'
```

Detach and soft-delete a saved card:

```bash
curl -X DELETE http://localhost:4000/api/v1/payments/stripe/payment-methods/card_db_id
```

### Server-priced checkout

Checkout now requires a server-issued quote. Client-supplied amount, order totals,
metadata and ownership fields are rejected. Run `npm run prisma:deploy`, review
`prisma/checkout-policy.json`, and publish it using `npm run checkout:seed`.

For the continuous AI chat flow, use the [conversation commerce API](docs/conversation-commerce.md):
food selection -> cart actions -> guest claim if needed -> prepare checkout ->
payment UI -> verified confirmation, all under the same conversation UUID.

For ordinary checkout, first call `POST /api/v1/payments/stripe/quotes` with an
idempotent requestId, menu food/option IDs and quantities, and pickup/delivery
selection. The backend supplies current prices and charges. Then:

```bash
curl -X POST http://localhost:4000/api/v1/payments/stripe/payment-intent \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"quoteId":"SERVER_QUOTE_UUID"}'
```

The response includes the existing Stripe UI fields: clientSecret,
customerEphemeralKeySecret, Stripe customerId, paymentIntentId, orderId,
orderNumber and current status. Keep payment secrets transient and out of logs.
The quote supplies the stable checkout/order/payment idempotency identity. A
conversation quote must use its conversation payment endpoint instead of this
generic route. Review expiry, replay and reconciliation behavior in the guide.

## Order Endpoints

Order reads go through the API Gateway and are served by order-service.

Use this endpoint for the app order hook. Without `statusGroup`, it returns the
three tab groups in one response:

```bash
curl "http://localhost:4000/api/v1/orders?customerId=customer_123"
```

Response `data` shape:

```json
{
  "active": [],
  "completed": [],
  "cancelled": [],
  "counts": {
    "active": 0,
    "completed": 0,
    "cancelled": 0
  }
}
```

Each order includes `primaryItem`, detailed `items`, `statusGroup`,
`statusLabel`, and UI action flags such as `canCancel`, `canTrack`,
`canReorder`, and `canViewReceipt`. Active orders also include
`latestFulfilment` when delivery tracking has been created.

You can also fetch just one tab:

```bash
curl "http://localhost:4000/api/v1/orders?customerId=customer_123&statusGroup=active"
```

For the detail screen:

```bash
curl http://localhost:4000/api/v1/orders/FM-1720000000000-ABC123
```

You can pass either the internal order id or the public `orderNumber`.

### Fulfilment

Fulfilment records are owned by order-service and linked to both the order and
the fulfilment provider. This keeps Stuart, Uber Direct, or manual delivery data
out of the main order row while still giving the mobile app one clean order
payload.

List enabled fulfilment providers:

```bash
curl http://localhost:4000/api/v1/orders/fulfilment/providers
```

Create a fulfilment record for an order:

```bash
curl -X POST http://localhost:4000/api/v1/orders/FM-1720000000000-ABC123/fulfilment \
  -H "Content-Type: application/json" \
  -d '{
    "providerCode": "STUART",
    "providerJobId": "job_123",
    "providerDeliveryId": "delivery_123",
    "status": "CREATED",
    "clientTrackingUrl": "https://tracking.stuart.com/customer/abc"
  }'
```

Get tracking state for an order:

```bash
curl http://localhost:4000/api/v1/orders/FM-1720000000000-ABC123/tracking
```

Tracking responses include pickup/dropoff locations and a `route.coordinates`
array for mobile map polylines. If `GOOGLE_ROUTES_API_KEY` is configured,
order-service calls Google Routes API, decodes the returned road-following
polyline, and caches the route briefly to avoid calling Google on every polling
request.

```json
{
  "pickup": {
    "address": "127 Humber Avenue, Coventry, CV1 2AU",
    "location": {
      "latitude": 52.42441177368164,
      "longitude": -1.5433413982391357
    }
  },
  "dropoff": {
    "address": "1 Alma St, Coventry CV1 5QA, UK",
    "location": {
      "latitude": 52.4093664,
      "longitude": -1.4991671
    }
  },
  "route": {
    "coordinates": []
  }
}
```

Route coordinates are cached by order/status/origin/destination. The cache is
reused for up to 60 seconds while the courier has moved less than 50 meters. If
Google Routes fails or the API key is missing, the endpoint still returns
tracking data with `route.coordinates: []`.

Update fulfilment status, courier location, or ETA:

```bash
curl -X PATCH http://localhost:4000/api/v1/orders/FM-1720000000000-ABC123/fulfilment/clx_fulfilment_id \
  -H "Content-Type: application/json" \
  -d '{
    "status": "DROPOFF_STARTED",
    "courierName": "Alex Rider",
    "courierPhone": "+447700900123",
    "courierLatitude": 51.5072,
    "courierLongitude": -0.1276,
    "estimatedDropoffAt": "2026-10-06T13:15:00.000Z"
  }'
```

The fulfilment response includes provider details, courier details when
available, current courier coordinates, ETA fields, tracking links, and a
mobile-friendly status label. Stuart integration can later update this record
from Stuart webhook callbacks without changing the order list endpoint.

When Stripe payment succeeds, order-service automatically creates the first
fulfilment record for the paid order using the active `STUART` provider. If
Stuart credentials and pickup settings are configured, order-service also calls
Stuart's `POST /v2/jobs` endpoint, saves the returned job id, delivery id, and
tracking URL, and waits for Stuart webhook events to keep delivery progress in
sync.

Required Stuart dispatch configuration:

```text
STUART_API_BASE_URL=https://api.sandbox.stuart.com
STUART_CLIENT_ID=<your Stuart client id>
STUART_CLIENT_SECRET=<your Stuart client secret>
STUART_ACCOUNT_ID=<your Stuart account id>
STUART_PICKUP_ADDRESS=<restaurant pickup address>
STUART_PICKUP_LATITUDE=<restaurant latitude>
STUART_PICKUP_LONGITUDE=<restaurant longitude>
STUART_PICKUP_COMPANY=FoodMenu
STUART_PICKUP_FIRST_NAME=FoodMenu
STUART_PICKUP_LAST_NAME=Kitchen
STUART_PICKUP_PHONE=<restaurant phone in E.164 format>
STUART_PICKUP_EMAIL=<restaurant email>
STUART_PICKUP_DELAY_MINUTES=15
STUART_PACKAGE_TYPE=medium
STUART_FALLBACK_CUSTOMER_PHONE=<fallback phone in E.164 format>
GOOGLE_ROUTES_API_KEY=<server-side Google Routes API key>
```

The mobile payment intent request must include a complete customer phone number
and delivery address, because those values are sent to Stuart:

```json
{
  "customer": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+447700900123"
  },
  "order": {
    "deliveryAddress": {
      "line1": "23 Ethelbert Road",
      "city": "London",
      "postcode": "SW20 8QD",
      "country": "GB",
      "latitude": 51.5072,
      "longitude": -0.1276,
      "instructions": "3rd floor on the right"
    }
  }
}
```

Production Stuart base URL:

```text
STUART_API_BASE_URL=https://api.stuart.com
```

### Stuart Webhook

```text
POST /api/v1/webhooks/stuart
```

Use this URL in the Stuart dashboard after the API is deployed:

```text
https://your-api-domain.com/api/v1/webhooks/stuart
```

For local testing, expose the API Gateway with ngrok and use the ngrok URL:

```text
https://your-ngrok-url.ngrok-free.app/api/v1/webhooks/stuart
```

If `STUART_WEBHOOK_SECRET` is set, add this custom header in the Stuart webhook
configuration:

```text
X-Stuart-Webhook-Secret: <same value as STUART_WEBHOOK_SECRET>
```

The webhook handler supports Stuart payloads that identify your order through
`details.package.reference`, `data.clientReference`, or `data.client_reference`.
It updates the matching `OrderFulfilment` with Stuart delivery ids, tracking
URLs, driver details, ETA values, courier location, cancellation/failure reason,
and delivery status.

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
npm run prisma:deploy
npm run prisma:seed
npm run db:setup
npm run prisma:studio
```

Use `prisma:migrate` for local development when creating new migrations. Use
`prisma:deploy` or `db:setup` on hosted environments.

Seed data lives in `prisma/seed-data/`. The menu catalog is populated from
`prisma/seed-data/mobile-catalog.seed.json`, which mirrors the previous React
Native local data from `src/data/menuData.ts`, `src/data/drinksData.ts`, and
`src/data/heroSlides.ts`.

Current local catalog seed size:

```text
categories: 7
foodItems: 10
foodImages: 50
deals: 6
heroSlides: 3
hotCombos: 5
drinkAddOns: 4
appetizerOptions: 4
modifierGroups: 15
modifierOptions: 54
defaultModifierGroups: 41
fulfilmentProviders: 3
```

The seed clears and repopulates the menu catalog tables during development. It
does not clear payment transaction tables.

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

Because API Gateway responses are enveloped, the mobile API client should unwrap
the backend response before returning data to screens:

```ts
const response = await apiClient.get("/menu/bootstrap");
return response.data.data;
```

Future admin write endpoints should live behind auth and role checks. This phase
intentionally implements public read APIs and seed data only.

## Future gRPC Upgrade

`libs/proto` is reserved for future proto contracts. When the service boundaries
are stable, TCP patterns can be replaced with gRPC contracts without changing the
mobile app-facing HTTP API.

### Deal and hot combo food navigation

`GET /api/v1/menu/deals` and `GET /api/v1/menu/hot-combos` include
`foodItemId` and a nested `foodItem` using the same shape as the food details
endpoint. Mobile can open the description screen with `foodItem.id`, or fetch
`GET /api/v1/menu/foods/:foodItemId`. Unlinked promotions return `foodItem: null`.

Any food referenced by a Deal or HotCombo is excluded from `GET /menu/foods`
(including category and search results) and bootstrap `foodItems`. This rule
also applies to inactive or expired promotions; direct food lookup stays available
for active foods. Use dedicated FoodItem records for promotional products if
the regular version should remain in the main catalog.

The bootstrap property is now `hotCombos` (previously `hotBurgerCombos`).
The Prisma model and database table are now `HotCombo`. Apply the checked-in
migration with `npm run prisma:deploy`, regenerate the Prisma client, and restart
the services together with the mobile field update.

Catalog seeds accept an optional `foodItemId` on deals and hot combos, pointing
to an entry in `foods`. Combo seeds include their own food entries at the combo
price. Each deal also has a dedicated copy of a category-appropriate food, using that
food’s existing base price. Basket-wide offer thresholds and rewards remain
promotion metadata; linking an item does not apply checkout discounts.
The migration preserves current links. Run `npm run prisma:link-promotions`
after deploying migrations to create and link the dedicated promotion foods
without resetting the catalog. This command is safe to rerun. The seed command rebuilds the menu catalog, so use it only
when that reset is intended.

Hot combo food seeds include delivery/pickup fulfillment options and the existing
burger modifier groups. `npm run prisma:link-promotions` also updates fulfillment
options on existing combo foods and adds missing modifier/default group links.
It preserves their prices, descriptions, and any additional modifier links.
