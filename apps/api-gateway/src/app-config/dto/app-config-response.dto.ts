import { ApiProperty } from "@nestjs/swagger";

export class RestaurantAddressDto {
  @ApiProperty({ example: "127 Humber Avenue, Coventry, CV1 2AB" })
  formatted!: string;
  @ApiProperty({ example: "127 Humber Avenue" }) line1!: string;
  @ApiProperty({ type: String, nullable: true, example: null }) line2!:
    string | null;
  @ApiProperty({ example: "Coventry" }) city!: string;
  @ApiProperty({ example: "CV1 2AB" }) postcode!: string;
  @ApiProperty({ example: "GB" }) countryCode!: string;
  @ApiProperty({ example: 52.42441177368164 }) latitude!: number;
  @ApiProperty({ example: -1.5433413982391357 }) longitude!: number;
}
export class DefaultRestaurantDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "Eazy Eat Main Office" })
  restaurantName!: string;
  @ApiProperty({ type: RestaurantAddressDto }) address!: RestaurantAddressDto;
}
export class AppBrandingDto {
  @ApiProperty({ example: "Eazy Eat" }) appName!: string;
  @ApiProperty({ example: "Eazy Eat" }) shortName!: string;
}
export class PublicAppConfigDto {
  @ApiProperty({
    example: 1,
    description: "Public contract version, not the cache validator",
  })
  version!: number;
  @ApiProperty({ type: AppBrandingDto }) branding!: AppBrandingDto;
  @ApiProperty({ type: DefaultRestaurantDto })
  defaultRestaurant!: DefaultRestaurantDto;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
}
export class AppConfigResponseDto {
  @ApiProperty({ example: true }) success!: boolean;
  @ApiProperty({ type: PublicAppConfigDto }) data!: PublicAppConfigDto;
}
