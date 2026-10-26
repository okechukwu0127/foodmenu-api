import { Transform } from "class-transformer";
import {
  IsEmail,
  IsString,
  IsUrl,
  Length,
  Matches,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class EmailVerificationRequestDto {
  @ApiProperty({ example: "john@example.com" })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @Length(3, 254)
  email!: string;
}

export class SigninDto extends EmailVerificationRequestDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @Length(8, 128)
  password!: string;
}

export class SignupDto extends SigninDto {
  @ApiProperty({ example: "John Doe" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({
    example: "+447700900123",
    description: "International format, including country code",
  })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/)
  phone!: string;
}

export class GoogleAuthDto {
  @ApiProperty({
    description: "Google ID token from the mobile Google Sign-In SDK",
  })
  @IsString()
  @Length(1, 10000)
  idToken!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: "John Doe" })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ example: "+447700900123" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/)
  phone?: string;

  @ApiPropertyOptional({ example: "https://example.com/profile.jpg" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @Length(1, 2048)
  photoUrl?: string;
}

export class AuthenticateDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token!: string;
}

export class LinkGoogleDto extends GoogleAuthDto {
  @IsString()
  @Length(1, 100)
  accountId!: string;
}

export class ProfileUpdatePayload extends UpdateProfileDto {
  @IsString()
  @Length(1, 100)
  accountId!: string;
}

export class LogoutDto {
  @IsString()
  @Length(1, 100)
  sessionId!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @Length(8, 128)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @Length(8, 128)
  newPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @Length(8, 128)
  confirmNewPassword!: string;
}

export class ChangePasswordPayload extends ChangePasswordDto {
  @IsString()
  @Length(1, 100)
  accountId!: string;

  @IsString()
  @Length(1, 100)
  sessionId!: string;
}

export class VerifyEmailDto extends EmailVerificationRequestDto {
  @ApiProperty({
    example: "123456",
    description: "The 6-digit code emailed to the user",
  })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
