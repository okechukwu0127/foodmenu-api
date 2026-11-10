import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import * as request from "supertest";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { PrismaService } from "@app/database";
import { ApiResponseInterceptor, HttpExceptionFilter } from "@app/common";
import { AppConfigModule } from "../apps/api-gateway/src/app-config/app-config.module";
import { seedAppConfiguration } from "../prisma/seed-data/app-config.seed";

const databaseUrl = process.env.APP_CONFIG_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite("Public application config (HTTP + PostgreSQL)", () => {
  const schema = `app_config_test_${randomUUID().replace(/-/g, "")}`;
  const input = () =>
    JSON.parse(readFileSync("prisma/app-config.json", "utf8"));
  let admin: PrismaClient, db: PrismaService, app: INestApplication;
  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("schema", schema);
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" },
    );
    db = new PrismaService({ datasources: { db: { url: url.toString() } } });
    const module = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 60000);
  beforeEach(async () => {
    await db.appConfiguration.deleteMany();
    await db.restaurant.deleteMany();
    await seedAppConfiguration(db, input());
  });
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
      await admin.$disconnect();
    }
  });
  const get = () => request(app.getHttpServer()).get("/api/v1/app/config");

  it("returns the public contract without authentication, secrets or a duplicated prefix/envelope", async () => {
    const response = await get().expect(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        version: 1,
        branding: { appName: "Eazy Eat", shortName: "Eazy Eat" },
        defaultRestaurant: {
          ...input().defaultRestaurant,
          address: {
            ...input().defaultRestaurant.address,
            longitude: expect.any(Number),
          },
        },
        updatedAt: expect.any(String),
      },
    });
    expect(response.body.data.defaultRestaurant.address.longitude).toBeCloseTo(
      input().defaultRestaurant.address.longitude,
      12,
    );
    expect(new Date(response.body.data.updatedAt).toISOString()).toBe(
      response.body.data.updatedAt,
    );
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=60, must-revalidate",
    );
    await request(app.getHttpServer())
      .get("/api/v1/api/v1/app/config")
      .expect(404);
  });
  it("returns a bodyless 304 for matching strong/weak/list ETags", async () => {
    const first = await get().expect(200);
    for (const value of [
      first.headers.etag,
      `W/${first.headers.etag}`,
      `"old", ${first.headers.etag}`,
      "*",
    ]) {
      const next = await get().set("If-None-Match", value).expect(304);
      expect(next.text).toBe("");
      expect(next.headers.etag).toBe(first.headers.etag);
    }
    await get().set("If-None-Match", '"outdated"').expect(200);
  });
  it("reads current restaurant address/name/coordinates and refreshes ETag independently of app settings", async () => {
    const first = await get().expect(200);
    const config = await db.appConfiguration.findUniqueOrThrow({
      where: { id: "default" },
    });
    await db.restaurant.update({
      where: { id: config.defaultRestaurantId },
      data: {
        restaurantName: "New name",
        addressFormatted: "New address",
        addressLine1: "New line",
        latitude: 51.5,
      },
    });
    const next = await get()
      .set("If-None-Match", first.headers.etag)
      .expect(200);
    expect(next.headers.etag).not.toBe(first.headers.etag);
    expect(next.body.data.defaultRestaurant).toMatchObject({
      restaurantName: "New name",
      address: { formatted: "New address", line1: "New line", latitude: 51.5 },
    });
    expect(next.body.data.branding.appName).toBe("Eazy Eat");
    expect(
      (
        await db.appConfiguration.findUniqueOrThrow({
          where: { id: "default" },
        })
      ).updatedAt,
    ).toEqual(config.updatedAt);
  });
  it("uses the configured restaurant instead of selecting an arbitrary active row", async () => {
    const existing = await db.restaurant.findUniqueOrThrow({
      where: { id: input().defaultRestaurant.id },
    });
    const other = await db.restaurant.create({
      data: {
        ...existing,
        id: randomUUID(),
        restaurantName: "Second restaurant",
      },
    });
    const before = await get().expect(200);
    expect(before.body.data.defaultRestaurant.id).toBe(existing.id);
    await db.appConfiguration.update({
      where: { id: "default" },
      data: { defaultRestaurantId: other.id },
    });
    const after = await get()
      .set("If-None-Match", before.headers.etag)
      .expect(200);
    expect(after.body.data.defaultRestaurant.id).toBe(other.id);
  });
  it("refreshes branding dynamically and falls back to appName for a null shortName", async () => {
    const before = await get().expect(200);
    await db.appConfiguration.update({
      where: { id: "default" },
      data: { appName: "Updated brand", shortName: null },
    });
    const after = await get()
      .set("If-None-Match", before.headers.etag)
      .expect(200);
    expect(after.body.data.branding).toEqual({
      appName: "Updated brand",
      shortName: "Updated brand",
    });
  });
  it("returns controlled 503 when settings are missing or default restaurant is inactive", async () => {
    await db.restaurant.update({
      where: { id: input().defaultRestaurant.id },
      data: { isActive: false },
    });
    expect((await get().expect(503)).body.error.code).toBe(
      "APP_CONFIG_UNAVAILABLE",
    );
    await db.appConfiguration.deleteMany();
    expect((await get().expect(503)).body.error.code).toBe(
      "APP_CONFIG_UNAVAILABLE",
    );
  });
  it("seeds idempotently and preserves operator settings during normal catalogue seeding", async () => {
    const before = await get().expect(200);
    await seedAppConfiguration(db, input(), true);
    expect((await get().expect(200)).headers.etag).toBe(before.headers.etag);
    await db.appConfiguration.update({
      where: { id: "default" },
      data: { appName: "Operator brand" },
    });
    await seedAppConfiguration(db, input());
    expect((await get().expect(200)).body.data.branding.appName).toBe(
      "Operator brand",
    );
    await seedAppConfiguration(db, input(), true);
    expect(await db.restaurant.count()).toBe(1);
    expect(await db.appConfiguration.count()).toBe(1);
    expect((await get().expect(200)).body.data.branding.appName).toBe(
      "Eazy Eat",
    );
  });
  it("rejects invalid seed inputs atomically", async () => {
    const before = await get().expect(200);
    const bad = input();
    bad.defaultRestaurant.address.latitude = 120;
    await expect(seedAppConfiguration(db, bad, true)).rejects.toThrow();
    expect((await get().expect(200)).headers.etag).toBe(before.headers.etag);
  });
  it("enforces singleton and restaurant foreign keys at the database level", async () => {
    const config = await db.appConfiguration.findUniqueOrThrow({
      where: { id: "default" },
    });
    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: config.defaultRestaurantId },
    });
    const alternate = await db.restaurant.create({
      data: { ...restaurant, id: randomUUID() },
    });
    await expect(
      db.appConfiguration.create({
        data: {
          id: "extra",
          appName: "Other",
          defaultRestaurantId: alternate.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.restaurant.delete({ where: { id: config.defaultRestaurantId } }),
    ).rejects.toThrow();
  });
  it("documents the public endpoint and complete nested schema in OpenAPI", () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(doc.paths["/api/v1/app/config"].get?.security).toBeUndefined();
    expect(doc.paths["/api/v1/app/config"].get?.responses["304"]).toBeDefined();
    expect(doc.components?.schemas?.RestaurantAddressDto).toBeDefined();
  });
});
