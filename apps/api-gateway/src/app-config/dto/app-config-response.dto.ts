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
export class LegalDocumentDto {
  @ApiProperty({ example: "terms" }) id!: string;
  @ApiProperty({ example: "Terms and Conditions" }) title!: string;
  @ApiProperty({ example: "1.0" }) version!: string;
  @ApiProperty({ format: "date", example: "2026-11-14" })
  effectiveDate!: string;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
  @ApiProperty({
    description:
      'Ordered body blocks: {type:"heading",level:2|3,text} | {type:"paragraph",text} | {type:"list",items} | {type:"table",columns,rows}. Text supports **bold** and [label](url).',
    example: [
      { type: "heading", level: 2, text: "Part A – General terms" },
      { type: "paragraph", text: "Contact us at [hello@liberq.app](mailto:hello@liberq.app)." },
    ],
  })
  blocks!: Record<string, unknown>[];
}
export class LegalDocumentStampDto {
  @ApiProperty({ example: "1.0" }) version!: string;
  @ApiProperty({
    format: "date-time",
    description: "Changes whenever the text changes; refetch GET /legal/:id when it differs from your cached copy",
  })
  updatedAt!: string;
}
export class LegalDocumentsDto {
  @ApiProperty({ type: LegalDocumentStampDto, nullable: true })
  terms!: LegalDocumentStampDto | null;
  @ApiProperty({ type: LegalDocumentStampDto, nullable: true })
  privacy!: LegalDocumentStampDto | null;
}
export class LegalDocumentResponseDto {
  @ApiProperty({ example: true }) success!: boolean;
  @ApiProperty({ type: LegalDocumentDto }) data!: LegalDocumentDto;
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
  @ApiProperty({ type: LegalDocumentsDto }) legal!: LegalDocumentsDto;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
}
export class AppConfigResponseDto {
  @ApiProperty({ example: true }) success!: boolean;
  @ApiProperty({ type: PublicAppConfigDto }) data!: PublicAppConfigDto;
}
