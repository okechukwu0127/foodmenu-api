# Menu loading and pagination

Bootstrap now returns only `categories` and `heroSlides` (banners). It no longer returns foods, deals, hot combos, drinks, modifier groups, modifier label translations or default modifier group IDs. Fetch those separately: `/menu/foods`, `/menu/deals`, `/menu/hot-combos`, `/menu/drink-add-ons`, `/menu/modifier-groups` and `/menu/modifier-label-translations`. A food's default groups are its `modifierGroupIds` on `/menu/foods/:foodId`.

All paths below have the prefix `/api/v1`. The gateway wraps responses in its normal success envelope: read results from `response.data`.

## List endpoints

`GET /menu/foods`, `GET /menu/deals`, and `GET /menu/hot-combos` return:

```json
{
  "items": [],
  "nextCursor": null,
  "hasNextPage": false,
  "limit": 20
}
```

**Breaking change:** deals and hot combos previously returned arrays. Clients must now read `response.data.items`. Food lists keep `items` and `nextCursor`, with `hasNextPage` and `limit` added. There is no total-count query.

| Query                    | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`                   | One-based page; default 1                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `limit`                  | Page size; default 20, range 1–50                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `cursor`                 | Pass the previous response's `nextCursor`; takes precedence over page                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `id`                     | Exact ID of the listed food, deal, or combo                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `foodId`                 | Exact food ID; for promotions, filters by the linked food ID                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `search`                 | Foods: case-insensitive match on exact ID, name, description, tags, every translation of name/description, and option names in the food's own modifier groups (toppings, bases, breads, salad, sauces). Add-on steppers (extra drinks/sides/desserts/dips) and groups whose options are other dishes (half-and-half, meal upgrades) are not searched. Promotions: exact promotion/linked food ID or case-insensitive title/subtitle/linked food name or description (bundle contents) |
| `categoryId`             | Food category; linked food category for promotions                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `isPopular`              | `true` / `false`; linked food popularity for promotions                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `hideFulfillmentOptions` | `true` omits fulfillment options                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `hideModifierGroups`     | `true` omits modifier groups **and modifierGroupIds**                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `hideSideOptions`        | `true` omits side options                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `hideSizeOptions`        | `true` omits size options                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `hideAppetizerOptions`   | `true` omits appetizer options                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `hideImages`             | `true` omits the `images` objects (alt text, sort order); the `image` URL list is kept so cards can still show a photo                                                                                                                                                                                                                                                                                                                                                                |

Hide flags default to false. Use true for list cards; the hidden fields are omitted entirely, not replaced by empty arrays. For deals/combos these flags affect their nested `foodItem`, not promotion-level data. Each flag is independent. They also avoid selecting the hidden fields/relations from the database.

```http
GET /api/v1/menu/foods?page=1&limit=12&isPopular=true&hideFulfillmentOptions=true&hideModifierGroups=true&hideSideOptions=true&hideSizeOptions=true&hideAppetizerOptions=true&hideImages=true
GET /api/v1/menu/foods?id=FOOD_ID
GET /api/v1/menu/foods?search=burger&limit=12
GET /api/v1/menu/deals?limit=10&hideModifierGroups=true
GET /api/v1/menu/deals?id=DEAL_ID
GET /api/v1/menu/hot-combos?foodId=FOOD_ID&hideSizeOptions=true
GET /api/v1/menu/hot-combos?limit=10&cursor=LAST_COMBO_ID
```

Cursor values are opaque to clients: food cursors currently use slugs; promotion cursors use IDs. Keep filters, projection flags and limit unchanged when loading subsequent pages. Stop when `hasNextPage` is false / `nextCursor` is null. Ordering is by sortOrder, then slug (foods) or ID (promotions). Results are not a frozen snapshot if menu records change between requests.

Food lists continue to exclude promotion-owned foods. An exact ID filter does not override catalog visibility or other filters; no match returns an empty list. `/menu/foods/:foodId` still accepts an ID or slug and returns the full active food, including promotion-owned foods. Use it when opening an item or configuring an order.

Active promotion/date rules are unchanged. Unlinked promotions remain visible unless a linked-food filter is used; their `foodItem` remains null. Drinks remain on `/menu/drink-add-ons` without pagination in this change.

## Suggested app startup

Fetch bootstrap and the first small pages of visible sections concurrently. Set all six hide flags for cards. Cache each section independently and load later pages on scroll. Fetch `/menu/foods/:foodId` when opening a food or a promotion's linked food. Coordinate the bootstrap and promotion response changes with the app release.

## Compression

The gateway gzips responses over 1 KB when the client sends `Accept-Encoding: gzip`. React Native `fetch` sends this and decompresses automatically, so no app change is needed. Server-sent event streams (AI concierge) and images are not compressed. Example: a 20-item food page is about 789 KB raw and 73 KB gzipped, or 21 KB raw and 5 KB gzipped with all six hide flags.
