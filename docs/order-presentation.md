# Order item images and details

`GET /api/v1/orders` and `GET /api/v1/orders/:orderId` return order items under `items[]` and the first item under `primaryItem`. These use `imageUrl` for the saved food image and `details` for a saved `itemSnapshot.displayLine`. Missing/null/blank details become `""`; absent details must not be constructed by interpolating a null category ID.

The mobile My Orders view model maps `primaryItem.imageUrl` to `item.image: { uri: imageUrl }` and uses `primaryItem.details`, with a legacy display-line fallback. Without either details field, the UI displays blank text. A missing image remains optional so the card can use its existing placeholder.

New checkout quotes snapshot the menu-provided image URL, category and description along with the selected item and server price. Payment/order creation copies these presentation fields to `OrderItem`, so the image remains associated with the purchased food even after later menu edits. No schema migration is required; the columns already exist.

## Repair earlier orders with missing images

Older quote snapshots omitted these fields. The maintenance script fills only missing `OrderItem.imageUrl` values, preferring a saved snapshot URL and otherwise using the referenced menu food's first image in deterministic sort order. Names, prices, quantities, ownership and status are preserved. Foods that have been deleted or have no image remain without an image.

From a management checkout with `.env` pointing at the intended database:

```bash
node scripts/backfill-order-images.cjs --order-id YOUR_INTERNAL_ORDER_ID
```

Omit `--order-id` to examine all orders with missing image URLs. The script is safe to rerun and reports only checked/updated counts. Existing nonempty image URLs are preserved. Reload the My Orders screen after deployment/backfill and reload the frontend bundle to pick up its details-mapping correction.
