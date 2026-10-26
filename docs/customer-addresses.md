# Authenticated customer addresses

Address storage runs in the identity service. The gateway exposes the following HTTP routes using its existing global `/api/v1` prefix. All four require the existing FoodMenu session token:

```http
Authorization: Bearer FOODMENU_ACCESS_TOKEN
```

The server gets the customer from that session. Do not include `customerId`, mutation IDs, versions or a mutations wrapper in request bodies. Unknown body fields are rejected with the usual `400` validation response. Missing/invalid/expired sessions return `401`.

## Save or replace

```http
PUT /api/v1/me/addresses/address-unique-1
Content-Type: application/json

{
  "label": "Home",
  "address": "12 Example Street, Lagos, Nigeria",
  "latitude": 6.5244,
  "longitude": 3.3792
}
```

Returns `200` on both create and replacement. `data` is:

```json
{
  "id": "address-unique-1",
  "label": "Home",
  "address": "12 Example Street, Lagos, Nigeria",
  "latitude": 6.5244,
  "longitude": 3.3792
}
```

Use a stable client-generated ID, not necessarily a UUID, of 1–128 characters. URL-encode IDs when constructing the path. The literal path segment `default` is reserved for default selection. Labels and addresses are trimmed and must be nonempty, with maximum lengths of 100 and 1000 characters respectively. Latitude is an optional number from -90 to 90, longitude from -180 to 180; numeric strings and null coordinates are rejected. Omit coordinates for manual/offline addresses.

This is a full replacement: each omitted coordinate clears its previous value and is omitted from responses. Saving never changes the selected default, including when saving the first address. Retry the same PUT with the same ID/body after a lost response; it updates one record rather than appending another. Concurrent writes are accepted in the database's serialized transaction order; the last accepted replacement wins. There is no device-clock or client-version conflict resolution.

## Select or clear the default

```http
PUT /api/v1/me/addresses/default
Content-Type: application/json

{"addressId":"address-unique-1"}
```

Returns `200` with `data: {"defaultAddressId":"address-unique-1"}`. The address must exist for the signed-in customer; missing addresses and addresses owned only by someone else return `404`.

To clear it:

```json
{"addressId":null}
```

Returns `data: {"defaultAddressId":null}`. `addressId` is required, even when null. Repeating either selection or clearing is safe. This static PUT route is registered before PUT `:id`.

## List

```http
GET /api/v1/me/addresses
```

Returns `200` in the existing application response envelope:

```json
{
  "success": true,
  "status": "success",
  "statusCode": 200,
  "message": "Request successful",
  "data": {
    "addresses": [
      {
        "id": "address-unique-1",
        "label": "Home",
        "address": "12 Example Street, Lagos, Nigeria"
      }
    ],
    "defaultAddressId": "address-unique-1"
  },
  "path": "/api/v1/me/addresses",
  "timestamp": "2026-10-24T12:00:00.000Z"
}
```

Coordinates appear only when stored. Addresses are ordered by ascending ID using PostgreSQL's database collation. Empty accounts return `data: {"addresses":[],"defaultAddressId":null}`. The list and default come from the same locked transaction so concurrent writes cannot produce an inconsistent response. The other `200` routes use this same envelope around their respective `data`.

## Delete

```http
DELETE /api/v1/me/addresses/address-unique-1
```

Send no request body. Returns `204` with no response body, including if the address is already absent or only belongs to another customer. Deleting the final address is allowed. Deleting the default selects the smallest remaining address ID under the database collation, or null if no addresses remain. Deleting another address preserves the current default.

## Database and deployment

Migration: `20261024160000_add_customer_addresses`.

- Adds `CustomerAddress` with composite primary key `(customerId, addressId)`, coordinates and server-managed `createdAt`/`updatedAt` timestamps.
- Adds `Customer.defaultAddressId`, initially null.
- A composite foreign key from `(Customer.id, defaultAddressId)` to `(CustomerAddress.customerId, addressId)` enforces both ownership and existence of every non-null default.
- Each operation takes a PostgreSQL row lock on its own customer before reading/changing address state. Address/default changes commit atomically, and separate identity service instances share the same locking rules. Unrelated customers use different locks.
- Coordinates also have database range constraints. No existing addresses or order delivery snapshots are migrated from profile metadata or past orders.

Deploy the migration before restarting services with the updated Prisma client:

```bash
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

Swagger remains at `/api/docs`, with schemas and bearer security under **Customer addresses**. Full address values and bearer tokens are not logged by these handlers.

## Tests

```bash
npm run test:addresses
npm test -- --runInBand --watchman=false
npm run test:e2e -- --runInBand --watchman=false
ESLINT_USE_FLAT_CONFIG=false npm run lint
npm run build
```

`test:addresses` loads a local `DATABASE_URL` from `.env` or an explicit `ADDRESSES_TEST_DATABASE_URL`. It creates a random disposable schema, runs the real migrations, starts the HTTP gateway and TCP identity service, exercises actual PostgreSQL locks/constraints, then drops that schema. It does not modify application tables. The database user needs schema creation/deletion privileges. For a remote test database, set `ADDRESSES_TEST_DATABASE_URL` explicitly. Ordinary e2e runs skip this database suite unless that variable is set.

The tests cover authentication, account isolation, full replacement/retries, coordinate clearing, defaults, final/repeated deletion, validation, route precedence, server timestamps, database constraints, concurrent replacements, and mixed concurrent saves/deletes/default changes with consistent reads.

## Expo integration change required

These endpoints replace the app's older `POST /api/v1/me/addresses/sync` contract. The existing mobile client does **not** work unchanged. Update its network layer separately while retaining its local offline queue:

1. Queue full address replacements with a stable ID and send them with PUT `:id`.
2. Queue removals with DELETE `:id`; treat any `204` as success without parsing JSON.
3. Queue default selection/clearing with PUT `/default` after saving the selected address.
4. Retrieve the latest server state with GET and read its `data` payload.
5. Retry the same queued operation after lost responses. Preserve queue order for dependent operations; avoid sending an older local edit after a newer one has been accepted.

There is no `/addresses/sync` adapter in this implementation. Keep tokens in secure storage and retain pending local changes when reauthentication is required.
