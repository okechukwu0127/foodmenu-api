import { INestApplication } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import * as request from "supertest";
import { BetaPlatform, BetaTesterStatus } from "@prisma/client";
import {
  ApiResponseInterceptor,
  createValidationPipe,
  HttpExceptionFilter,
} from "@app/common";
import { BetaSignupDto } from "@app/dto";
import { BetaTestersController } from "../apps/api-gateway/src/auth/beta-testers.controller";
import { IdentityClientService } from "../apps/api-gateway/src/auth/identity-client.service";
import { BetaTestersService } from "../apps/identity-service/src/beta/beta-testers.service";

// No database or network needed: the gateway route runs with a fake identity client,
// and the identity service runs against an in-memory Prisma stub.
describe("Beta testers", () => {
  describe("POST /api/v1/beta-testers (gateway)", () => {
    let app: INestApplication;
    const identity = {
      betaSignup: jest.fn(async (dto: BetaSignupDto) => ({
        registered: true,
        platform: dto.platform,
        message: "ok",
      })),
    };

    // A fresh app per test so the per-IP rate limit starts from zero each time.
    beforeEach(async () => {
      identity.betaSignup.mockClear();
      const module = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60_000 }])],
        controllers: [BetaTestersController],
        providers: [
          { provide: IdentityClientService, useValue: identity },
          { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
        ],
      }).compile();
      app = module.createNestApplication();
      app.setGlobalPrefix("api/v1");
      app.useGlobalPipes(createValidationPipe());
      app.useGlobalFilters(new HttpExceptionFilter());
      await app.init();
    });
    afterEach(() => app.close());

    it("accepts a valid sign-up and normalises the email", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/beta-testers")
        .send({
          email: "  Jane@iCloud.com ",
          platform: "iOS",
          consent: true,
          source: "liberq-website",
        })
        .expect(200);
      expect(res.body.data).toMatchObject({
        registered: true,
        platform: "ios",
      });
      expect(identity.betaSignup).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "jane@icloud.com",
          platform: "ios",
          consent: true,
        }),
      );
    });

    it.each([
      ["invalid email", { email: "nope", platform: "ios", consent: true }],
      [
        "unknown platform",
        { email: "a@b.co", platform: "windows", consent: true },
      ],
      ["missing consent", { email: "a@b.co", platform: "android" }],
      [
        "consent refused",
        { email: "a@b.co", platform: "android", consent: false },
      ],
      [
        "unexpected field",
        { email: "a@b.co", platform: "android", consent: true, type: "beta" },
      ],
    ])("rejects %s with 400", async (_label, body) => {
      await request(app.getHttpServer())
        .post("/api/v1/beta-testers")
        .send(body)
        .expect(400);
      expect(identity.betaSignup).not.toHaveBeenCalled();
    });

    it("rate-limits to 5 sign-ups per minute per IP", async () => {
      const body = { email: "a@b.co", platform: "ios", consent: true };
      for (let i = 0; i < 5; i++)
        await request(app.getHttpServer())
          .post("/api/v1/beta-testers")
          .send(body)
          .expect(200);
      await request(app.getHttpServer())
        .post("/api/v1/beta-testers")
        .send(body)
        .expect(429);
    });
  });

  describe("BetaTestersService (identity)", () => {
    const rows = new Map<
      string,
      { status: BetaTesterStatus; requestCount: number }
    >();
    const key = (w: {
      email_platform: { email: string; platform: BetaPlatform };
    }) => `${w.email_platform.email}|${w.email_platform.platform}`;
    const prisma = {
      betaTester: {
        findUnique: jest.fn(async ({ where }) => rows.get(key(where)) ?? null),
        upsert: jest.fn(async ({ where, create, update }) => {
          const k = key(where);
          const row = rows.get(k);
          if (!row)
            rows.set(k, {
              status: BetaTesterStatus.REQUESTED,
              requestCount: 1,
              ...create,
            });
          else
            rows.set(k, {
              ...row,
              requestCount: row.requestCount + 1,
              ...(update.status ? { status: update.status } : {}),
            });
          return rows.get(k);
        }),
      },
    };
    const notifier = { send: jest.fn(async () => true) };
    const service = new BetaTestersService(prisma as never, notifier as never);
    const flush = () => new Promise((r) => setImmediate(r));
    const dto = (over: Partial<BetaSignupDto> = {}): BetaSignupDto =>
      Object.assign(new BetaSignupDto(), {
        email: "sam@gmail.com",
        platform: "android",
        consent: true,
        ...over,
      });

    beforeEach(() => {
      rows.clear();
      jest.clearAllMocks();
    });

    it("stores a new tester and is idempotent on repeat", async () => {
      const first = await service.signup(dto());
      const second = await service.signup(dto());
      expect(first).toEqual(second);
      expect(first.message).toContain("Google Play");
      expect(rows.size).toBe(1);
      expect(rows.get("sam@gmail.com|ANDROID")?.requestCount).toBe(2);
    });

    it("keeps iOS and Android sign-ups separate", async () => {
      await service.signup(dto({ platform: "ios" }));
      await service.signup(dto({ platform: "android" }));
      expect(rows.size).toBe(2);
    });

    it("re-activates an unsubscribed tester who signs up again", async () => {
      rows.set("sam@gmail.com|ANDROID", {
        status: BetaTesterStatus.UNSUBSCRIBED,
        requestCount: 1,
      });
      await service.signup(dto());
      expect(rows.get("sam@gmail.com|ANDROID")?.status).toBe(
        BetaTesterStatus.REQUESTED,
      );
    });

    it("silently drops bot submissions that fill the honeypot", async () => {
      const res = await service.signup(dto({ company: "Spam Ltd" }));
      expect(res.registered).toBe(true);
      expect(prisma.betaTester.upsert).not.toHaveBeenCalled();
      await flush();
      expect(notifier.send).not.toHaveBeenCalled();
    });

    it("emails the team inbox about a new sign-up, replying to the tester", async () => {
      await service.signup(dto({ platform: "ios", email: "jo@icloud.com" }));
      await flush();
      expect(notifier.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "New beta tester — iPhone (TestFlight)",
          replyTo: "jo@icloud.com",
          fields: expect.arrayContaining([["Email", "jo@icloud.com"], ["Requests so far", "1"]]),
        }),
      );
    });

    it("labels a repeat request in the email", async () => {
      await service.signup(dto());
      await service.signup(dto());
      await flush();
      expect(notifier.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ subject: expect.stringContaining("Repeat beta request") }),
      );
    });

    it("still succeeds when the email cannot be sent", async () => {
      notifier.send.mockRejectedValueOnce(new Error("smtp down"));
      await expect(service.signup(dto())).resolves.toMatchObject({ registered: true });
      await flush();
      expect(rows.size).toBe(1);
    });
  });
});
