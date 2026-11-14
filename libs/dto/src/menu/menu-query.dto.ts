import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class FoodListQueryDto {
  @ApiPropertyOptional({ description: "Exact food, deal, or hot-combo ID" })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    description: "Exact food ID (linked food for promotions)",
  })
  @IsOptional()
  @IsString()
  foodId?: string;

  @ApiPropertyOptional({ example: "burgers" })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ example: "cheese" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({ default: 20, maximum: 50, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ example: "classic-cheeseburger" })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({
    default: false,
    description:
      "Omit fulfillmentOptions from food objects and database selection",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hideFulfillmentOptions?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: "Omit modifierGroups from food objects and database selection",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hideModifierGroups?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: "Omit sideOptions from food objects and database selection",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hideSideOptions?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: "Omit sizeOptions from food objects and database selection",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hideSizeOptions?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      "Omit appetizerOptions from food objects and database selection",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hideAppetizerOptions?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      "Omit the images objects (alt text, sort order). The image URL list is kept for cards.",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hideImages?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      "Omit the food description (all languages). List cards don't show it; product details load it from /menu/foods/:id.",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hideDescription?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      "Return only the first (primary) image URL in `image` instead of the whole gallery.",
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hideExtraImages?: boolean;
}

/** Same filters and projection controls; id/cursor refer to promotion IDs. */
export class PromotionListQueryDto extends FoodListQueryDto {}

export class FoodIdParamDto {
  @IsString()
  foodId!: string;
}

export class CategoryListQueryDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  activeOnly = true;
}

export class MenuBootstrapQueryDto {}
