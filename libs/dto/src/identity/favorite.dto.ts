import { IsString, Length } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class FavoriteFoodIdParamDto {
  @ApiProperty({
    example: "classic-cheeseburger",
    maxLength: 128,
    description: "Food ID returned by the menu API",
  })
  @IsString()
  @Length(1, 128)
  foodId!: string;
}

export class CustomerFavoritesPayload {
  @IsString()
  @Length(1, 128)
  customerId!: string;
}

export class CustomerFavoriteKeyPayload extends CustomerFavoritesPayload {
  @IsString()
  @Length(1, 128)
  foodId!: string;
}

export class CustomerFavoriteResponseDto {
  @ApiProperty({ example: "classic-cheeseburger" })
  foodId!: string;
}

export class CustomerFavoritesResponseDto {
  @ApiProperty({ type: [CustomerFavoriteResponseDto] })
  favorites!: CustomerFavoriteResponseDto[];
}
