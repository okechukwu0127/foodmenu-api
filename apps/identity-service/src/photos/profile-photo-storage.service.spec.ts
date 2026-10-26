import { ConfigService } from "@nestjs/config";
import { mkdtemp, readFile, readdir, rm, writeFile, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as sharpModule from "sharp";
import { PROFILE_PHOTO_MAX_BYTES } from "@app/dto";
import { ProfilePhotoStorageService } from "./profile-photo-storage.service";
const sharp =
  sharpModule.default ?? (sharpModule as unknown as typeof sharpModule.default);

describe("Local profile photo processing", () => {
  let directory: string;
  let photos: ProfilePhotoStorageService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "foodmenu-photo-"));
    photos = new ProfilePhotoStorageService(
      new ConfigService({
        PROFILE_PHOTO_STORAGE_DIR: directory,
        PUBLIC_ASSET_BASE_URL: "https://assets.example.com/",
      }),
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["png", "jpeg", "webp"] as const)(
    "decodes %s pixels, resizes, removes metadata and stores a WebP with a generated key",
    async (format) => {
      const input = await sharp({
        create: { width: 1000, height: 800, channels: 3, background: "red" },
      })
        .withMetadata({ orientation: 6 })
        .toFormat(format)
        .toBuffer();
      const result = await photos.store(
        input.toString("base64"),
        `image/${format}`,
      );
      expect(result.key).toMatch(/^[a-f0-9-]{36}\.webp$/);
      expect(result.url).toBe(
        `https://assets.example.com/uploads/profile-photos/${result.key}`,
      );
      const output = await sharp(
        await readFile(join(directory, result.key)),
      ).metadata();
      expect(output).toMatchObject({ format: "webp", width: 512, height: 512 });
      expect(output.exif).toBeUndefined();
      expect(output.orientation).toBeUndefined();
      expect(output.icc).toBeUndefined();
    },
  );

  it("rejects spoofed content, SVG and truncated files without saving them", async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    for (const [content, mime] of [
      [Buffer.from("not an image"), "image/png"],
      [
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
        "image/svg+xml",
      ],
      [png, "image/jpeg"],
      [png.subarray(0, 12), "image/png"],
    ] as const) {
      await expect(
        photos.store(content.toString("base64"), mime),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects oversized bytes and excessive decoded dimensions", async () => {
    await expect(
      photos.store(
        Buffer.alloc(PROFILE_PHOTO_MAX_BYTES + 1).toString("base64"),
        "image/png",
      ),
    ).rejects.toMatchObject({ status: 413 });
    for (const [width, height] of [
      [8193, 1],
      [4097, 4097],
    ]) {
      const image = await sharp({
        create: { width, height, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
      await expect(
        photos.store(image.toString("base64"), "image/png"),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it("removes only managed photo keys, tolerates repeated removal, and rejects path traversal", async () => {
    const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";
    const sentinel = join(directory, "keep.txt");
    await writeFile(sentinel, "keep");
    await writeFile(join(directory, key), "photo");
    await photos.remove("../keep.txt");
    await photos.remove("https://example.com/photo.webp");
    await access(sentinel);
    await photos.remove(key);
    await photos.remove(key);
    expect(await readdir(directory)).toEqual(["keep.txt"]);
    expect(() => photos.publicUrl("../keep.txt")).toThrow(
      "Invalid profile photo key",
    );
  });
});
