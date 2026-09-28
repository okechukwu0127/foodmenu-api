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
}

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
