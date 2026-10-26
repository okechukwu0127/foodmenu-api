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
import { createHash, randomBytes, randomUUID } from "crypto";
import * as request from "supertest";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "@app/database";
import { AppError } from "@app/errors";
import {
  ApiResponseInterceptor,
  createValidationPipe,
  HttpExceptionFilter,
} from "@app/common";
import { AuthModule } from "../apps/api-gateway/src/auth/auth.module";
import { IdentityServiceModule } from "../apps/identity-service/src/identity-service.module";
import { VerificationMailService } from "../apps/identity-service/src/email/verification-mail.service";

const databaseUrl = process.env.EMAIL_VERIFICATION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
jest.setTimeout(60000);

describeDatabase("Email verification (HTTP + TCP + PostgreSQL)", () => {
  let app: INestApplication;
  let identity: INestMicroservice;
  let client: ClientProxy;
  let admin: PrismaClient;
  let prisma: PrismaService;
  let config: ConfigService;
  const schema = `email_test_${randomUUID().replace(/-/g, "")}`;
  const deliveries: { email: string; code: string; ttl: number }[] = [];
  const mail = { assertConfigured: jest.fn(), sendVerification: jest.fn() };
  const password = "email-verification-test-password";
  const base = "/api/v1/auth";

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
    config = identityModule.get(ConfigService);
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
      // Exercise persisted limits repeatedly without exhausting the independent IP limit.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = gatewayModule.createNestApplication({ logger: false });
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, "127.0.0.1");
  });
  beforeEach(() => {
    mail.assertConfigured.mockReset();
    mail.sendVerification
      .mockReset()
      .mockImplementation(async (email: string, code: string, ttl: number) => {
        deliveries.push({ email, code, ttl });
      });
    config.set("EMAIL_VERIFICATION_TTL_SECONDS", 14400);
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

  const emailAddress = () => `${randomUUID()}@example.com`;
  const register = async (email = emailAddress()) => {
    const response = await request(app.getHttpServer())
      .post(`${base}/signup`)
      .send({ name: "Email Tester", email, phone: "+2348000000000", password })
      .expect(201);
    const delivery = [...deliveries]
      .reverse()
      .find((item) => item.email === email)!;
    return { email, code: delivery.code, response };
  };
  const verify = (email: string, code: string) =>
    request(app.getHttpServer())
      .post(`${base}/verify-email`)
      .send({ email, code });
  const resend = (email: string) =>
    request(app.getHttpServer())
      .post(`${base}/resend-verification`)
      .send({ email });
  const login = (email: string, suppliedPassword = password) =>
    request(app.getHttpServer())
      .post(`${base}/signin`)
      .send({ email, password: suppliedPassword });
  const account = (email: string) =>
    prisma.authAccount.findUniqueOrThrow({ where: { email } });
  const allowResend = async (email: string) => {
    const owner = await account(email);
    await prisma.emailVerification.update({
      where: { accountId: owner.id },
      data: { requestedAt: new Date(Date.now() - 61000) },
    });
  };

  it("registers an inactive account, sends a six-digit code, and stores only its keyed hash", async () => {
    const { email, code, response } = await register();
    expect(response.body.data).toMatchObject({
      email,
      isActive: false,
      requiresEmailVerification: true,
      expiresIn: 14400,
      resendAfterSeconds: 60,
    });
    expect(response.body.data).not.toHaveProperty("accessToken");
    expect(JSON.stringify(response.body)).not.toContain(code);
    expect(code).toMatch(/^\d{6}$/);
    const owner = await account(email);
    expect(owner.emailVerifiedAt).toBeNull();
    expect(
      await prisma.authSession.count({ where: { accountId: owner.id } }),
    ).toBe(0);
    const pending = await prisma.emailVerification.findUniqueOrThrow({
      where: { accountId: owner.id },
    });
    expect(pending.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pending.codeHash).not.toContain(code);
    expect(pending.expiresAt!.getTime() - pending.sentAt!.getTime()).toBe(
      14400000,
    );
  });

  it("flags inactive accounts only after validating the password and blocks old bearer sessions", async () => {
    const { email, code } = await register();
    const blocked = await login(email).expect(403);
    expect(blocked.body).toMatchObject({
      success: false,
      error: {
        code: "ACCOUNT_NOT_ACTIVATED",
        details: { requiresEmailVerification: true },
      },
    });
    await login(email, "wrong-password").expect(401);
    const owner = await account(email);
    const oldToken = randomBytes(32).toString("hex");
    await prisma.authSession.create({
      data: {
        accountId: owner.id,
        tokenHash: createHash("sha256").update(oldToken).digest("hex"),
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    await request(app.getHttpServer())
      .get("/api/v1/me/addresses")
      .set("Authorization", `Bearer ${oldToken}`)
      .expect(403);
    await verify(email, code).expect(200);
    await request(app.getHttpServer())
      .get(`${base}/me`)
      .set("Authorization", `Bearer ${oldToken}`)
      .expect(401);
  });

  it("activates once and then issues a session only through signin", async () => {
    const { email, code } = await register();
    const activated = await verify(email, code).expect(200);
    expect(activated.body.data).toMatchObject({
      activated: true,
      emailVerified: true,
      isActive: true,
    });
    expect(activated.body.data).not.toHaveProperty("accessToken");
    const signedIn = await login(email).expect(200);
    expect(signedIn.body.data.user).toMatchObject({
      email,
      isActive: true,
      emailVerified: true,
    });
    await request(app.getHttpServer())
      .get(`${base}/me`)
      .set("Authorization", `Bearer ${signedIn.body.data.accessToken}`)
      .expect(200);
    await verify(email, code).expect(400);
    const owner = await account(email);
    expect(
      await prisma.emailVerification.findUnique({
        where: { accountId: owner.id },
      }),
    ).toBeNull();
  });

  it("rejects expired codes without activating the account", async () => {
    const { email, code } = await register();
    await prisma.emailVerification.update({
      where: { accountId: (await account(email)).id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const result = await verify(email, code).expect(400);
    expect(result.body.error.code).toBe("INVALID_OR_EXPIRED_VERIFICATION_CODE");
    await login(email).expect(403);
  });

  it("supports a two-hour lifetime when configured", async () => {
    config.set("EMAIL_VERIFICATION_TTL_SECONDS", 7200);
    const { email, response } = await register();
    expect(response.body.data.expiresIn).toBe(7200);
    const pending = await prisma.emailVerification.findUniqueOrThrow({
      where: { accountId: (await account(email)).id },
    });
    expect(pending.expiresAt!.getTime() - pending.sentAt!.getTime()).toBe(
      7200000,
    );
  });

  it("persists failed guesses, locks after five, and allows recovery with a new code", async () => {
    const { email, code } = await register();
    const wrongCode = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await verify(email, wrongCode).expect(400);
    expect(
      (
        await prisma.emailVerification.findUniqueOrThrow({
          where: { accountId: (await account(email)).id },
        })
      ).attempts,
    ).toBe(4);
    expect((await verify(email, wrongCode).expect(429)).body.error.code).toBe(
      "VERIFICATION_ATTEMPTS_EXCEEDED",
    );
    await verify(email, code).expect(429);
    await allowResend(email);
    await resend(email).expect(200);
    const fresh = deliveries[deliveries.length - 1].code;
    expect(fresh).not.toBe(code);
    await verify(email, fresh).expect(200);
  });

  it("enforces resend cooldown and invalidates the previous code", async () => {
    const { email, code } = await register();
    const limited = await resend(email).expect(429);
    expect(limited.body.error.code).toBe("VERIFICATION_RESEND_TOO_SOON");
    expect(limited.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(
      60,
    );
    await allowResend(email);
    const result = await resend(email).expect(200);
    expect(result.body.data).not.toHaveProperty("code");
    const fresh = deliveries[deliveries.length - 1].code;
    await verify(email, code).expect(400);
    await verify(email, fresh).expect(200);
  });

  it("returns the same generic resend data for unknown and active accounts without sending emails", async () => {
    const { email, code } = await register();
    await verify(email, code).expect(200);
    const before = deliveries.length;
    const active = await resend(email).expect(200);
    const unknown = await resend(emailAddress()).expect(200);
    expect(active.body.data).toEqual(unknown.body.data);
    expect(deliveries.length).toBe(before);
    await verify(emailAddress(), "123456").expect(400);
  });

  it("keeps a failed-delivery account inactive and allows resend recovery", async () => {
    const email = emailAddress();
    mail.sendVerification.mockRejectedValueOnce(
      new AppError(
        "VERIFICATION_EMAIL_SEND_FAILED",
        "Email delivery failed",
        503,
      ),
    );
    const failed = await request(app.getHttpServer())
      .post(`${base}/signup`)
      .send({ name: "Email Tester", email, phone: "+2348000000000", password })
      .expect(503);
    expect(failed.body.error.code).toBe("VERIFICATION_EMAIL_SEND_FAILED");
    const owner = await account(email);
    expect(owner.emailVerifiedAt).toBeNull();
    const pending = await prisma.emailVerification.findUniqueOrThrow({
      where: { accountId: owner.id },
    });
    expect(pending.sentAt).toBeNull();
    expect(pending.expiresAt).toBeNull();
    await login(email).expect(403);
    await allowResend(email);
    await resend(email).expect(200);
    await verify(email, deliveries[deliveries.length - 1].code).expect(200);
  });

  it("does not create an account when delivery configuration is missing", async () => {
    mail.assertConfigured.mockImplementationOnce(() => {
      throw new AppError(
        "EMAIL_DELIVERY_NOT_CONFIGURED",
        "Email is not configured",
        503,
      );
    });
    const email = emailAddress();
    await request(app.getHttpServer())
      .post(`${base}/signup`)
      .send({ name: "Email Tester", email, phone: "+2348000000000", password })
      .expect(503);
    expect(
      await prisma.authAccount.findUnique({ where: { email } }),
    ).toBeNull();
  });

  it("consumes the code exactly once under concurrent verification", async () => {
    const { email, code } = await register();
    const results = await Promise.all([
      verify(email, code),
      verify(email, code),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    await login(email).expect(200);
  });

  it("sends only one email under concurrent resends", async () => {
    const { email } = await register();
    await allowResend(email);
    const before = deliveries.length;
    const results = await Promise.all(
      Array.from({ length: 4 }, () => resend(email)),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      200, 429, 429, 429,
    ]);
    expect(deliveries.length).toBe(before + 1);
  });

  it("starts expiry only after delivery acceptance and rejects pending codes", async () => {
    const email = emailAddress();
    let started!: () => void;
    let release!: () => void;
    const reachedSMTP = new Promise<void>((resolve) => {
      started = resolve;
    });
    const accepted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let code = "";
    mail.sendVerification.mockImplementationOnce(
      async (_email: string, sentCode: string) => {
        code = sentCode;
        started();
        await accepted;
      },
    );
    const signup = request(app.getHttpServer())
      .post(`${base}/signup`)
      .send({ name: "Email Tester", email, phone: "+2348000000000", password })
      .then((response) => response);
    await reachedSMTP;
    const owner = await account(email);
    await prisma.emailVerification.update({
      where: { accountId: owner.id },
      data: { requestedAt: new Date(Date.now() - 7200000) },
    });
    await verify(email, code).expect(400);
    const beforeAcceptance = Date.now();
    release();
    expect((await signup).status).toBe(201);
    const pending = await prisma.emailVerification.findUniqueOrThrow({
      where: { accountId: owner.id },
    });
    expect(pending.sentAt!.getTime()).toBeGreaterThanOrEqual(beforeAcceptance);
    expect(pending.expiresAt!.getTime() - pending.sentAt!.getTime()).toBe(
      14400000,
    );
    await verify(email, code).expect(200);
  });

  it("accepts exactly six digits and rejects the former eight-digit format", async () => {
    const { email, code } = await register();
    expect(code).toMatch(/^\d{6}$/);
    await verify(email, `${code}12`).expect(400);
    await verify(email, code.slice(0, 5)).expect(400);
    const pending = await prisma.emailVerification.findUniqueOrThrow({
      where: { accountId: (await account(email)).id },
    });
    expect(pending.attempts).toBe(0);
    await verify(email, code).expect(200);
  });

  it("validates verification and resend inputs", async () => {
    for (const body of [
      {},
      { email: "invalid", code: "123456" },
      { email: emailAddress(), code: "12345678" },
      { email: emailAddress(), code: 123456 },
      { email: emailAddress(), code: "123456", customerId: "spoofed" },
    ]) {
      await request(app.getHttpServer())
        .post(`${base}/verify-email`)
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post(`${base}/resend-verification`)
      .send({ email: "invalid" })
      .expect(400);
  });

  describe("Password management", () => {
    const newPassword = "new-password-for-mobile-app";
    const body = {
      currentPassword: password,
      newPassword,
      confirmNewPassword: newPassword,
    };
    const activeLogin = async () => {
      const user = await register();
      await verify(user.email, user.code).expect(200);
      const response = await login(user.email).expect(200);
      return { ...user, token: response.body.data.accessToken as string };
    };
    const change = (token: string, data: object = body) =>
      request(app.getHttpServer())
        .post(`${base}/change-password`)
        .set("Authorization", `Bearer ${token}`)
        .send(data);
    const me = (token: string) =>
      request(app.getHttpServer())
        .get(`${base}/me`)
        .set("Authorization", `Bearer ${token}`);

    it("requires an existing valid bearer session", async () => {
      await request(app.getHttpServer())
        .post(`${base}/change-password`)
        .send(body)
        .expect(401);
      await change("a".repeat(64)).expect(401);
    });

    it("changes the hash, revokes all owner sessions, and leaves other accounts intact", async () => {
      const owner = await activeLogin();
      const other = await activeLogin();
      const previousHash = (await account(owner.email)).passwordHash;
      const second = await login(owner.email).expect(200);
      const result = await change(owner.token).expect(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.body.data).toEqual({
        passwordChanged: true,
        requiresLogin: true,
      });
      expect(JSON.stringify(result.body)).not.toContain(newPassword);
      const updated = await account(owner.email);
      expect(updated.passwordHash).not.toBe(previousHash);
      expect(updated.passwordHash).not.toContain(newPassword);
      expect(
        await prisma.authSession.count({ where: { accountId: updated.id } }),
      ).toBe(0);
      await me(owner.token).expect(401);
      await me(second.body.data.accessToken).expect(401);
      await me(other.token).expect(200);
      await login(owner.email).expect(401);
      await login(owner.email, newPassword).expect(200);
      await change(owner.token).expect(401);
    });

    it.each([
      [
        "incorrect current password",
        { ...body, currentPassword: "incorrect-password" },
        "CURRENT_PASSWORD_INCORRECT",
      ],
      [
        "mismatched confirmation",
        { ...body, confirmNewPassword: "different-password" },
        "PASSWORD_CONFIRMATION_MISMATCH",
      ],
      [
        "unchanged password",
        {
          currentPassword: password,
          newPassword: password,
          confirmNewPassword: password,
        },
        "PASSWORD_UNCHANGED",
      ],
    ])(
      "rejects %s without changing the account or sessions",
      async (_label, data, code) => {
        const owner = await activeLogin();
        const hash = (await account(owner.email)).passwordHash;
        const result = await change(owner.token, data).expect(400);
        expect(result.body.error.code).toBe(code);
        expect((await account(owner.email)).passwordHash).toBe(hash);
        await me(owner.token).expect(200);
        await login(owner.email).expect(200);
      },
    );

    it.each([
      { ...body, newPassword: "short", confirmNewPassword: "short" },
      { ...body, currentPassword: null },
      { ...body, confirmNewPassword: undefined },
      { ...body, newPassword: "x".repeat(129) },
      { ...body, customerId: "another-customer" },
      { ...body, accountId: "another-account" },
    ])(
      "validates the request and rejects injected account identifiers %#",
      async (data) => {
        const owner = await activeLogin();
        await change(owner.token, data).expect(400);
        await me(owner.token).expect(200);
      },
    );

    it("rejects Google-only accounts without introducing a new password", async () => {
      const owner = await activeLogin();
      await prisma.authAccount.update({
        where: { email: owner.email },
        data: { passwordHash: null, googleSub: `google-${randomUUID()}` },
      });
      const result = await change(owner.token).expect(400);
      expect(result.body.error.code).toBe("PASSWORD_NOT_SET");
      expect((await account(owner.email)).passwordHash).toBeNull();
    });

    it("allows one simultaneous password change and rejects the stale session", async () => {
      const owner = await activeLogin();
      const responses = await Promise.all([
        change(owner.token),
        change(owner.token, {
          ...body,
          newPassword: "another-new-password",
          confirmNewPassword: "another-new-password",
        }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
      const winner =
        responses[0].status === 200 ? newPassword : "another-new-password";
      await login(owner.email, winner).expect(200);
    });

    it("never leaves a valid old-password session after a simultaneous sign-in and change", async () => {
      const owner = await activeLogin();
      const [changed, signedIn] = await Promise.all([
        change(owner.token),
        login(owner.email),
      ]);
      expect(changed.status).toBe(200);
      expect([200, 401]).toContain(signedIn.status);
      if (signedIn.status === 200)
        await me(signedIn.body.data.accessToken).expect(401);
      await login(owner.email, newPassword).expect(200);
    });
  });
});
