import { IsBase64, IsIn, IsString, Length, MaxLength } from "class-validator";

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

// Internal TCP payload, built from a verified session and a bounded multipart file.
export class UploadProfilePhotoPayload {
  @IsString()
  @Length(1, 128)
  accountId!: string;

  @IsString()
  @IsBase64()
  @MaxLength(Math.ceil(PROFILE_PHOTO_MAX_BYTES / 3) * 4)
  imageBase64!: string;

  @IsIn(PROFILE_PHOTO_CONTENT_TYPES)
  contentType!: string;
}
