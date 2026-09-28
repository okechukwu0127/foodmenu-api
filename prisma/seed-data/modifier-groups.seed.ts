import { ModifierSelectionType } from "@prisma/client";

export const modifierGroupsSeed = [
  {
    id: "burger-size",
    isRequired: true,
    maxSelections: 1,
    minSelections: 1,
    options: [
      {
        id: "burger-size-regular",
        isDefault: true,
        name: "Regular",
        priceOffset: 0,
        sortOrder: 1,
      },
      {
        id: "burger-size-large",
        isDefault: false,
        name: "Large",
        priceOffset: 250,
        sortOrder: 2,
      },
    ],
    selectionType: ModifierSelectionType.SINGLE,
    slug: "burger-size",
    sortOrder: 1,
    title: "Choose size",
  },
  {
    id: "burger-extras",
    isRequired: false,
    maxSelections: 4,
    minSelections: 0,
    options: [
      {
        id: "extra-cheese",
        isDefault: false,
        name: "Extra cheese",
        priceOffset: 150,
        sortOrder: 1,
      },
      {
        id: "extra-bacon",
        isDefault: false,
        name: "Extra bacon",
        priceOffset: 220,
        sortOrder: 2,
      },
    ],
    selectionType: ModifierSelectionType.MULTIPLE,
    slug: "burger-extras",
    sortOrder: 2,
    title: "Add extras",
  },
];
