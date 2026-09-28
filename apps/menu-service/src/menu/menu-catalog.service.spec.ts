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
    hotBurgerCombo: { findMany: jest.fn() },
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
    prisma.hotBurgerCombo.findMany.mockResolvedValue([]);
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
      hotBurgerCombos: [],
      modifierGroups: [],
      modifierLabelTranslations: [],
    });
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
        }),
      }),
    );
    expect(result.nextCursor).toBe("double-stack-burger");
    expect(result.items).toHaveLength(1);
  });

  const createFood = (slug: string) => ({
    calories: 650,
    categoryId: "burgers",
    currency: "GBP",
    description: "A burger",
    id: slug,
    images: [],
    isPopular: true,
    modifierGroups: [],
    name: slug,
    prepTimeMinutes: 15,
    price: 1299,
    rating: 4.7,
    slug,
    sortOrder: 1,
  });
});
