import {
  INestApplication,
  INestMicroservice,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import * as request from "supertest";
import { PrismaService } from "@app/database";
import { createValidationPipe, ApiResponseInterceptor } from "@app/common";
import { AuthModule } from "../apps/api-gateway/src/auth/auth.module";
import { GoogleTokenVerifier } from "../apps/identity-service/src/auth/auth.service";
import { IdentityServiceModule } from "../apps/identity-service/src/identity-service.module";
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from "@nestjs/microservices";
import { Server, AddressInfo } from "net";
import { VerificationMailService } from "../apps/identity-service/src/email/verification-mail.service";
import { Prisma } from "@prisma/client";
import { firstValueFrom } from "rxjs";
import { IDENTITY_PATTERNS, HttpExceptionFilter } from "@app/common";

// Keep the real HTTP validation, guards, password hashing and session lifecycle.
// Gateway and identity communicate over real TCP; only database/Google are replaced.
describe("Mobile authentication (e2e)", () => {
  let app: INestApplication;
  let identity: INestMicroservice;
  let identityClient: ClientProxy;
  let account: any;
  let verification: any;
  let sentCode: string;
  const mail = {
    assertConfigured: jest.fn(),
    sendVerification: jest.fn(async (_email: string, code: string) => {
      sentCode = code;
    }),
  };
  const sessions = new Map<string, any>();
  const google = { verify: jest.fn() };
  const prisma: any = {
    $transaction: async (action: (tx: any) => Promise<unknown>) =>
      action(prisma),
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) =>
      account
        ? [
            sql.join("").includes('FROM "Customer"')
              ? account.customer
              : account,
          ]
        : [],
    ),
    emailVerification: {
      findUnique: jest.fn(async () => verification),
      upsert: jest.fn(async ({ create }: any) => {
        verification = create;
        return verification;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (verification?.requestId !== where.requestId) return { count: 0 };
        Object.assign(verification, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        verification.attempts += data.attempts.increment;
        return verification;
      }),
      delete: jest.fn(async () => {
        verification = undefined;
      }),
    },
    authAccount: {
      update: jest.fn(async ({ data }: any) => {
        Object.assign(account, data);
        return account;
      }),
      create: jest.fn(async ({ data }: any) => {
        if (account?.email === data.email)
          throw new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "test",
          });
        account = {
          emailVerifiedAt: null,
          ...data,
          id: "account-1",
          customerId: data.customer.create.id,
          customer: data.customer.create,
        };
        return account;
      }),
      findUniqueOrThrow: jest.fn(async () => account),
      findUnique: jest.fn(async ({ where }: any) =>
        account &&
        ((where.email !== undefined && where.email === account.email) ||
          (where.googleSub !== undefined &&
            where.googleSub === account.googleSub))
          ? account
          : null,
      ),
    },
    customer: {
      update: jest.fn(async ({ data }: any) => ({
        ...account.customer,
        ...data,
      })),
    },
    authSession: {
      create: jest.fn(async ({ data }: any) => {
        sessions.set(data.tokenHash, { ...data, id: data.tokenHash, account });
      }),
      findUnique: jest.fn(
        async ({ where }: any) => sessions.get(where.tokenHash) ?? null,
      ),
      deleteMany: jest.fn(async ({ where }: any) => {
        if (where.accountId) sessions.clear();
        else sessions.delete(where.id);
      }),
    },
  };

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgresql://foodmenu:foodmenu@localhost:5432/foodmenu_api?schema=public";
    process.env.STRIPE_SECRET_KEY ??= "sk_test_123";
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
      .overrideProvider(GoogleTokenVerifier)
      .useValue(google)
      .compile();
    identity = identityModule.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: "127.0.0.1", port: 0 },
      logger: false,
    });
    await identity.listen();
    const port = (identity.unwrap<Server>().address() as AddressInfo).port;
    identityClient = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: "127.0.0.1", port },
    });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ThrottlerModule.forRoot([{ limit: 20, ttl: 60000 }]),
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider("IDENTITY_SERVICE")
      .useValue(identityClient)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    identityClient?.close();
    await identity?.close();
  });
  beforeEach(() => {
    account = undefined;
    verification = undefined;
    sessions.clear();
    jest.clearAllMocks();
  });

  async function activatedSignup(dto: object) {
    await request(app.getHttpServer())
      .post("/api/v1/auth/signup")
      .send(dto)
      .expect(201);
    const email = (dto as { email: string }).email.trim().toLowerCase();
    await request(app.getHttpServer())
      .post("/api/v1/auth/verify-email")
      .send({ email, code: sentCode })
      .expect(200);
    return request(app.getHttpServer())
      .post("/api/v1/auth/signin")
      .send({ email, password: (dto as { password: string }).password })
      .expect(200);
  }

  it("registers, normalizes email, signs in, reads the user and revokes logout tokens", async () => {
    const signup = await activatedSignup({
      name: "John Doe",
      email: "JOHN@example.com ",
      phone: "+447700900123",
      password: "a-strong-password",
    });
    expect(signup.body.data.user.email).toBe("john@example.com");
    expect(signup.headers["cache-control"]).toBe("no-store");
    const signin = await request(app.getHttpServer())
      .post("/api/v1/auth/signin")
      .send({ email: "john@example.com", password: "a-strong-password" })
      .expect(200);
    const token = signin.body.data.accessToken;
    await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    // Logging out one session does not revoke another device/session.
    await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${signup.body.data.accessToken}`)
      .expect(200);
  });

  it("rejects invalid registration fields before saving anything", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/signup")
      .send({
        name: " ",
        email: "bad-email",
        phone: "07700900123",
        password: "short",
      })
      .expect(400);
    expect(prisma.authAccount.create).not.toHaveBeenCalled();
  });

  it("registers and returns the same account on Google sign-in", async () => {
    google.verify.mockResolvedValue({
      sub: "google-1",
      email: "john@example.com",
      name: "John Doe",
    });
    const signup = await request(app.getHttpServer())
      .post("/api/v1/auth/google")
      .send({ idToken: "google-id-token" })
      .expect(200);
    const signin = await request(app.getHttpServer())
      .post("/api/v1/auth/google")
      .send({ idToken: "google-id-token" })
      .expect(200);
    expect(signin.body.data.user.id).toBe(signup.body.data.user.id);
    expect(prisma.authAccount.create).toHaveBeenCalledTimes(1);
    expect(signin.body.data.user.providers).toEqual(["google"]);
  });

  it("requires a bearer token for account linking and current user", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/google/link")
      .send({ idToken: "google-id-token" })
      .expect(401);
    await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);
  });
  it("preserves signup conflicts and bad-password status codes across TCP", async () => {
    const dto = {
      name: "John Doe",
      email: "john@example.com",
      phone: "+447700900123",
      password: "a-strong-password",
    };
    await request(app.getHttpServer())
      .post("/api/v1/auth/signup")
      .send(dto)
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/auth/signup")
      .send(dto)
      .expect(409);
    await request(app.getHttpServer())
      .post("/api/v1/auth/signin")
      .send({ email: dto.email, password: "wrong-password" })
      .expect(401);
  });

  it("updates only the signed-in customer's profile and returns it on the existing me endpoint", async () => {
    const signup = await activatedSignup({
      name: "John Doe",
      email: "john@example.com",
      phone: "+447700900123",
      password: "a-strong-password",
    });
    const token = signup.body.data.accessToken;
    const profile = {
      name: "Jane Doe",
      phone: "+447700900999",
      photoUrl: "https://example.com/avatar.jpg",
    };
    const update = await request(app.getHttpServer())
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send(profile)
      .expect(200);
    expect(update.body.data).toMatchObject({
      ...profile,
      email: "john@example.com",
    });
    const me = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(me.body.data).toMatchObject(profile);
    await request(app.getHttpServer())
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "other@example.com" })
      .expect(400);
    await request(app.getHttpServer())
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: null })
      .expect(400);
  });

  it("validates payloads inside the identity service as well as the gateway", async () => {
    await expect(
      firstValueFrom(
        identityClient.send(IDENTITY_PATTERNS.SIGNUP, {
          name: " ",
          email: "invalid",
          phone: "bad",
          password: "short",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.authAccount.create).not.toHaveBeenCalled();
  });

  it("rejects invalid Google tokens and expired login sessions across TCP", async () => {
    google.verify.mockRejectedValue(
      new UnauthorizedException("Invalid or expired Google ID token"),
    );
    await request(app.getHttpServer())
      .post("/api/v1/auth/google")
      .send({ idToken: "invalid" })
      .expect(401);
    const signup = await activatedSignup({
      name: "John Doe",
      email: "john@example.com",
      phone: "+447700900123",
      password: "a-strong-password",
    });
    for (const session of sessions.values()) session.expiresAt = new Date(0);
    await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${signup.body.data.accessToken}`)
      .expect(401);
  });
  it("links Google through the existing endpoint without creating another customer", async () => {
    google.verify.mockResolvedValue({
      sub: "google-1",
      email: "john@example.com",
      name: "John Doe",
    });
    const signup = await activatedSignup({
      name: "John Doe",
      email: "john@example.com",
      phone: "+447700900123",
      password: "a-strong-password",
    });
    await request(app.getHttpServer())
      .post("/api/v1/auth/google")
      .send({ idToken: "google-id-token" })
      .expect(409);
    const link = await request(app.getHttpServer())
      .post("/api/v1/auth/google/link")
      .set("Authorization", `Bearer ${signup.body.data.accessToken}`)
      .send({ idToken: "google-id-token" })
      .expect(200);
    expect(link.body.data).toEqual({ linked: true });
    const googleSignin = await request(app.getHttpServer())
      .post("/api/v1/auth/google")
      .send({ idToken: "google-id-token" })
      .expect(200);
    expect(googleSignin.body.data.user.id).toBe(signup.body.data.user.id);
    expect(googleSignin.body.data.user.providers).toEqual([
      "password",
      "google",
    ]);
    expect(prisma.authAccount.create).toHaveBeenCalledTimes(1);
  });
});
