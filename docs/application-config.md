# Public application configuration

`GET /api/v1/app/config` supplies branding and the active default restaurant before sign-in or AI initialization. It is separate from `/ai/config` and requires no bearer token. The API gateway applies `/api/v1` globally; the controller registers only `app/config`.

## Setup and deployment

```bash
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run app:seed
npm run start:dev
```

Migration `20261108100000_add_public_app_configuration` adds the tables. No existing restaurant, business or tenant settings table was present, so this implementation introduces:

- `Restaurant`: `restaurantName`, active state, address fields, coordinates and timestamps.
- `AppConfiguration`: the singleton `default` record with `appName`, nullable `shortName`, `defaultRestaurantId` and timestamps. A foreign key links to Restaurant; restaurant name/address data is not duplicated in settings. A database constraint prevents multiple settings records, and referenced restaurants cannot be deleted.

Review [`prisma/app-config.json`](../prisma/app-config.json), then publish it:

```bash
npm run app:seed
# Or provide a reviewed deployment-specific configuration:
npm run app:seed -- ./prisma/app-config.json
```

The supplied seed uses the requested Eazy Eat branding, Main Office and Coventry address/coordinates. Keep the restaurant UUID stable when updating that location. Choosing a different UUID creates/selects another restaurant and changes the default reference. Publishing activates the selected restaurant. The publisher validates required text, UUID, country code and coordinate ranges; updates settings and restaurant atomically; and preserves timestamps/ETags when values have not changed. Tiny database float-rounding differences do not trigger updates.

`npm run prisma:seed` also initializes missing app settings, but it preserves existing operator settings. That command still resets catalogue data: use `app:seed` alone when changing branding/address. Editing JSON alone has no live effect. This publisher needs the management checkout's development dependencies, just like the AI configuration publisher; it is not an admin HTTP endpoint.

No new environment variables or external provider credentials are required for this feature. It uses the existing `DATABASE_URL`. Other existing gateway environment requirements still apply at startup.

## Response contract

```json
{
  "success": true,
  "data": {
    "version": 1,
    "branding": {
      "appName": "Eazy Eat",
      "shortName": "Eazy Eat"
    },
    "defaultRestaurant": {
      "id": "c34d5c31-8878-4c62-85cd-241385c769c0",
      "restaurantName": "Eazy Eat Main Office",
      "address": {
        "formatted": "127 Humber Avenue, Coventry, CV1 2AB",
        "line1": "127 Humber Avenue",
        "line2": null,
        "city": "Coventry",
        "postcode": "CV1 2AB",
        "countryCode": "GB",
        "latitude": 52.42441177368164,
        "longitude": -1.5433413982391357
      }
    },
    "updatedAt": "2026-11-08T10:00:00.000Z"
  }
}
```

`updatedAt` above is illustrative; the API returns the later settings/restaurant timestamp. Numeric coordinates may differ in the last decimal place after database round-tripping. `version: 1` identifies the wire contract, not the content revision. `shortName` falls back to `appName` when null. `line2` remains explicitly null when absent; a zero coordinate is valid and must not be treated as missing.

The endpoint selects and projects public fields only. It exposes no SMTP credentials, Google/Stripe/Stuart secrets, provider settings or customer data. It uses the configured restaurant relationship, not an arbitrary first active restaurant. An absent settings row or inactive default returns HTTP 503 with standard error code `APP_CONFIG_UNAVAILABLE`; the backend does not invent a location or silently switch restaurants.

Swagger at `/api/docs` documents the nested DTOs and 200/304/503 outcomes.

## Caching

HTTP 200 includes `ETag: "<sha256>"` and `Cache-Control: public, max-age=60, must-revalidate`. The ETag hashes the entire public representation, including restaurant data and `updatedAt`. Branding edits, default selection changes and restaurant name/address/coordinate edits refresh it independently of the AI configuration version. There is no server-side memory cache or process restart requirement. A client/proxy may reuse a fresh response for up to 60 seconds.

```bash
curl -i http://localhost:4000/api/v1/app/config
curl -i http://localhost:4000/api/v1/app/config \
  -H 'If-None-Match: "COPY-THE-EXACT-ETAG-FROM-THE-PREVIOUS-RESPONSE"'
```

Matching validators return HTTP 304 with no body. Strong/weak tags, comma-separated lists and `*` are supported. This is deliberate HTTP cache validation, not an unavailable/network error. If you need the full payload, omit `If-None-Match`.

## Frontend integration

1. Fetch this public endpoint during app bootstrap, independently of authentication and AI initialization. Use the existing public API base URL; do not require a session to start the request.
2. Validate and persist `{ data, etag }` together. Render branding from `data.branding`, the restaurant title from `defaultRestaurant.restaurantName`, the human-readable location from `address.formatted`, and map coordinates from the numeric fields.
3. Send `If-None-Match` only when a valid cached configuration is available. Handle status 304 before attempting to parse JSON and retain the cached data. If a 304 arrives without a usable cache, retry once without the conditional header.
4. A manual refresh can omit the ETag and use fetch `cache: "no-store"`. Do not include an ETag on that forced request. On HTTP 200, validate before replacing the cached payload and validator.
5. On an actual network failure, use a previously validated cached configuration when available. For first launch without a cache, show an unavailable/retry state. Keep configuration/validation failures distinct from device-offline errors. Account logout must not erase this public cache or prevent loading branding.
6. Use a centralized application-config store/provider so screens consume one current source rather than copying constants. Branding text is plain display data, not executable HTML or instructions. Keep a null `line2` out of rendered address strings.

The frontend has not been changed by this feature: its startup/store/screens still need to call this endpoint and replace their hard-coded branding/address references. Existing `/ai/config` remains responsible for AI content and preferences, not global app identity.

This change supplies public display/default-location data. It does not rewrite historical orders, checkout policy, or Stuart's `STUART_PICKUP_*` operational settings. Those existing integrations are still configured separately; keep them aligned with the restaurant you actually dispatch from. The app must continue using the validated checkout/quote contracts instead of treating public configuration as a payment authorization.

## Verification

```bash
npm run test:app-config
```

The runner uses local `DATABASE_URL` by default, creates a disposable schema, applies the real migrations and runs HTTP/PostgreSQL tests. To choose a remote test database explicitly, set `APP_CONFIG_TEST_DATABASE_URL`. The database user must be permitted to create/drop schemas. Generic `test:e2e` skips this suite without that explicit test variable; use the dedicated command.

Coverage includes public access, exact safe response shape, contract/prefix/envelope behavior, conditional GET, restaurant and branding changes, explicit default selection, short-name fallback, missing/inactive settings, database constraints, idempotent seeding, operator-setting preservation, invalid seed rollback and OpenAPI.
