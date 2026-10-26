# Identity service

`apps/identity-service` owns signup/signin, Google verification and linking, password hashing, login sessions, and customer profile updates. The API gateway keeps all existing `/api/v1/auth/*` HTTP routes, rate limits and response envelopes, and forwards identity operations over Nest TCP.

```text
Mobile → API Gateway (HTTP :4000)
              ├─ Identity service (private TCP :4050)
              │      AuthAccount, AuthSession, customer profile
              ├─ Order service (private TCP :4030)
              │      Orders, delivery address and contact snapshots
              └─ Payment service (private TCP :4010)
                     Stripe, saved cards and payments
```

The gateway validates each bearer token with identity before allowing protected requests. Identity returns the authenticated account/customer IDs and current profile. Logout immediately invalidates that session, including when subsequent requests arrive at a different gateway instance. Identity failures/timeouts return `503` and protected requests are rejected. Invalid login tokens remain `401`; validation and duplicate-account responses remain `400` and `409`.

## Start locally

`npm run start:dev` now starts all five applications. To start identity alone:

```bash
npm run start:dev:identity
```

Production:

```bash
npm run build
npm run start:identity
```

Optional `.env` settings (these defaults already work locally):

```dotenv
IDENTITY_SERVICE_HOST=127.0.0.1
IDENTITY_SERVICE_PORT=4050
IDENTITY_SERVICE_TIMEOUT_MS=10000
```

Identity needs the existing database and Google authentication settings. Run identity alongside the gateway; starting only the gateway no longer runs the authentication business logic. Restart `npm run start:dev` after this refactor to include the new process. Docker Compose includes identity on its private network and points the gateway at it; port 4050 is not published to the host. Keep all service TCP ports private because their internal messages trust the gateway.

## HTTP compatibility

These existing routes remain available. The signup request body is unchanged, but its response now requires email activation before a token can be obtained:

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/signin`
- `POST /api/v1/auth/google`
- `POST /api/v1/auth/google/link`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`

The service extraction itself preserved existing accounts and tokens. The subsequent [email verification migration](email-verification.md) now requires password-only accounts to activate, and blocks their old sessions until activation. Google-linked accounts remain verified. New endpoints are `POST /api/v1/auth/verify-email` and `POST /api/v1/auth/resend-verification`.

Profile editing is available as an additional protected endpoint:

```http
PATCH /api/v1/auth/me
Authorization: Bearer FOODMENU_ACCESS_TOKEN
Content-Type: application/json

{
  "name": "John Doe",
  "phone": "+447700900123",
  "photoUrl": "https://example.com/avatar.jpg"
}
```

All three fields are optional; provided names must be nonblank, phone numbers must be international format, and photos must use HTTPS. The response envelope's `data` is the current user object, matching `GET /auth/me`. Requests cannot choose another account/customer ID or change email, password or Google identity through this endpoint. Subsequent token validation returns the updated profile without requiring another login.

## Data ownership

The PostgreSQL database remains shared for this stage; this is service separation, not a database split. Identity is the runtime writer for `AuthAccount`, `AuthSession` and customer profile fields. Gateway ownership checks still read order/payment tables; order/payment services may read customers to support existing relations.

Checkout no longer creates demo profiles or updates customer names/email/phone. It requires an existing customer and stores delivery contact details in the order's `metadata.customerContact`, alongside its delivery-address snapshot. Courier dispatch uses that snapshot so later profile edits do not change the contact on a placed order. Orders created before the refactor fall back to their existing customer relation. Payment updates only `Customer.stripeCustomerId`, which remains a payment-owned field; it no longer creates or edits profiles.

Shared DTOs and public identity response types live in `libs/dto/src/identity`. RPC operation names live in `libs/common/src/constants/message-patterns.ts`. Identity validates incoming RPC payloads as well as the gateway validating HTTP requests. Error translation preserves expected HTTP statuses without exposing database exceptions.

## Verification

```bash
npm test -- --runInBand --watchman=false
npm run test:e2e -- --runInBand --watchman=false
ESLINT_USE_FLAT_CONFIG=false npm run lint
npm run build
```

Authentication integration tests start a real TCP identity server and HTTP gateway; database persistence, SMTP delivery and external Google verification are mocked. They cover signup/signin, existing routes, profile edits, Google login, error status preservation, expired tokens and logout revocation. Unit tests cover unavailable/timed-out identity requests and checkout profile ownership/contact snapshots.

## Customer addresses

The identity service also owns [authenticated customer addresses](customer-addresses.md), exposed through `/api/v1/me/addresses`. See that guide for the new migration, replacement/default semantics, PostgreSQL concurrency tests and the required Expo client update.

## Email activation

See the [activation and SMTP guide](email-verification.md) for four-hour codes, resend, account flags, migration behavior and required mobile signup changes. Verification challenges are also owned by identity.

## Profile photo uploads

Identity processes and stores [uploaded profile photos](profile-photos.md), while the gateway accepts multipart requests and serves the resulting public WebP files. Custom images are preserved across Google signin. Docker uses a shared persistent photo volume; no new database migration is required.
