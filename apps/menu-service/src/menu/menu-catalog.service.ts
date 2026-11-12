import { ConfigService } from "@nestjs/config";
import { Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@app/database";
import { FoodListQueryDto, PromotionListQueryDto } from "@app/dto";

const activeOrder = {
  orderBy: { sortOrder: "asc" as const },
};

// Promotional membership controls catalog visibility, regardless of campaign dates.
const catalogFoodWhere = {
  isActive: true,
  deals: { none: {} },
  hotCombos: { none: {} },
} satisfies Prisma.FoodItemWhereInput;

const foodSelect = {
  dietaryInfo: true,
  appetizerOptions: true,
  calories: true,
  categoryId: true,
  currency: true,
  description: true,
  descriptionData: true,
  discountPercent: true,
  fulfillmentOptions: true,
  id: true,
  images: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      altText: true,
      sortOrder: true,
      url: true,
    },
  },
  isFoodAvailable: true,
  isPopular: true,
  isRecommended: true,
  modifierGroups: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      modifierGroup: {
        select: {
          id: true,
          isRequired: true,
          maxSelections: true,
          minSelections: true,
          options: {
            orderBy: { sortOrder: "asc" as const },
            select: {
              calories: true,
              description: true,
              descriptionData: true,
              id: true,
              imageUrl: true,
              isDefault: true,
              isPopular: true,
              maxQuantity: true,
              name: true,
              nameData: true,
              priceOffset: true,
              sortOrder: true,
              tag: true,
            },
            where: { isActive: true },
          },
          descriptionData: true,
          selectionType: true,
          slug: true,
          subtitle: true,
          title: true,
          nameData: true,
          quantityMode: true,
        },
      },
    },
  },
  name: true,
  nameData: true,
  prepTimeMinutes: true,
  price: true,
  rating: true,
  sideOptions: true,
  sizeOptions: true,
  slug: true,
  sortOrder: true,
  tags: true,
} satisfies Prisma.FoodItemSelect;

type FullFood = Prisma.FoodItemGetPayload<{ select: typeof foodSelect }>;
type OptionalFoodFields =
  | "appetizerOptions"
  | "fulfillmentOptions"
  | "modifierGroups"
  | "sideOptions"
  | "sizeOptions";
type SelectedFood = Omit<FullFood, OptionalFoodFields> &
  Partial<Pick<FullFood, OptionalFoodFields>>;

@Injectable()
export class MenuCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Small startup payload. Foods, deals and combos are paginated separately. */
  async getBootstrap() {
    const [heroSlides, categories] = await Promise.all([
      this.getHeroSlides(),
      this.getCategories(),
    ]);
    return { categories, heroSlides };
  }

  async getCategories() {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        displayName: true,
        icon: true,
        id: true,
        imageUrl: true,
        name: true,
        nameKey: true,
        slug: true,
        sortOrder: true,
      },
      where: { isActive: true },
    });

    return categories.map((category) => ({
      ...category,
      imageUrl: this.publicAssetUrl(category.imageUrl),
      image: this.publicAssetUrl(category.imageUrl),
      name: category.name ?? category.displayName,
    }));
  }

  async getFoods(query: FoodListQueryDto) {
    const take = query.limit ?? 20;
    // id, foodId and search can all constrain `id`, so combine them with AND.
    const idFilters: Prisma.FoodItemWhereInput[] = [
      ...(query.id ? [{ id: query.id }] : []),
      ...(query.foodId ? [{ id: query.foodId }] : []),
      ...(query.search
        ? [{ id: { in: await this.searchFoodIds(query.search) } }]
        : []),
    ];
    const where: Prisma.FoodItemWhereInput = {
      ...catalogFoodWhere,
      ...(idFilters.length ? { AND: idFilters } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(typeof query.isPopular === "boolean"
        ? { isPopular: query.isPopular }
        : {}),
    };

    const foodItems = await this.prisma.foodItem.findMany({
      cursor: query.cursor ? { slug: query.cursor } : undefined,
      orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
      select: this.listFoodSelect(query),
      skip: query.cursor ? 1 : Math.max(((query.page ?? 1) - 1) * take, 0),
      take: take + 1,
      where,
    });
    const hasNextPage = foodItems.length > take;
    const items = foodItems
      .slice(0, take)
      .map((foodItem) => this.mapListFoodItem(foodItem, query));

    return {
      items,
      nextCursor: hasNextPage ? (foodItems[take - 1]?.slug ?? null) : null,
      hasNextPage,
      limit: take,
    };
  }

  async getFoodById(foodId: string) {
    const foodItem = await this.prisma.foodItem.findFirst({
      select: foodSelect,
      where: {
        OR: [{ id: foodId }, { slug: foodId }],
        isActive: true,
      },
    });

    if (!foodItem) {
      throw new RpcException({
        code: "FOOD_NOT_FOUND",
        message: "Food item could not be found.",
      });
    }

    return this.mapFoodItem(foodItem);
  }

  async getDeals(query: PromotionListQueryDto = new PromotionListQueryDto()) {
    const take = query.limit ?? 20;
    const now = new Date();
    const deals = await this.prisma.deal.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : ((query.page ?? 1) - 1) * take,
      take: take + 1,
      select: {
        accentColor: true,
        backgroundColor: true,
        description: true,
        discountPercent: true,
        foodItemId: true,
        foodItem: { select: this.listFoodSelect(query) },
        id: true,
        imageUrl: true,
        offerCategory: true,
        offerDelivery: true,
        offerDesc: true,
        offerType: true,
        sortOrder: true,
        subtitle: true,
        title: true,
      },
      where: {
        ...this.promotionFilters(query),
        AND: [
          { isActive: true },
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
    });

    const items = deals.slice(0, take).map((deal) => ({
      ...deal,
      foodItem: deal.foodItem
        ? this.mapListFoodItem(deal.foodItem, query)
        : null,
      imageUrl: this.publicAssetUrl(deal.imageUrl),
      image: this.publicAssetUrl(deal.imageUrl),
      offerDesc: deal.offerDesc ?? deal.description,
      offerDelivery: deal.offerDelivery ?? deal.subtitle,
      offerType: deal.offerType ?? deal.title,
    }));
    return {
      items,
      nextCursor: deals.length > take ? deals[take - 1].id : null,
      hasNextPage: deals.length > take,
      limit: take,
    };
  }

  async getHeroSlides() {
    const slides = await this.prisma.heroSlide.findMany({
      ...activeOrder,
      select: {
        ctaLabel: true,
        ctaTargetId: true,
        ctaTargetType: true,
        description: true,
        discountPercent: true,
        discountLabel: true,
        id: true,
        imageUrl: true,
        sortOrder: true,
        subtitle: true,
        subtitleData: true,
        title: true,
        titleData: true,
      },
      where: { isActive: true },
    });

    return slides.map((slide) => ({
      ...slide,
      discountPercent: slide.discountLabel ?? slide.discountPercent,
      imageUrl: this.publicAssetUrl(slide.imageUrl),
      image: this.publicAssetUrl(slide.imageUrl),
      subtitle: slide.subtitleData ?? slide.subtitle,
      title: slide.titleData ?? slide.title,
    }));
  }

  async getHotCombos(
    query: PromotionListQueryDto = new PromotionListQueryDto(),
  ) {
    const take = query.limit ?? 20;
    const combos = await this.prisma.hotCombo.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : ((query.page ?? 1) - 1) * take,
      take: take + 1,
      select: {
        categoryLabel: true,
        categoryLabelData: true,
        descriptionData: true,
        foodItemId: true,
        foodItem: { select: this.listFoodSelect(query) },
        id: true,
        imageUrl: true,
        isFeatured: true,
        items: true,
        nameData: true,
        price: true,
        sortOrder: true,
        subtitle: true,
        title: true,
      },
      where: { isActive: true, ...this.promotionFilters(query) },
    });

    const items = combos.slice(0, take).map((combo) => ({
      ...combo,
      foodItem: combo.foodItem
        ? this.mapListFoodItem(combo.foodItem, query)
        : null,
      categoryLabel: combo.categoryLabelData ?? combo.categoryLabel,
      description: combo.descriptionData ?? combo.subtitle,
      imageUrl: this.publicAssetUrl(combo.imageUrl),
      image: this.publicAssetUrl(combo.imageUrl),
      name: combo.nameData ?? combo.title,
      price: combo.price === null ? null : combo.price / 100,
    }));
    return {
      items,
      nextCursor: combos.length > take ? combos[take - 1].id : null,
      hasNextPage: combos.length > take,
      limit: take,
    };
  }

  async getDrinkAddOns() {
    const drinks = await this.prisma.drinkAddOn.findMany({
      ...activeOrder,
      select: {
        description: true,
        descriptionData: true,
        id: true,
        imageUrl: true,
        name: true,
        nameData: true,
        price: true,
        sortOrder: true,
        tag: true,
        unitLabel: true,
      },
      where: { isActive: true },
    });

    return drinks.map((drink) => ({
      ...drink,
      description: drink.descriptionData ?? drink.description,
      imageUrl: this.publicAssetUrl(drink.imageUrl),
      image: this.publicAssetUrl(drink.imageUrl),
      name: drink.nameData ?? drink.name,
      price: drink.price / 100,
    }));
  }

  async getModifierGroups() {
    const groups = await this.prisma.modifierGroup.findMany({
      ...activeOrder,
      select: {
        id: true,
        isRequired: true,
        maxSelections: true,
        minSelections: true,
        options: {
          orderBy: { sortOrder: "asc" },
          select: {
            calories: true,
            description: true,
            descriptionData: true,
            id: true,
            imageUrl: true,
            isDefault: true,
            isPopular: true,
            maxQuantity: true,
            name: true,
            nameData: true,
            priceOffset: true,
            sortOrder: true,
            tag: true,
          },
          where: { isActive: true },
        },
        descriptionData: true,
        selectionType: true,
        slug: true,
        subtitle: true,
        title: true,
        nameData: true,
        quantityMode: true,
      },
      where: { isActive: true },
    });

    return groups.map((group) => ({
      ...group,
      description: group.descriptionData ?? group.subtitle,
      name: group.nameData ?? group.title,
      options: group.options.map((option) => ({
        ...option,
        description: option.descriptionData ?? option.description,
        imageUrl: this.publicAssetUrl(option.imageUrl),
        image: this.publicAssetUrl(option.imageUrl),
        name: option.nameData ?? option.name,
        priceOffset: option.priceOffset / 100,
      })),
      required: group.isRequired,
    }));
  }

  getModifierLabelTranslations() {
    return this.prisma.modifierLabelTranslation.findMany({
      orderBy: [{ key: "asc" }, { locale: "asc" }],
      select: {
        key: true,
        locale: true,
        value: true,
      },
    });
  }

  /**
   * IDs of foods matching a free-text search, case-insensitively, on:
   * exact ID, name, description, tags, every translation of name/description,
   * and the names (and translations) of active options in active modifier
   * groups linked to the food (toppings, bases, breads, salad, sauces).
   *
   * Option groups that offer other dishes are skipped, otherwise "fries",
   * "coke" or "pepperoni" would match nearly every main:
   * - add-on steppers (quantityMode "perOption": extra drinks, sides, desserts);
   * - groups where every option names another menu item (half-and-half
   *   pizzas, "Regular fries + Coke can" meal upgrades, deal slots).
   */
  private async searchFoodIds(search: string): Promise<string[]> {
    const term = search.trim();
    if (!term) return [];
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH product_choice_groups AS (
        SELECT g.id
        FROM "ModifierGroup" g
        WHERE NOT EXISTS (
          SELECT 1 FROM "ModifierOption" o
          WHERE o."modifierGroupId" = g.id AND o."isActive"
            AND NOT EXISTS (
              SELECT 1 FROM "FoodItem" p
              WHERE p."isActive" AND length(p.name) >= 3
                AND strpos(lower(o.name), lower(p.name)) > 0
            )
        )
      )
      SELECT f.id
      FROM "FoodItem" f
      WHERE f.id = ${term}
        OR f.name ILIKE ${pattern}
        OR f.description ILIKE ${pattern}
        OR EXISTS (SELECT 1 FROM unnest(f.tags) AS tag WHERE tag ILIKE ${pattern})
        OR EXISTS (
          SELECT 1 FROM jsonb_each_text(
            CASE WHEN jsonb_typeof(f."nameData") = 'object' THEN f."nameData" ELSE '{}'::jsonb END
          ) AS t WHERE t.value ILIKE ${pattern})
        OR EXISTS (
          SELECT 1 FROM jsonb_each_text(
            CASE WHEN jsonb_typeof(f."descriptionData") = 'object' THEN f."descriptionData" ELSE '{}'::jsonb END
          ) AS t WHERE t.value ILIKE ${pattern})
        OR EXISTS (
          SELECT 1
          FROM "FoodItemModifierGroup" l
          JOIN "ModifierGroup" g ON g.id = l."modifierGroupId"
          JOIN "ModifierOption" o ON o."modifierGroupId" = g.id
          WHERE l."foodItemId" = f.id
            AND g."isActive" AND o."isActive"
            AND g."quantityMode" <> 'perOption'
            AND g.id NOT IN (SELECT id FROM product_choice_groups)
            AND (
              o.name ILIKE ${pattern}
              OR EXISTS (
                SELECT 1 FROM jsonb_each_text(
                  CASE WHEN jsonb_typeof(o."nameData") = 'object' THEN o."nameData" ELSE '{}'::jsonb END
                ) AS t WHERE t.value ILIKE ${pattern})
            )
        )
    `;
    return rows.map((row) => row.id);
  }

  private listFoodSelect(query: FoodListQueryDto) {
    return {
      ...foodSelect,
      fulfillmentOptions: !query.hideFulfillmentOptions,
      // Prisma loses the nested payload type for a runtime false | select union.
      // SelectedFood makes this projected relation optional at the mapper boundary.
      modifierGroups: (query.hideModifierGroups
        ? false
        : foodSelect.modifierGroups) as typeof foodSelect.modifierGroups,
      sideOptions: !query.hideSideOptions,
      sizeOptions: !query.hideSizeOptions,
      appetizerOptions: !query.hideAppetizerOptions,
      // Cards still need the URLs for `image`; skip alt text and sort order.
      images: (query.hideImages
        ? { orderBy: foodSelect.images.orderBy, select: { url: true } }
        : foodSelect.images) as typeof foodSelect.images,
    } satisfies Prisma.FoodItemSelect;
  }

  private promotionFilters(query: PromotionListQueryDto) {
    return {
      ...(query.id ? { id: query.id } : {}),
      ...(query.foodId ? { foodItemId: query.foodId } : {}),
      ...(query.categoryId || typeof query.isPopular === "boolean"
        ? {
            foodItem: {
              is: {
                ...(query.categoryId ? { categoryId: query.categoryId } : {}),
                ...(typeof query.isPopular === "boolean"
                  ? { isPopular: query.isPopular }
                  : {}),
              },
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { id: query.search },
              { foodItemId: query.search },
              {
                title: { contains: query.search, mode: "insensitive" as const },
              },
              {
                subtitle: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
              {
                foodItem: {
                  is: {
                    name: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
              },
              // Bundle contents ("Any 12 inch pizza, 2 regular fries, 2 cans").
              {
                foodItem: {
                  is: {
                    description: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private mapListFoodItem(foodItem: SelectedFood, query: FoodListQueryDto) {
    const result: Omit<
      ReturnType<MenuCatalogService["mapFoodItem"]>,
      OptionalFoodFields | "modifierGroupIds" | "images"
    > &
      Partial<
        Pick<
          ReturnType<MenuCatalogService["mapFoodItem"]>,
          OptionalFoodFields | "modifierGroupIds" | "images"
        >
      > = this.mapFoodItem(foodItem);
    if (query.hideFulfillmentOptions) delete result.fulfillmentOptions;
    if (query.hideModifierGroups) {
      delete result.modifierGroups;
      delete result.modifierGroupIds;
    }
    if (query.hideSideOptions) delete result.sideOptions;
    if (query.hideSizeOptions) delete result.sizeOptions;
    if (query.hideAppetizerOptions) delete result.appetizerOptions;
    if (query.hideImages) delete result.images;
    return result;
  }

  private mapFoodItem(foodItem: SelectedFood) {
    const images = foodItem.images.map((image) => ({
      ...image,
      url: this.publicAssetUrl(image.url),
    }));
    return {
      dietaryInfo: foodItem.dietaryInfo,
      appetizerOptions: this.mapAssetUrls(foodItem.appetizerOptions ?? []),
      calories: foodItem.calories,
      categoryId: foodItem.categoryId,
      currency: foodItem.currency,
      description: foodItem.descriptionData ?? foodItem.description,
      discountPercent: foodItem.discountPercent,
      fulfillmentOptions: foodItem.fulfillmentOptions ?? [],
      id: foodItem.id,
      image: images.map((image) => image.url),
      images,
      isFoodAvailable: foodItem.isFoodAvailable,
      isPopular: foodItem.isPopular,
      isRecommended: foodItem.isRecommended,
      modifierGroupIds: (foodItem.modifierGroups ?? []).map(
        ({ modifierGroup }) => modifierGroup.id,
      ),
      modifierGroups: (foodItem.modifierGroups ?? []).map(
        ({ modifierGroup }) => ({
          ...modifierGroup,
          description: modifierGroup.descriptionData ?? modifierGroup.subtitle,
          name: modifierGroup.nameData ?? modifierGroup.title,
          options: modifierGroup.options.map((option) => ({
            ...option,
            description: option.descriptionData ?? option.description,
            imageUrl: this.publicAssetUrl(option.imageUrl),
            image: this.publicAssetUrl(option.imageUrl),
            name: option.nameData ?? option.name,
            priceOffset: option.priceOffset / 100,
          })),
          required: modifierGroup.isRequired,
        }),
      ),
      name: foodItem.nameData ?? foodItem.name,
      prepTimeMinutes: foodItem.prepTimeMinutes,
      price: foodItem.price / 100,
      rating: foodItem.rating,
      sideOptions: this.mapAssetUrls(foodItem.sideOptions ?? []),
      sizeOptions: foodItem.sizeOptions ?? [],
      slug: foodItem.slug,
      sortOrder: foodItem.sortOrder,
      tags: foodItem.tags,
    };
  }

  private publicAssetUrl(value: string | null | undefined) {
    if (!value) return value;
    const base = this.config
      .get<string>("PUBLIC_ASSET_BASE_URL", "http://localhost:4000")
      .replace(/\/+$/, "");
    if (value.startsWith("/assets/")) return `${base}${value}`;
    if (!/^https?:\/\//i.test(value)) return value;
    try {
      const url = new URL(value);
      if (url.pathname.startsWith("/assets/"))
        return `${base}${url.pathname}${url.search}${url.hash}`;
    } catch {
      return value;
    }
    return value;
  }

  private mapAssetUrls<T>(value: T): T {
    if (typeof value === "string") return this.publicAssetUrl(value) as T;
    if (Array.isArray(value))
      return value.map((item) => this.mapAssetUrls(item)) as T;
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.mapAssetUrls(item),
        ]),
      ) as T;
    return value;
  }
}
