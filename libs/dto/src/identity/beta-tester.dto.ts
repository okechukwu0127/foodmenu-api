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

export const BETA_PLATFORMS = ["ios", "android"] as const;
export type BetaPlatformInput = (typeof BETA_PLATFORMS)[number];

/** Public beta-testing sign-up sent by the Liberq marketing website. */
export class BetaSignupDto {
  @ApiProperty({
    example: "jane@icloud.com",
    description:
      "Apple ID email (iOS / TestFlight) or Google account email (Android / Play testing)",
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @Length(3, 254)
  email!: string;

  @ApiProperty({ enum: BETA_PLATFORMS, example: "ios" })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsIn(BETA_PLATFORMS)
  platform!: BetaPlatformInput;

  @ApiProperty({
    example: true,
    description:
      "Must be true: the person agreed to be contacted about beta testing",
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

export class BetaSignupResponseDto {
  @ApiProperty({ example: true })
  registered!: true;

  @ApiProperty({ enum: BETA_PLATFORMS, example: "ios" })
  platform!: BetaPlatformInput;

  @ApiProperty({
    example: "You're on the list. We'll email your TestFlight invite soon.",
  })
  message!: string;
}
