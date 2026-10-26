import { INestApplication, INestMicroservice } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from "@nestjs/microservices";
import { AddressInfo, Server } from "net";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import * as request from "supertest";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "@app/database";
import {
  ApiResponseInterceptor,
  createValidationPipe,
  HttpExceptionFilter,
} from "@app/common";
import { AuthModule } from "../apps/api-gateway/src/auth/auth.module";
import { VerificationMailService } from "../apps/identity-service/src/email/verification-mail.service";
import { IdentityServiceModule } from "../apps/identity-service/src/identity-service.module";

// Opt in through npm run test:addresses. Real PostgreSQL, real session guard,
// real TCP transport and real migration; all rows live in a disposable schema.
const databaseUrl = process.env.ADDRESSES_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
jest.setTimeout(60000);

describeDatabase("Customer addresses (HTTP + TCP + PostgreSQL)", () => {
  let app: INestApplication;
  let identity: INestMicroservice;
  let client: ClientProxy;
  let admin: PrismaClient;
  let prisma: PrismaService;
  let token: string;
  let otherToken: string;
  let customerId: string;
  let otherCustomerId: string;
  const schema = `addresses_test_${randomUUID().replace(/-/g, "")}`;
  const base = "/api/v1/me/addresses";
  const verificationCodes = new Map<string, string>();
  const mail = {
    assertConfigured: jest.fn(),
    sendVerification: jest.fn(async (email: string, code: string) => {
      verificationCodes.set(email, code);
    }),
  };
  const home = {
    label: "Home",
    address: "12 Example Street, Lagos, Nigeria",
    latitude: 6.5244,
    longitude: 3.3792,
  };

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    // Only a generated identifier is interpolated; credentials and user input are not SQL.
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
    const identityModule = await Test.createTestingModule({
      imports: [IdentityServiceModule],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          EMAIL_VERIFICATION_SECRET:
            "test-only-verification-secret-at-least-32-characters",
          EMAIL_VERIFICATION_TTL_SECONDS: 14400,
        }),
      )
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(VerificationMailService)
      .useValue(mail)
      .compile();
    identity = identityModule.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: "127.0.0.1", port: 0 },
      logger: false,
    });
    await identity.listen();
    const port = (identity.unwrap<Server>().address() as AddressInfo).port;
    client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: "127.0.0.1", port },
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
      .compile();
    app = gatewayModule.createNestApplication({ logger: false });
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    for (const [email, owner] of [
      ["owner@example.com", true],
      ["other@example.com", false],
    ] as const) {
      await request(app.getHttpServer())
        .post("/api/v1/auth/signup")
        .send({
          name: "Address Tester",
          email,
          phone: "+2348000000000",
          password: "address-test-password",
        })
        .expect(201);
      await request(app.getHttpServer())
        .post("/api/v1/auth/verify-email")
        .send({ email, code: verificationCodes.get(email) })
        .expect(200);
      const signedIn = await request(app.getHttpServer())
        .post("/api/v1/auth/signin")
        .send({ email, password: "address-test-password" })
        .expect(200);
      if (owner) {
        token = signedIn.body.data.accessToken;
        customerId = signedIn.body.data.user.id;
      } else {
        otherToken = signedIn.body.data.accessToken;
        otherCustomerId = signedIn.body.data.user.id;
      }
    }
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
    }
  });

  beforeEach(async () => {
    await prisma.$transaction([
      prisma.customer.updateMany({
        where: { id: { in: [customerId, otherCustomerId] } },
        data: { defaultAddressId: null },
      }),
      prisma.customerAddress.deleteMany({
        where: { customerId: { in: [customerId, otherCustomerId] } },
      }),
    ]);
  });

  const put = (id: string, body: object = home, bearer = token) =>
    request(app.getHttpServer())
      .put(`${base}/${encodeURIComponent(id)}`)
      .set("Authorization", `Bearer ${bearer}`)
      .send(body);
  const list = (bearer = token) =>
    request(app.getHttpServer())
      .get(base)
      .set("Authorization", `Bearer ${bearer}`);
  const setDefault = (addressId: string | null, bearer = token) =>
    request(app.getHttpServer())
      .put(`${base}/default`)
      .set("Authorization", `Bearer ${bearer}`)
      .send({ addressId });
  const remove = (id: string, bearer = token) =>
    request(app.getHttpServer())
      .delete(`${base}/${encodeURIComponent(id)}`)
      .set("Authorization", `Bearer ${bearer}`);

  it.each(["get", "put", "delete", "default"])(
    "requires a valid session for %s",
    async (method) => {
      for (const authorization of [
        undefined,
        "Bearer invalid",
        `Bearer ${"f".repeat(64)}`,
      ]) {
        const http = request(app.getHttpServer());
        const operation =
          method === "get"
            ? http.get(base)
            : method === "delete"
              ? http.delete(`${base}/address-1`)
              : http.put(
                  `${base}/${method === "default" ? "default" : "address-1"}`,
                );
        if (authorization) operation.set("Authorization", authorization);
        await operation.expect(401);
      }
    },
  );

  it("documents bearer security, nullable defaults, response envelopes and empty 204s", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const routes = document.paths;
    expect(routes[base].get?.security).toEqual([{ bearer: [] }]);
    expect(routes[`${base}/{id}`].put?.responses[200]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            properties: {
              success: { type: "boolean" },
              data: { $ref: "#/components/schemas/CustomerAddressResponseDto" },
            },
          },
        },
      },
    });
    expect(routes[`${base}/{id}`].delete?.responses[204]).not.toHaveProperty(
      "content",
    );
    expect(routes[`${base}/default`].put).toBeDefined();
    const schemas = document.components?.schemas;
    expect(schemas?.PutCustomerAddressDto).toMatchObject({
      required: ["label", "address"],
    });
    expect(schemas?.SetDefaultAddressDto).toMatchObject({
      required: ["addressId"],
      properties: { addressId: { nullable: true } },
    });
    expect(schemas?.PutCustomerAddressDto).not.toHaveProperty(
      "properties.customerId",
    );
  });

  it("returns the empty-account envelope", async () => {
    const result = await list().expect(200);
    expect(result.body).toMatchObject({
      success: true,
      data: { addresses: [], defaultAddressId: null },
    });
    expect(result.headers["cache-control"]).toBe("no-store");
  });

  it("creates, replaces and retries the same non-UUID ID without duplicates", async () => {
    const id = "offline-client-address-1";
    const created = await put(id, {
      ...home,
      label: " Home ",
      address: ` ${home.address} `,
    }).expect(200);
    expect(created.body.data).toEqual({ id, ...home });
    const original = await prisma.customerAddress.findUniqueOrThrow({
      where: { customerId_addressId: { customerId, addressId: id } },
    });
    await put(id).expect(200);
    const replaced = await put(id, {
      ...home,
      label: "Office",
      latitude: 0,
      longitude: 0,
    }).expect(200);
    expect(replaced.body.data).toEqual({
      ...home,
      id,
      label: "Office",
      latitude: 0,
      longitude: 0,
    });
    expect(
      await prisma.customerAddress.count({
        where: { customerId, addressId: id },
      }),
    ).toBe(1);
    const saved = await prisma.customerAddress.findUniqueOrThrow({
      where: { customerId_addressId: { customerId, addressId: id } },
    });
    expect(saved.createdAt).toEqual(original.createdAt);
    expect(saved.updatedAt.getTime()).toBeGreaterThanOrEqual(
      original.updatedAt.getTime(),
    );
    expect((await list()).body.data.defaultAddressId).toBeNull();
  });

  it("saves manual addresses and clears each omitted coordinate on replacement", async () => {
    const manual = { label: "Manual", address: "A manually entered address" };
    expect((await put("manual", manual).expect(200)).body.data).toEqual({
      id: "manual",
      ...manual,
    });
    await put("manual").expect(200);
    expect(
      (await put("manual", { ...manual, longitude: 12 }).expect(200)).body.data,
    ).toEqual({ id: "manual", ...manual, longitude: 12 });
    expect((await put("manual", manual).expect(200)).body.data).toEqual({
      id: "manual",
      ...manual,
    });
    expect((await list()).body.data.addresses).toEqual([
      { id: "manual", ...manual },
    ]);
    const saved = await prisma.customerAddress.findUniqueOrThrow({
      where: { customerId_addressId: { customerId, addressId: "manual" } },
    });
    expect(saved.latitude).toBeNull();
    expect(saved.longitude).toBeNull();
  });

  it.each([
    { label: " " },
    { label: "x".repeat(101) },
    { label: null },
    { address: " " },
    { address: "x".repeat(1001) },
    { address: 12 },
    { latitude: 90.01 },
    { latitude: -90.01 },
    { latitude: "6.5" },
    { latitude: null },
    { longitude: 180.01 },
    { longitude: -180.01 },
    { longitude: "3.3" },
    { customerId: "another-customer" },
    { mutationId: "unnecessary" },
  ])("rejects invalid or extra input: %j", async (change) => {
    await put("invalid", { ...home, ...change }).expect(400);
    expect(await prisma.customerAddress.count({ where: { customerId } })).toBe(
      0,
    );
  });

  it("validates required fields and ID length, and accepts boundary values", async () => {
    await put("missing", {}).expect(400);
    await put("x".repeat(129)).expect(400);
    await put("x".repeat(128), {
      ...home,
      label: "x".repeat(100),
      address: "x".repeat(1000),
      latitude: -90,
      longitude: 180,
    }).expect(200);
    await put("other-boundary", {
      ...home,
      latitude: 90,
      longitude: -180,
    }).expect(200);
  });

  it("isolates identical address IDs between customers on save, list and delete", async () => {
    await put("same-id").expect(200);
    expect((await list(otherToken)).body.data.addresses).toEqual([]);
    await put("same-id", { ...home, label: "Other home" }, otherToken).expect(
      200,
    );
    expect((await list()).body.data.addresses[0].label).toBe("Home");
    expect((await list(otherToken)).body.data.addresses[0].label).toBe(
      "Other home",
    );
    await remove("same-id", otherToken).expect(204);
    expect((await list()).body.data.addresses).toHaveLength(1);
  });

  it("selects and clears defaults idempotently and preserves them when saving", async () => {
    await put("a").expect(200);
    await setDefault("a").expect(200);
    expect((await setDefault("a").expect(200)).body.data).toEqual({
      defaultAddressId: "a",
    });
    await put("a", { ...home, label: "Updated" }).expect(200);
    await put("b").expect(200);
    expect((await list()).body.data.defaultAddressId).toBe("a");
    expect((await setDefault(null).expect(200)).body.data).toEqual({
      defaultAddressId: null,
    });
    await setDefault(null).expect(200);
    expect((await list()).body.data.defaultAddressId).toBeNull();
  });

  it("rejects another customer's default ID and ignores their delete target", async () => {
    await put("foreign", home, otherToken).expect(200);
    await setDefault("foreign", otherToken).expect(200);
    await setDefault("foreign").expect(404);
    await remove("foreign").expect(204);
    expect((await list()).body.data).toEqual({
      addresses: [],
      defaultAddressId: null,
    });
    expect((await list(otherToken)).body.data.defaultAddressId).toBe("foreign");
  });

  it("routes the static default endpoint before :id and validates its body", async () => {
    await setDefault(null).expect(200);
    expect((await list()).body.data.addresses).toEqual([]);
    for (const body of [
      {},
      { addressId: 1 },
      { addressId: "" },
      { addressId: "x".repeat(129) },
      { addressId: null, customerId },
    ]) {
      await request(app.getHttpServer())
        .put(`${base}/default`)
        .set("Authorization", `Bearer ${token}`)
        .send(body)
        .expect(400);
    }
  });

  it("replaces a deleted default deterministically, permits the final delete and retries with empty 204", async () => {
    for (const id of ["c", "b", "a"]) await put(id).expect(200);
    await setDefault("c").expect(200);
    await remove("b").expect(204); // Non-default removal preserves c.
    expect((await list()).body.data.defaultAddressId).toBe("c");
    const deleted = await remove("c").expect(204);
    expect(deleted.text).toBe("");
    expect(deleted.headers["content-type"]).toBeUndefined();
    expect((await list()).body.data.defaultAddressId).toBe("a");
    await remove("a").expect(204);
    const repeated = await remove("a").expect(204);
    expect(repeated.text).toBe("");
    expect((await list()).body.data).toEqual({
      addresses: [],
      defaultAddressId: null,
    });
  });

  it("keeps a valid default under concurrent saves, deletes, selections and reads", async () => {
    for (const id of ["a", "b", "stable"]) await put(id).expect(200);
    await setDefault("a").expect(200);
    for (let round = 0; round < 3; round++) {
      const results = await Promise.all([
        put("a", { ...home, label: `A ${round}` }),
        remove("a"),
        setDefault("a"),
        put("b", { ...home, label: `B ${round}` }),
        remove("b"),
        setDefault("b"),
        setDefault(null),
        setDefault("stable"),
        list(),
        list(),
      ]);
      for (const index of [0, 3, 6, 7, 8, 9])
        expect(results[index].status).toBe(200);
      for (const index of [1, 4]) expect(results[index].status).toBe(204);
      for (const index of [2, 5])
        expect([200, 404]).toContain(results[index].status);
      for (const result of results.slice(-2)) {
        const { addresses, defaultAddressId } = result.body.data;
        expect(
          defaultAddressId === null ||
            addresses.some(
              (address: { id: string }) => address.id === defaultAddressId,
            ),
        ).toBe(true);
      }
      const state = (await list().expect(200)).body.data;
      expect(
        state.defaultAddressId === null ||
          state.addresses.some(
            (address: { id: string }) => address.id === state.defaultAddressId,
          ),
      ).toBe(true);
    }
  });

  it("serializes concurrent replacements and retains the final accepted write without duplicates", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        put("concurrent", { ...home, label: `Version ${i}` }),
      ),
    );
    for (const result of results) expect(result.status).toBe(200);
    await put("concurrent", { ...home, label: "Final accepted write" }).expect(
      200,
    );
    const state = (await list()).body.data;
    expect(state.addresses).toEqual([
      { ...home, id: "concurrent", label: "Final accepted write" },
    ]);
    expect(
      await prisma.customerAddress.count({
        where: { customerId, addressId: "concurrent" },
      }),
    ).toBe(1);
  });

  it("enforces default ownership and referential integrity in PostgreSQL itself", async () => {
    await put("foreign", home, otherToken).expect(200);
    await expect(
      prisma.customer.update({
        where: { id: customerId },
        data: { defaultAddressId: "foreign" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await put("owned").expect(200);
    await setDefault("owned").expect(200);
    await expect(
      prisma.customerAddress.delete({
        where: { customerId_addressId: { customerId, addressId: "owned" } },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    expect((await list()).body.data.defaultAddressId).toBe("owned");
  });
});
