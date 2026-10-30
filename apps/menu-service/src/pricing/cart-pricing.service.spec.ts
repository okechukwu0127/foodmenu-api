import { CartPricingService } from "./cart-pricing.service";
import { MenuCatalogService } from "../menu/menu-catalog.service";
const food = () => ({
  id: "food",
  name: "Meal",
  price: 10,
  currency: "GBP",
  isFoodAvailable: true,
  sizeOptions: [],
  sideOptions: [{ id: "side", price: 2.25 }],
  appetizerOptions: [],
  modifierGroups: [
    {
      id: "size",
      slug: "size",
      selectionType: "SINGLE",
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      quantityMode: "none",
      options: [
        { id: "large", priceOffset: 2, maxQuantity: 1 },
        { id: "small", priceOffset: -1, maxQuantity: 1 },
      ],
    },
  ],
});
const line = () => ({
  lineId: "16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7",
  foodId: "food",
  quantity: 2,
  modifiers: [{ groupId: "size", optionId: "large", quantity: 1 }],
  extras: [{ kind: "side", optionId: "side", quantity: 1 }],
});
describe("Authoritative cart pricing", () => {
  const getFoodById = jest.fn();
  const service = new CartPricingService({
    getFoodById,
  } as unknown as MenuCatalogService);
  beforeEach(() => getFoodById.mockResolvedValue(food()));
  it("prices quantities, permitted modifier offsets and extras from the menu", async () => {
    expect(await service.price({ items: [line()] })).toMatchObject({
      subtotal: 2850,
      currency: "GBP",
      items: [{ unitAmount: 1425, lineAmount: 2850 }],
    });
  });
  it("allows checkout at the base price when a legacy size option was not selected", async () => {
    getFoodById.mockResolvedValueOnce({
      ...food(),
      modifierGroups: [],
      sizeOptions: [
        { id: "small", priceOffset: 0 },
        { id: "regular", priceOffset: 2 },
      ],
    });

    await expect(
      service.price({
        items: [
          {
            ...line(),
            modifiers: [],
            extras: [],
          },
        ],
      }),
    ).resolves.toMatchObject({
      subtotal: 2000,
      items: [{ unitAmount: 1000, lineAmount: 2000 }],
    });
  });
  it.each([
    { modifiers: [] },
    {
      modifiers: [
        { groupId: "other-food-group", optionId: "large", quantity: 1 },
      ],
    },
    { modifiers: [{ groupId: "size", optionId: "other-option", quantity: 1 }] },
    { modifiers: [{ groupId: "size", optionId: "large", quantity: 2 }] },
    {
      modifiers: [
        { groupId: "size", optionId: "large", quantity: 1 },
        { groupId: "size", optionId: "small", quantity: 1 },
      ],
    },
    { extras: [{ kind: "side", optionId: "invented", quantity: 1 }] },
    { sizeId: "invented" },
    { unitAmount: 1 },
  ])("rejects invalid/unpriced selections %#", async (change) => {
    await expect(
      service.price({ items: [{ ...line(), ...change }] }),
    ).rejects.toThrow();
  });
  it("rejects unavailable items and mixed currencies", async () => {
    getFoodById.mockResolvedValueOnce({ ...food(), isFoodAvailable: false });
    await expect(service.price({ items: [line()] })).rejects.toThrow();
    getFoodById
      .mockResolvedValueOnce(food())
      .mockResolvedValueOnce({ ...food(), currency: "USD" });
    await expect(
      service.price({
        items: [
          line(),
          { ...line(), lineId: "177cc09f-5623-4f71-904a-78362823eb72" },
        ],
      }),
    ).rejects.toThrow();
  });
});
