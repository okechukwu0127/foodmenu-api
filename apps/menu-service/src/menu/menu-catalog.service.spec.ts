import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@app/database";
import { MenuCatalogService } from "./menu-catalog.service";

describe("MenuCatalogService", () => {
  const prisma = {
    $queryRaw: jest.fn(),
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
  const config = {
    get: jest.fn().mockReturnValue("https://assets.example.com"),
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
        {
          provide: ConfigService,
          useValue: config,
        },
      ],
    }).compile();

    service = moduleRef.get(MenuCatalogService);
  });

  it("requests only active categories with deterministic tie-breaking and existing asset fields", async () => {
    prisma.category.findMany.mockResolvedValue([
      {
        id: "category",
        slug: "category",
        name: { en: "Category" },
        icon: "icon",
        imageUrl: "/assets/category.webp",
        sortOrder: 1,
      },
    ]);
    const result = await service.getCategories();
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: expect.objectContaining({
          name: true,
          displayName: true,
          imageUrl: true,
          icon: true,
        }),
      }),
    );
    expect(result[0]).toMatchObject({
      id: "category",
      icon: "icon",
      imageUrl: "https://assets.example.com/assets/category.webp",
      image: "https://assets.example.com/assets/category.webp",
    });
  });

  it("uses the configured public asset base for existing absolute hero-slide URLs", async () => {
    prisma.heroSlide.findMany.mockResolvedValue([
      {
        id: "hero",
        imageUrl: "http://localhost:4000/assets/hero1.webp",
        discountPercent: "30%",
        discountLabel: null,
        subtitle: "Offer",
        subtitleData: null,
        title: "Title",
        titleData: null,
      },
    ]);

    await expect(service.getHeroSlides()).resolves.toMatchObject([
      {
        id: "hero",
        imageUrl: "https://assets.example.com/assets/hero1.webp",
        image: "https://assets.example.com/assets/hero1.webp",
      },
    ]);
  });

  it("returns only essential bootstrap data without querying catalog collections", async () => {
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
      heroSlides: [],
    });
    for (const model of [
      prisma.foodItem,
      prisma.deal,
      prisma.hotCombo,
      prisma.drinkAddOn,
      prisma.modifierGroup,
      prisma.modifierLabelTranslation,
      prisma.defaultModifierGroup,
    ]) {
      expect(model.findMany).not.toHaveBeenCalled();
    }
  });

  it("escapes LIKE wildcards in search terms", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.foodItem.findMany.mockResolvedValue([]);
    await service.getFoods({ limit: 20, page: 1, search: "50%_off" });
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain("%50\\%\\_off%");
  });

  it("applies food list filters and returns pagination cursor", async () => {
    prisma.foodItem.findMany.mockResolvedValue([
      createFood("classic-cheeseburger"),
      createFood("double-stack-burger"),
    ]);

    prisma.$queryRaw.mockResolvedValue([
      { id: "classic-cheeseburger" },
      { id: "double-stack-burger" },
    ]);
    const result = await service.getFoods({
      categoryId: "burgers",
      isPopular: true,
      limit: 1,
      page: 1,
      search: "burger",
    });

    // The widened search (tags, translations, option names) runs as SQL and
    // narrows the Prisma query by ID; the pattern is passed as a bound value.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain("%burger%");
    expect(prisma.foodItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        where: expect.objectContaining({
          AND: [
            { id: { in: ["classic-cheeseburger", "double-stack-burger"] } },
          ],
          categoryId: "burgers",
          isActive: true,
          isPopular: true,
          deals: { none: {} },
          hotCombos: { none: {} },
        }),
      }),
    );
    expect(result.nextCursor).toBe("classic-cheeseburger");
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
    const {
      items: [deal],
    } = await service.getDeals();
    const {
      items: [combo],
    } = await service.getHotCombos();

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
          select: expect.objectContaining({
            foodItem: { select: expect.any(Object) },
          }),
        }),
      );
    }
  });

  it("keeps unlinked promotions usable with null food details", async () => {
    prisma.deal.findMany.mockResolvedValue([
      { id: "basket-deal", foodItem: null },
    ]);
    prisma.hotCombo.findMany.mockResolvedValue([
      { id: "legacy-combo", foodItem: null, price: null },
    ]);

    expect((await service.getDeals()).items[0].foodItem).toBeNull();
    expect((await service.getHotCombos()).items[0].foodItem).toBeNull();
  });

  it("rejects food details when the food is missing or inactive", async () => {
    prisma.foodItem.findFirst.mockResolvedValue(null);
    await expect(service.getFoodById("missing")).rejects.toThrow();
  });

  it("omits hidden fields from both database selection and the response", async () => {
    const { modifierGroups, fulfillmentOptions, ...card } = createFood("card");
    prisma.foodItem.findMany.mockResolvedValue([card]);
    const result = await service.getFoods({
      page: 1,
      limit: 20,
      id: "card",
      hideFulfillmentOptions: true,
      hideModifierGroups: true,
      hideSideOptions: true,
      hideSizeOptions: true,
      hideAppetizerOptions: true,
      hideImages: true,
    });
    expect(prisma.foodItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: [{ id: "card" }] }),
        select: expect.objectContaining({
          fulfillmentOptions: false,
          modifierGroups: false,
          sideOptions: false,
          sizeOptions: false,
          appetizerOptions: false,
          images: expect.objectContaining({ select: { url: true } }),
        }),
      }),
    );
    expect(result).toMatchObject({
      nextCursor: null,
      hasNextPage: false,
      limit: 20,
    });
    expect(result.items[0]).toMatchObject({ id: "card", price: 12.99 });
    for (const field of [
      "fulfillmentOptions",
      "modifierGroups",
      "modifierGroupIds",
      "sideOptions",
      "sizeOptions",
      "appetizerOptions",
      "images",
    ])
      expect(result.items[0]).not.toHaveProperty(field);
  });

  it("allows individual projections without hiding other food details", async () => {
    prisma.foodItem.findMany.mockResolvedValue([createFood("card")]);
    const result = await service.getFoods({
      page: 1,
      limit: 20,
      hideSizeOptions: true,
    });
    expect(result.items[0]).not.toHaveProperty("sizeOptions");
    expect(result.items[0].modifierGroups).toHaveLength(1);
    expect(result.items[0].fulfillmentOptions).toHaveLength(2);
  });

  it("uses the last visible food as cursor so consecutive pages do not skip rows", async () => {
    const rows = [createFood("a"), createFood("b"), createFood("c")];
    prisma.foodItem.findMany.mockImplementation(({ cursor, skip, take }) => {
      const start = cursor
        ? rows.findIndex((r) => r.slug === cursor.slug) + skip
        : skip;
      return Promise.resolve(rows.slice(start, start + take));
    });
    const first = await service.getFoods({ page: 1, limit: 2 });
    const second = await service.getFoods({
      page: 1,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect([...first.items, ...second.items].map((f) => f.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(second.nextCursor).toBeNull();
    expect(second.hasNextPage).toBe(false);
  });

  it.each(["getDeals", "getHotCombos"] as const)(
    "%s paginates promotions, filters linked foods and hides linked details",
    async (method) => {
      const model = method === "getDeals" ? prisma.deal : prisma.hotCombo;
      model.findMany.mockResolvedValue(
        ["a", "b", "c"].map((id) => ({
          id,
          foodItem: createFood(id),
          price: 1000,
        })),
      );
      const result = await service[method]({
        page: 2,
        limit: 2,
        foodId: "food",
        categoryId: "burgers",
        isPopular: true,
        hideModifierGroups: true,
      });
      expect(result.items.map((r) => r.id)).toEqual(["a", "b"]);
      expect(result.nextCursor).toBe("b");
      expect(result.hasNextPage).toBe(true);
      expect(result.items[0].foodItem).not.toHaveProperty("modifierGroups");
      expect(result.items[0].foodItem).not.toHaveProperty("modifierGroupIds");
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 3,
          skip: 2,
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          where: expect.objectContaining({
            foodItemId: "food",
            foodItem: { is: { categoryId: "burgers", isPopular: true } },
          }),
          select: expect.objectContaining({
            foodItem: {
              select: expect.objectContaining({ modifierGroups: false }),
            },
          }),
        }),
      );
      model.findMany.mockResolvedValue([]);
      const last = await service[method]({
        page: 1,
        limit: 2,
        cursor: result.nextCursor!,
      });
      expect(model.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: { id: "b" }, skip: 1 }),
      );
      expect(last).toMatchObject({
        items: [],
        nextCursor: null,
        hasNextPage: false,
      });
    },
  );

  it.each(["getDeals", "getHotCombos"] as const)(
    "%s filters by promotion ID and searches title or linked food",
    async (method) => {
      const model = method === "getDeals" ? prisma.deal : prisma.hotCombo;
      model.findMany.mockResolvedValue([]);
      await service[method]({
        page: 1,
        limit: 20,
        id: "promotion-id",
        search: "burger",
      });
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "promotion-id",
            OR: expect.arrayContaining([
              { id: "burger" },
              { title: { contains: "burger", mode: "insensitive" } },
            ]),
          }),
        }),
      );
    },
  );

  const createFood = (slug: string) => ({
    calories: 650,
    categoryId: "burgers",
    currency: "GBP",
    description: "A burger",
    fulfillmentOptions: [
      { mode: "delivery", label: "Delivery" },
      { mode: "pickup", label: "Pickup" },
    ],
    id: slug,
    images: [],
    isPopular: true,
    modifierGroups: [
      {
        modifierGroup: {
          id: "extras",
          options: [{ id: "cheese", name: "Cheese", priceOffset: 150 }],
        },
      },
    ],
    name: slug,
    prepTimeMinutes: 15,
    price: 1299,
    rating: 4.7,
    slug,
    sortOrder: 1,
  });
});
