import { assetUrl } from "./asset-url";

export const categoriesSeed = [
  {
    displayName: "Burgers",
    id: "burgers",
    imageUrl: assetUrl("/assets/icons/burger.webp"),
    nameKey: "categories.burgers",
    slug: "burgers",
    sortOrder: 1,
  },
  {
    displayName: "Pizza",
    id: "pizza",
    imageUrl: assetUrl("/assets/icons/pizza.webp"),
    nameKey: "categories.pizza",
    slug: "pizza",
    sortOrder: 2,
  },
];
