import { INestApplication, INestMicroservice } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from "@nestjs/microservices";
import { AddressInfo, Server } from "net";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { access, mkdtemp, mkdir, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import * as request from "supertest";
import { PrismaClient } from "@prisma/client";
import * as sharpModule from "sharp";
import { PrismaService } from "@app/database";
import {
  ApiResponseInterceptor,
  createValidationPipe,
  HttpExceptionFilter,
} from "@app/common";
import { PROFILE_PHOTO_MAX_BYTES } from "@app/dto";
import { AuthModule } from "../apps/api-gateway/src/auth/auth.module";
import { mountProfilePhotoAssets } from "../apps/api-gateway/src/auth/profile-photo-assets";
import { IdentityServiceModule } from "../apps/identity-service/src/identity-service.module";
import { GoogleTokenVerifier } from "../apps/identity-service/src/auth/auth.service";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

const sharp =
  sharpModule.default ?? (sharpModule as unknown as typeof sharpModule.default);
const databaseUrl = process.env.PROFILE_PHOTOS_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
jest.setTimeout(60000);

describeDatabase(
  "Profile photos (HTTP + TCP + PostgreSQL + filesystem)",
  () => {
    let app: INestApplication;
    let identity: INestMicroservice;
    let client: ClientProxy;
    let admin: PrismaClient;
    let prisma: PrismaService;
    let config: ConfigService;
    let directory: string;
    let token: string;
    let otherToken: string;
    let customerId: string;
    let otherCustomerId: string;
    let png: Buffer;
    const schema = `photos_test_${randomUUID().replace(/-/g, "")}`;
    const uploadPath = "/api/v1/auth/me/photo";
    const google = {
      verify: jest.fn(async (idToken: string) => ({
        sub: idToken.startsWith("owner") ? "owner-google" : "other-google",
        email: idToken.startsWith("owner")
          ? "owner@example.com"
          : "other@example.com",
        name: "Photo Tester",
        photoUrl:
          idToken === "owner-updated"
            ? "https://example.com/google-new.jpg"
            : "https://example.com/google.jpg",
      })),
    };

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "foodmenu-photos-e2e-"));
      png = await sharp({
        create: { width: 1000, height: 800, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer();
      admin = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      const url = new URL(databaseUrl!);
      url.searchParams.set("schema", schema);
      execFileSync(
        process.execPath,
        ["node_modules/prisma/build/index.js", "migrate", "deploy"],
        {
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: "pipe",
        },
      );
      prisma = new PrismaService({
        datasources: { db: { url: url.toString() } },
      });
      config = new ConfigService({
        PROFILE_PHOTO_STORAGE_DIR: directory,
        PUBLIC_ASSET_BASE_URL: "http://localhost:4000",
      });
      const identityModule = await Test.createTestingModule({
        imports: [IdentityServiceModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(GoogleTokenVerifier)
        .useValue(google)
        .compile();
      identity = identityModule.createNestMicroservice({
        transport: Transport.TCP,
        options: { host: "127.0.0.1", port: 0 },
        logger: false,
      });
      await identity.listen();
      client = ClientProxyFactory.create({
        transport: Transport.TCP,
        options: {
          host: "127.0.0.1",
          port: (identity.unwrap<Server>().address() as AddressInfo).port,
        },
      });
      const gatewayModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
          ThrottlerModule.forRoot([{ limit: 20, ttl: 60000 }]),
          AuthModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider("IDENTITY_SERVICE")
        .useValue(client)
        .overrideGuard(ThrottlerGuard)
        .useValue({ canActivate: () => true })
        .compile();
      app = gatewayModule.createNestApplication({ logger: false });
      mountProfilePhotoAssets(app, config);
      app.setGlobalPrefix("api/v1");
      app.useGlobalPipes(createValidationPipe());
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new ApiResponseInterceptor());
      await app.listen(0, "127.0.0.1");
      const owner = await request(app.getHttpServer())
        .post("/api/v1/auth/google")
        .send({ idToken: "owner" })
        .expect(200);
      token = owner.body.data.accessToken;
      customerId = owner.body.data.user.id;
      const other = await request(app.getHttpServer())
        .post("/api/v1/auth/google")
        .send({ idToken: "other" })
        .expect(200);
      otherToken = other.body.data.accessToken;
      otherCustomerId = other.body.data.user.id;
    });
    beforeEach(async () => {
      config.set("PROFILE_PHOTO_STORAGE_DIR", directory);
      config.set("PUBLIC_ASSET_BASE_URL", "http://localhost:4000");
      await prisma.customer.updateMany({
        where: { id: { in: [customerId, otherCustomerId] } },
        data: {
          metadata: {
            preference: "preserved",
            profile: {
              photoUrl: "https://example.com/google.jpg",
              photoSource: "google",
            },
          },
        },
      });
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory);
    });
    afterAll(async () => {
      try {
        await app?.close();
        client?.close();
        await identity?.close();
        await prisma?.$disconnect();
      } finally {
        if (admin) {
          await admin.$executeRawUnsafe(
            `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
          );
          await admin.$disconnect();
        }
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    });

    const upload = (bearer = token, image = png, contentType = "image/png") =>
      request(app.getHttpServer())
        .post(uploadPath)
        .set("Authorization", `Bearer ${bearer}`)
        .attach("photo", image, {
          filename: "../../untrusted-name.png",
          contentType,
        });
    const me = (bearer = token) =>
      request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${bearer}`);
    const photoRequest = (url: string) =>
      request(app.getHttpServer()).get(new URL(url).pathname);

    it("requires a valid bearer token before storing an upload", async () => {
      await request(app.getHttpServer())
        .post(uploadPath)
        .attach("photo", png, "photo.png")
        .expect(401);
      await upload("a".repeat(64)).expect(401);
      expect(await readdir(directory)).toEqual([]);
    });

    it("stores a resized WebP, returns its URL, and serves it through the profile query", async () => {
      const result = await upload().expect(200);
      expect(result.body).toMatchObject({
        success: true,
        data: { id: customerId },
      });
      const photoUrl = result.body.data.photoUrl;
      expect(photoUrl).toMatch(
        /^http:\/\/localhost:4000\/uploads\/profile-photos\/[a-f0-9-]{36}\.webp$/,
      );
      expect((await me().expect(200)).body.data.photoUrl).toBe(photoUrl);
      const fetched = await photoRequest(photoUrl)
        .expect(200)
        .expect("Content-Type", /image\/webp/);
      expect(fetched.headers["x-content-type-options"]).toBe("nosniff");
      expect(fetched.headers["cache-control"]).toContain("immutable");
      expect(await sharp(fetched.body).metadata()).toMatchObject({
        format: "webp",
        width: 512,
        height: 512,
      });
      const customer = await prisma.customer.findUniqueOrThrow({
        where: { id: customerId },
      });
      expect(customer.metadata).toMatchObject({
        preference: "preserved",
        profile: { photoSource: "upload" },
      });
      expect(result.body.data).not.toHaveProperty("imageBase64");
    });

    it("accepts a valid multi-megabyte multipart image across the TCP service boundary", async () => {
      const large = await sharp({
        create: { width: 1024, height: 1024, channels: 3, background: "green" },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      expect(large.length).toBeGreaterThan(3 * 1024 * 1024);
      const result = await upload(token, large, "image/png").expect(200);
      await photoRequest(result.body.data.photoUrl).expect(200);
    });

    it("replaces only the signed-in customer's image and removes the old file after replacement", async () => {
      const first = (await upload().expect(200)).body.data.photoUrl;
      const other = (await upload(otherToken).expect(200)).body.data.photoUrl;
      const second = (await upload().expect(200)).body.data.photoUrl;
      expect(second).not.toBe(first);
      await photoRequest(first).expect(404);
      await photoRequest(second).expect(200);
      await photoRequest(other).expect(200);
      expect((await me(otherToken)).body.data.photoUrl).toBe(other);
      expect(await readdir(directory)).toHaveLength(2);
    });

    it("rejects missing files, unexpected fields, extra files and attempts to choose another user", async () => {
      await request(app.getHttpServer())
        .post(uploadPath)
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
      await request(app.getHttpServer())
        .post(uploadPath)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", png, "photo.png")
        .expect(400);
      await request(app.getHttpServer())
        .post(uploadPath)
        .set("Authorization", `Bearer ${token}`)
        .field("customerId", otherCustomerId)
        .attach("photo", png, "photo.png")
        .expect(400);
      await request(app.getHttpServer())
        .post(uploadPath)
        .set("Authorization", `Bearer ${token}`)
        .attach("photo", png, "one.png")
        .attach("photo", png, "two.png")
        .expect(400);
      expect(await readdir(directory)).toEqual([]);
    });

    it("rejects spoofed contents and oversized uploads while keeping the current image", async () => {
      const original = (await upload().expect(200)).body.data.photoUrl;
      await upload(token, Buffer.from("not a real PNG"), "image/png").expect(
        400,
      );
      await upload(token, png, "image/jpeg").expect(400);
      await upload(token, Buffer.from("<svg></svg>"), "image/svg+xml").expect(
        400,
      );
      await upload(
        token,
        Buffer.alloc(PROFILE_PHOTO_MAX_BYTES + 1),
        "image/png",
      ).expect(413);
      expect((await me()).body.data.photoUrl).toBe(original);
      await photoRequest(original).expect(200);
      expect(await readdir(directory)).toHaveLength(1);
    });

    it("preserves uploaded photos across Google signin and name/phone updates", async () => {
      const uploaded = (await upload().expect(200)).body.data.photoUrl;
      const signedIn = await request(app.getHttpServer())
        .post("/api/v1/auth/google")
        .send({ idToken: "owner-updated" })
        .expect(200);
      expect(signedIn.body.data.user.photoUrl).toBe(uploaded);
      const updated = await request(app.getHttpServer())
        .patch("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Changed Name", phone: "+2348000000000" })
        .expect(200);
      expect(updated.body.data.photoUrl).toBe(uploaded);
      await photoRequest(uploaded).expect(200);
    });

    it("serializes concurrent uploads so the final profile points to an existing image", async () => {
      const results = await Promise.all([upload(), upload(), upload()]);
      for (const result of results) expect(result.status).toBe(200);
      const current = (await me().expect(200)).body.data.photoUrl;
      expect(results.map((result) => result.body.data.photoUrl)).toContain(
        current,
      );
      await photoRequest(current).expect(200);
      expect(await readdir(directory)).toEqual([basename(current)]);
    });

    it("keeps the uploaded photo when Google refresh races with the upload", async () => {
      const [uploaded, googleResult] = await Promise.all([
        upload(),
        request(app.getHttpServer())
          .post("/api/v1/auth/google")
          .send({ idToken: "owner-updated" }),
      ]);
      expect(uploaded.status).toBe(200);
      expect(googleResult.status).toBe(200);
      const current = (await me()).body.data.photoUrl;
      expect(current).toBe(uploaded.body.data.photoUrl);
      await photoRequest(current).expect(200);
      expect(await readdir(directory)).toHaveLength(1);
    });

    it("retains the current image when storage is unavailable", async () => {
      const original = (await upload().expect(200)).body.data.photoUrl;
      const blocked = join(directory, "not-a-directory");
      await writeFile(blocked, "blocked");
      config.set("PROFILE_PHOTO_STORAGE_DIR", blocked);
      try {
        await upload().expect(500);
      } finally {
        config.set("PROFILE_PHOTO_STORAGE_DIR", directory);
      }
      expect((await me()).body.data.photoUrl).toBe(original);
      await access(join(directory, basename(original)));
    });

    it("keeps a legacy custom URL across Google login and cleans up a replaced managed photo", async () => {
      const original = (await upload().expect(200)).body.data.photoUrl;
      await request(app.getHttpServer())
        .patch("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ photoUrl: "https://example.com/custom-avatar.jpg" })
        .expect(200);
      await photoRequest(original).expect(404);
      const result = await request(app.getHttpServer())
        .post("/api/v1/auth/google")
        .send({ idToken: "owner-updated" })
        .expect(200);
      expect(result.body.data.user.photoUrl).toBe(
        "https://example.com/custom-avatar.jpg",
      );
    });

    it("does not delete a managed photo when its unchanged URL is included in a profile patch", async () => {
      config.set("PUBLIC_ASSET_BASE_URL", "https://assets.example.com");
      const original = (await upload().expect(200)).body.data.photoUrl;
      await request(app.getHttpServer())
        .patch("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Same photo", photoUrl: original })
        .expect(200);
      await photoRequest(original).expect(200);
      expect((await me()).body.data.photoUrl).toBe(original);
    });

    it("documents the binary multipart photo field and authentication", () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().addBearerAuth().build(),
      );
      expect(document.paths[uploadPath].post?.security).toEqual([
        { bearer: [] },
      ]);
      expect(document.paths[uploadPath].post?.requestBody).toMatchObject({
        content: {
          "multipart/form-data": {
            schema: {
              required: ["photo"],
              properties: { photo: { type: "string", format: "binary" } },
            },
          },
        },
      });
      expect(document.paths[uploadPath].post?.responses[413]).toBeDefined();
    });
  },
);
