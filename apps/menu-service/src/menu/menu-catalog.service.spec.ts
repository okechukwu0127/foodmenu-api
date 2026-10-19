import { Test } from "@nestjs/testing";
import { PrismaService } from "@app/database";
import { MenuCatalogService } from "./menu-catalog.service";

describe("MenuCatalogService", () => {
  const prisma = {
    category: { findMany: jest.fn() },
    deal: { findMany: jest.fn() },
    defaultModifierGroup: { findMany: jest.fn() },
    drinkAddOn: { findMany: jest.fn() },
    foodItem: { findFirst: jest.fn(), findMany: jest.fn() },
    heroSlide: { findMany: jest.fn() },
    hotCombo: { findMany: jest.fn() },
    modifierGroup: { findMany: jest.fn() },
    modifierLabelTranslation: { findMany: jest.fn() },
  };

  let service: MenuCatalogService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MenuCatalogService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = moduleRef.get(MenuCatalogService);
  });

  it("returns a complete bootstrap payload", async () => {
    prisma.heroSlide.findMany.mockResolvedValue([]);
    prisma.category.findMany.mockResolvedValue([]);
    prisma.deal.findMany.mockResolvedValue([]);
    prisma.hotCombo.findMany.mockResolvedValue([]);
    prisma.drinkAddOn.findMany.mockResolvedValue([]);
    prisma.modifierGroup.findMany.mockResolvedValue([]);
    prisma.modifierLabelTranslation.findMany.mockResolvedValue([]);
    prisma.defaultModifierGroup.findMany.mockResolvedValue([]);
    prisma.foodItem.findMany.mockResolvedValue([]);

    await expect(service.getBootstrap()).resolves.toEqual({
      categories: [],
      deals: [],
      defaultModifierGroupIds: [],
      drinkAddOns: [],
      foodItems: [],
      heroSlides: [],
      hotCombos: [],
      modifierGroups: [],
      modifierLabelTranslations: [],
    });
    expect(prisma.foodItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, deals: { none: {} }, hotCombos: { none: {} } },
      }),
    );
  });

  it("applies food list filters and returns pagination cursor", async () => {
    prisma.foodItem.findMany.mockResolvedValue([
      createFood("classic-cheeseburger"),
      createFood("double-stack-burger"),
    ]);

    const result = await service.getFoods({
      categoryId: "burgers",
      isPopular: true,
      limit: 1,
      page: 1,
      search: "burger",
    });

    expect(prisma.foodItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({
          categoryId: "burgers",
          isActive: true,
          isPopular: true,
          deals: { none: {} },
          hotCombos: { none: {} },
        }),
      }),
    );
    expect(result.nextCursor).toBe("double-stack-burger");
    expect(result.items).toHaveLength(1);
  });

  it("returns the same food details for linked deals, combos, and direct lookup", async () => {
    const food = createFood("combo-food");
    prisma.foodItem.findFirst.mockResolvedValue(food);
    prisma.deal.findMany.mockResolvedValue([
      { id: "deal", foodItemId: food.id, foodItem: food },
    ]);
    prisma.hotCombo.findMany.mockResolvedValue([
      { id: "combo", foodItemId: food.id, foodItem: food, price: 1999 },
    ]);

    const details = await service.getFoodById(food.id);
    const [deal] = await service.getDeals();
    const [combo] = await service.getHotCombos();

    expect(deal.foodItem).toEqual(details);
    expect(combo.foodItem).toEqual(details);
    expect(combo.foodItem?.fulfillmentOptions).toEqual(food.fulfillmentOptions);
    expect(combo.foodItem?.modifierGroupIds).toEqual(["extras"]);
    expect(combo.foodItem?.modifierGroups).toHaveLength(1);
    expect(details.price).toBe(12.99);
    expect(details.modifierGroups[0].options[0].priceOffset).toBe(1.5);
    expect(combo.price).toBe(19.99);
    expect(prisma.foodItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ id: food.id }, { slug: food.id }], isActive: true },
      }),
    );
    for (const model of [prisma.deal, prisma.hotCombo]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ foodItem: { select: expect.any(Object) } }),
        }),
      );
    }
  });

  it("keeps unlinked promotions usable with null food details", async () => {
    prisma.deal.findMany.mockResolvedValue([{ id: "basket-deal", foodItem: null }]);
    prisma.hotCombo.findMany.mockResolvedValue([{ id: "legacy-combo", foodItem: null, price: null }]);

    expect((await service.getDeals())[0].foodItem).toBeNull();
    expect((await service.getHotCombos())[0].foodItem).toBeNull();
  });

  it("rejects food details when the food is missing or inactive", async () => {
    prisma.foodItem.findFirst.mockResolvedValue(null);
    await expect(service.getFoodById("missing")).rejects.toThrow();
  });

  const createFood = (slug: string) => ({
    calories: 650,
    categoryId: "burgers",
    currency: "GBP",
    description: "A burger",
    fulfillmentOptions: [{ mode: "delivery", label: "Delivery" }, { mode: "pickup", label: "Pickup" }],
    id: slug,
    images: [],
    isPopular: true,
    modifierGroups: [{ modifierGroup: {
      id: "extras",
      options: [{ id: "cheese", name: "Cheese", priceOffset: 150 }],
    } }],
    name: slug,
    prepTimeMinutes: 15,
    price: 1299,
    rating: 4.7,
    slug,
    sortOrder: 1,
  });
});
