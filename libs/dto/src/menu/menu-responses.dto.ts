import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CategoryResponseDto {
  @ApiProperty({ example: "burgers" })
  id!: string;

  @ApiProperty({ example: "burgers" })
  slug!: string;

  @ApiProperty({ example: "categories.burgers" })
  nameKey!: string;

  @ApiPropertyOptional({ example: "Burgers" })
  displayName?: string | null;

  @ApiPropertyOptional({ example: "https://cdn.foodmenu.test/burgers.png" })
  imageUrl?: string | null;

  @ApiProperty({ example: 1 })
  sortOrder!: number;
}

export class FoodImageResponseDto {
  @ApiProperty({ example: "https://cdn.foodmenu.test/burger.png" })
  url!: string;

  @ApiPropertyOptional({ example: "Classic cheeseburger" })
  altText?: string | null;

  @ApiProperty({ example: 0 })
  sortOrder!: number;
}

export class ModifierOptionResponseDto {
  @ApiProperty({ example: "extra-cheese" })
  id!: string;

  @ApiProperty({ example: "Extra cheese" })
  name!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty({ example: 150 })
  priceOffset!: number;

  @ApiPropertyOptional({ example: 80 })
  calories?: number | null;

  @ApiPropertyOptional()
  imageUrl?: string | null;

  @ApiProperty({ example: false })
  isDefault!: boolean;

  @ApiProperty({ example: 1 })
  sortOrder!: number;
}

export class ModifierGroupResponseDto {
  @ApiProperty({ example: "burger-size" })
  id!: string;

  @ApiProperty({ example: "burger-size" })
  slug!: string;

  @ApiProperty({ example: "Choose a size" })
  title!: string;

  @ApiPropertyOptional()
  subtitle?: string | null;

  @ApiProperty({ example: "SINGLE" })
  selectionType!: string;

  @ApiProperty({ example: 1 })
  minSelections!: number;

  @ApiPropertyOptional({ example: 1 })
  maxSelections?: number | null;

  @ApiProperty({ example: true })
  isRequired!: boolean;

  @ApiProperty({ type: [ModifierOptionResponseDto] })
  options!: ModifierOptionResponseDto[];
}

export class FoodDetailsResponseDto {
  @ApiProperty({ example: "classic-cheeseburger" })
  id!: string;

  @ApiProperty({ example: "classic-cheeseburger" })
  slug!: string;

  @ApiProperty({ example: "burgers" })
  categoryId!: string;

  @ApiProperty({ example: "Classic Cheeseburger" })
  name!: string;

  @ApiProperty({ example: "A juicy burger with cheddar." })
  description!: string;

  @ApiProperty({ example: 1299 })
  price!: number;

  @ApiProperty({ example: "GBP" })
  currency!: string;

  @ApiPropertyOptional({ example: 650 })
  calories?: number | null;

  @ApiPropertyOptional({ example: 18 })
  prepTimeMinutes?: number | null;

  @ApiPropertyOptional({ example: 4.7 })
  rating?: number | null;

  @ApiProperty({ example: true })
  isPopular!: boolean;

  @ApiProperty({ type: [FoodImageResponseDto] })
  images!: FoodImageResponseDto[];

  @ApiProperty({
    type: [Object],
    description: "Available delivery and pickup options",
  })
  fulfillmentOptions!: Record<string, unknown>[];

  @ApiProperty({
    type: [String],
    example: ["mod_burger_size", "mod_burger_extras"],
  })
  modifierGroupIds!: string[];

  @ApiProperty({ type: [ModifierGroupResponseDto] })
  modifierGroups!: ModifierGroupResponseDto[];
}

export class FoodListResponseDto {
  @ApiProperty({ type: [FoodDetailsResponseDto] })
  items!: FoodDetailsResponseDto[];

  @ApiPropertyOptional({ example: "next-food-slug" })
  nextCursor?: string | null;
}

export class DealResponseDto {
  @ApiPropertyOptional({ nullable: true })
  foodItemId?: string | null;

  @ApiPropertyOptional({ type: FoodDetailsResponseDto, nullable: true })
  foodItem?: FoodDetailsResponseDto | null;

  @ApiProperty({ example: "weekend-burger-deal" })
  id!: string;

  @ApiProperty({ example: "Weekend Burger Deal" })
  title!: string;

  @ApiPropertyOptional()
  subtitle?: string | null;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiPropertyOptional()
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: 20 })
  discountPercent?: number | null;

  @ApiPropertyOptional({ example: "#FFE8D8" })
  backgroundColor?: string | null;

  @ApiProperty({ example: 1 })
  sortOrder!: number;
}

export class HotComboResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  foodItemId?: string | null;

  @ApiPropertyOptional({ type: FoodDetailsResponseDto, nullable: true })
  foodItem?: FoodDetailsResponseDto | null;

  @ApiPropertyOptional({ nullable: true, example: 19.99 })
  price?: number | null;

  @ApiPropertyOptional()
  imageUrl?: string | null;

  @ApiProperty()
  isFeatured!: boolean;

  @ApiProperty()
  sortOrder!: number;
}

export class HeroSlideResponseDto {
  @ApiProperty({ example: "Fresh burgers" })
  title!: string;

  @ApiPropertyOptional()
  subtitle?: string | null;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  imageUrl!: string;

  @ApiPropertyOptional({ example: 15 })
  discountPercent?: number | null;

  @ApiProperty({ example: 1 })
  sortOrder!: number;
}

export class DrinkAddOnResponseDto {
  @ApiProperty({ example: "cola" })
  id!: string;

  @ApiProperty({ example: "Cola" })
  name!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty({ example: 299 })
  price!: number;

  @ApiPropertyOptional()
  imageUrl?: string | null;

  @ApiProperty({ example: 1 })
  sortOrder!: number;
}

export class MenuBootstrapResponseDto {
  @ApiProperty({ type: [HeroSlideResponseDto] })
  heroSlides!: HeroSlideResponseDto[];

  @ApiProperty({ type: [CategoryResponseDto] })
  categories!: CategoryResponseDto[];

  @ApiProperty({ type: [DealResponseDto] })
  deals!: DealResponseDto[];

  @ApiProperty({ type: [HotComboResponseDto] })
  hotCombos!: HotComboResponseDto[];

  @ApiProperty({ type: [DrinkAddOnResponseDto] })
  drinkAddOns!: DrinkAddOnResponseDto[];

  @ApiProperty({ type: [ModifierGroupResponseDto] })
  modifierGroups!: ModifierGroupResponseDto[];

  @ApiProperty({ isArray: true })
  modifierLabelTranslations!: unknown[];

  @ApiProperty({ isArray: true })
  defaultModifierGroupIds!: unknown[];

  @ApiProperty({ type: [FoodDetailsResponseDto] })
  foodItems!: FoodDetailsResponseDto[];
}
