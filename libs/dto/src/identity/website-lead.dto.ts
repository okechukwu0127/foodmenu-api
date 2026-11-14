import { Transform } from "class-transformer";
import {
  Equals,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export const LEAD_KINDS = ["demo", "partner"] as const;
export type LeadKindInput = (typeof LEAD_KINDS)[number];

/** UK numbers: +44 / 0044 / 0 followed by 9–10 digits, once spaces, dashes and brackets are removed. */
export const UK_PHONE = /^(\+44|0044|0)\d{9,10}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

/**
 * "Book a free demo" (restaurants) and "Become a partner" (marketers) requests
 * sent by the Liberq marketing website.
 */
export class WebsiteLeadDto {
  @ApiPropertyOptional({
    enum: LEAD_KINDS,
    default: "demo",
    description:
      "demo = a restaurant booking a demo; partner = a marketer applying to the partner programme",
  })
  @IsOptional()
  @Transform(lower)
  @IsIn(LEAD_KINDS)
  kind?: LeadKindInput;

  @ApiProperty({ example: "Jane Smith" })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({
    example: "Burger Hub",
    description:
      "Restaurant name for a demo; the area they cover (e.g. Coventry) for a partner",
  })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  business!: string;

  @ApiProperty({ example: "jane@burgerhub.co.uk" })
  @Transform(lower)
  @IsEmail()
  @Length(3, 254)
  email!: string;

  @ApiProperty({ example: "07123 456789", description: "UK phone number" })
  @Transform(({ value }) =>
    typeof value === "string" ? value.replace(/[\s\-().]/g, "") : value,
  )
  @IsString()
  @Matches(UK_PHONE, { message: "phone must be a valid UK phone number" })
  phone!: string;

  @ApiProperty({
    example: true,
    description: "Must be true: the person agreed to Liberq storing their details to contact them",
  })
  @Equals(true, { message: "consent must be accepted" })
  consent!: boolean;

  @ApiPropertyOptional({ example: "liberq-website", maxLength: 64 })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{0,63}$/i, {
    message:
      "source may only contain letters, numbers, dots, dashes and underscores",
  })
  source?: string;

  @ApiPropertyOptional({
    description:
      "Honeypot for bots. Real visitors never see or fill this field; leave it empty.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;
}

export class WebsiteLeadResponseDto {
  @ApiProperty({ example: true })
  received!: true;

  @ApiProperty({ enum: LEAD_KINDS, example: "demo" })
  kind!: LeadKindInput;

  @ApiProperty({
    example: "Thank you — we'll be in touch within one working day.",
  })
  message!: string;
}
