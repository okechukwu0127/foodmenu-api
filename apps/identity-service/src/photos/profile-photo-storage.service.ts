import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import { resolve } from "path";
import * as sharpModule from "sharp";
// Sharp exposes a default export in ESM and a callable export in CommonJS.
const sharp =
  sharpModule.default ?? (sharpModule as unknown as typeof sharpModule.default);
import { PROFILE_PHOTO_CONTENT_TYPES, PROFILE_PHOTO_MAX_BYTES } from "@app/dto";

const PHOTO_KEY =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;

@Injectable()
export class ProfilePhotoStorageService {
  private readonly logger = new Logger(ProfilePhotoStorageService.name);
  constructor(private readonly config: ConfigService) {}

  isManagedKey(value: unknown): value is string {
    return typeof value === "string" && PHOTO_KEY.test(value);
  }

  publicUrl(key: string) {
    if (!this.isManagedKey(key))
      throw new BadRequestException("Invalid profile photo key");
    const base = this.config
      .get<string>("PUBLIC_ASSET_BASE_URL", "http://localhost:4000")
      .replace(/\/$/, "");
    return `${base}/uploads/profile-photos/${key}`;
  }

  async store(imageBase64: string, contentType: string) {
    if (imageBase64.length > Math.ceil(PROFILE_PHOTO_MAX_BYTES / 3) * 4)
      throw new PayloadTooLargeException(
        "Profile photo must be 5 MB or smaller",
      );
    const input = Buffer.from(imageBase64, "base64");
    if (input.length > PROFILE_PHOTO_MAX_BYTES)
      throw new PayloadTooLargeException(
        "Profile photo must be 5 MB or smaller",
      );
    if (
      !input.length ||
      input.toString("base64") !== imageBase64 ||
      !PROFILE_PHOTO_CONTENT_TYPES.some((type) => type === contentType)
    )
      throw new BadRequestException("Upload a JPEG, PNG or WebP image");
    const signatureType = input
      .subarray(0, 3)
      .equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? "image/jpeg"
      : input
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : input.toString("ascii", 0, 4) === "RIFF" &&
            input.toString("ascii", 8, 12) === "WEBP"
          ? "image/webp"
          : null;
    if (signatureType !== contentType)
      throw new BadRequestException(
        "The file contents must match a JPEG, PNG or WebP image",
      );
    let output: Buffer;
    try {
      const image = sharp(input, {
        limitInputPixels: 16000000,
        failOn: "warning",
      });
      const metadata = await image.metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width > 8192 ||
        metadata.height > 8192 ||
        (metadata.pages ?? 1) > 1 ||
        !["jpeg", "png", "webp"].includes(metadata.format ?? "")
      )
        throw new Error("Unsupported image dimensions or animation");
      // Re-encode decoded pixels, apply EXIF orientation, and strip input metadata.
      output = await image
        .rotate()
        .resize(512, 512, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        "Invalid image. Use a non-animated JPEG, PNG or WebP with at most 16 million pixels and 8192 pixels per side.",
      );
    }
    const key = `${randomUUID()}.webp`;
    const directory = resolve(
      this.config.get<string>(
        "PROFILE_PHOTO_STORAGE_DIR",
        "uploads/profile-photos",
      ),
    );
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, key), output, {
      flag: "wx",
      mode: 0o644,
    });
    return { key, url: this.publicUrl(key) };
  }

  async remove(key: unknown) {
    if (!this.isManagedKey(key)) return;
    const directory = resolve(
      this.config.get<string>(
        "PROFILE_PHOTO_STORAGE_DIR",
        "uploads/profile-photos",
      ),
    );
    try {
      await unlink(resolve(directory, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.logger.warn("Unable to remove an unused profile photo");
    }
  }
}
