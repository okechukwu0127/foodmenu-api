# Menu images and icons: sources and credits

## Category icons (Flaticon, free licence with attribution)

Flaticon's free licence requires visible credit in the app, e.g. on an About or
Credits screen: "Icons by <author> from www.flaticon.com". Confirm the author
name on each icon page before publishing.

| Category | File | Flaticon page | Author |
|---|---|---|---|
| Kebabs | `public/assets/icons/kebab.webp` | https://www.flaticon.com/free-icon/kebab_7499451 | see page |
| Wraps | `public/assets/icons/wrap.webp` | https://www.flaticon.com/free-icon/wrap_7521117 | Magnific |
| Sides | `public/assets/icons/fries.webp` | https://www.flaticon.com/free-icon/french-fries_1868619 | DinosoftLabs |
| Fried Chicken | `public/assets/icons/fried-chicken.webp` | https://www.flaticon.com/free-icon/fried-chicken_2497905 | Chanut-is-Industries |

## Food photos (linked, not stored)

Food, deal, combo and add-on records store direct image URLs from Pexels
(Pexels License: https://www.pexels.com/license/) and one from Unsplash (garlic
bread; Unsplash License). No attribution is required, but these are
representative stock photos, not photos of Eazy Eat's own dishes.

- Photos chosen by Codex: see `image-sources.json` (`remoteUrl`).
- Photos added for items Codex could not match: `EXTRA_IMAGES` in `build-seed.py`
  (Pexels photo ids; the page is https://www.pexels.com/photo/<id>/).
- Extra gallery photos (2–3 per food) and option thumbnails (ingredients, sauces,
  breads, sizes): `IMG`, `GALLERY_BY_*` and `OPTION_IMG` in `build-seed.py`.
  Product options (sides, drinks, desserts, pizzas in deals) reuse that product's photo.

Look-alike images (no free photo of the exact product exists): Tango Orange
(shows an orange Fanta can), Mirinda Strawberry (strawberry drink in a glass),
Rubicon Mango (mango juice), Seafood pizza (generic pizza), Fish Burger
(seafood burger), Fish Wrap (fish taco), Ben & Jerry's (ice cream cups).
Replace these with your own photos when available.

## Rebuilding the seed

    python3 docs/menu-import-2026-11-10/build-seed.py

writes `prisma/seed-data/menu-2026-11.seed.json`. Then run `npm run prisma:seed`.
