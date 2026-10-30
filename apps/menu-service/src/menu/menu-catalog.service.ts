import { ConfigService } from "@nestjs/config";
import { Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@app/database";
import { FoodListQueryDto } from "@app/dto";

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

@Injectable()
export class MenuCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getBootstrap() {
    const [
      heroSlides,
      categories,
      deals,
      hotCombos,
      drinkAddOns,
      modifierGroups,
      modifierLabelTranslations,
      defaultModifierGroupIds,
      foodItems,
    ] = await Promise.all([
      this.getHeroSlides(),
      this.getCategories(),
      this.getDeals(),
      this.getHotCombos(),
      this.getDrinkAddOns(),
      this.getModifierGroups(),
      this.getModifierLabelTranslations(),
      this.getDefaultModifierGroupIds(),
      this.getFoodItemsForBootstrap(),
    ]);

    return {
      categories,
      deals,
      defaultModifierGroupIds,
      drinkAddOns,
      foodItems,
      heroSlides,
      hotCombos,
      modifierGroups,
      modifierLabelTranslations,
    };
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
    const where: Prisma.FoodItemWhereInput = {
      ...catalogFoodWhere,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(typeof query.isPopular === "boolean"
        ? { isPopular: query.isPopular }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const foodItems = await this.prisma.foodItem.findMany({
      cursor: query.cursor ? { slug: query.cursor } : undefined,
      orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
      select: foodSelect,
      skip: query.cursor ? 1 : Math.max((query.page - 1) * take, 0),
      take: take + 1,
      where,
    });
    const hasNextPage = foodItems.length > take;
    const items = foodItems
      .slice(0, take)
      .map((foodItem) => this.mapFoodItem(foodItem));

    return {
      items,
      nextCursor: hasNextPage ? (foodItems[take]?.slug ?? null) : null,
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

  async getDeals() {
    const now = new Date();
    const deals = await this.prisma.deal.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        accentColor: true,
        backgroundColor: true,
        description: true,
        discountPercent: true,
        foodItemId: true,
        foodItem: { select: foodSelect },
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
        AND: [
          { isActive: true },
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
    });

    return deals.map((deal) => ({
      ...deal,
      foodItem: deal.foodItem ? this.mapFoodItem(deal.foodItem) : null,
      imageUrl: this.publicAssetUrl(deal.imageUrl),
      image: this.publicAssetUrl(deal.imageUrl),
      offerDesc: deal.offerDesc ?? deal.description,
      offerDelivery: deal.offerDelivery ?? deal.subtitle,
      offerType: deal.offerType ?? deal.title,
    }));
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

  async getHotCombos() {
    const combos = await this.prisma.hotCombo.findMany({
      ...activeOrder,
      select: {
        categoryLabel: true,
        categoryLabelData: true,
        descriptionData: true,
        foodItemId: true,
        foodItem: { select: foodSelect },
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
      where: { isActive: true },
    });

    return combos.map((combo) => ({
      ...combo,
      foodItem: combo.foodItem ? this.mapFoodItem(combo.foodItem) : null,
      categoryLabel: combo.categoryLabelData ?? combo.categoryLabel,
      description: combo.descriptionData ?? combo.subtitle,
      imageUrl: this.publicAssetUrl(combo.imageUrl),
      image: this.publicAssetUrl(combo.imageUrl),
      name: combo.nameData ?? combo.title,
      price: combo.price === null ? null : combo.price / 100,
    }));
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

  private getDefaultModifierGroupIds() {
    return this.prisma.defaultModifierGroup.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        categoryId: true,
        foodItemId: true,
        modifierGroupId: true,
        scope: true,
        sortOrder: true,
      },
    });
  }

  private async getFoodItemsForBootstrap() {
    const foodItems = await this.prisma.foodItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
      select: foodSelect,
      where: catalogFoodWhere,
    });

    return foodItems.map((foodItem) => this.mapFoodItem(foodItem));
  }

  private mapFoodItem(
    foodItem: Prisma.FoodItemGetPayload<{ select: typeof foodSelect }>,
  ) {
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
      modifierGroupIds: foodItem.modifierGroups.map(
        ({ modifierGroup }) => modifierGroup.id,
      ),
      modifierGroups: foodItem.modifierGroups.map(({ modifierGroup }) => ({
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
      })),
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
