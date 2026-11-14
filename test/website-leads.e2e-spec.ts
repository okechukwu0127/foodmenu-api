import { INestApplication } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import * as request from "supertest";
import * as nodemailer from "nodemailer";
import { LeadKind } from "@prisma/client";
import { ApiResponseInterceptor, createValidationPipe, HttpExceptionFilter } from "@app/common";
import { WebsiteLeadDto } from "@app/dto";
import { DemoRequestsController } from "../apps/api-gateway/src/auth/demo-requests.controller";
import { IdentityClientService } from "../apps/api-gateway/src/auth/identity-client.service";
import { WebsiteLeadsService, normaliseUkPhone } from "../apps/identity-service/src/leads/website-leads.service";
import { LeadNotificationService } from "../apps/identity-service/src/email/lead-notification.service";

jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

const valid = {
  name: "Jane Smith",
  business: "Burger Hub",
  email: "Jane@BurgerHub.co.uk",
  phone: "07123 456 789",
  consent: true,
  source: "liberq-website",
};

// No database, network or SMTP server needed: everything external is stubbed.
describe("Website leads (Book a free demo / Become a partner)", () => {
  describe("POST /api/v1/demo-requests (gateway)", () => {
    let app: INestApplication;
    const identity = {
      demoRequest: jest.fn(async (dto: WebsiteLeadDto) => ({ received: true, kind: dto.kind ?? "demo", message: "ok" })),
    };
    beforeEach(async () => {
      identity.demoRequest.mockClear();
      const module = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60_000 }])],
        controllers: [DemoRequestsController],
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

    it("accepts a demo request and normalises the input", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/demo-requests")
        .send({ ...valid, name: "  Jane   Smith " })
        .expect(200);
      expect(res.body.data).toMatchObject({ received: true, kind: "demo" });
      expect(identity.demoRequest).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Jane Smith", email: "jane@burgerhub.co.uk", phone: "07123456789" }),
      );
    });

    it("accepts a partner application", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/demo-requests")
        .send({ ...valid, kind: "Partner", business: "Coventry", phone: "+44 (0)7123 456789".replace("(0)", "") })
        .expect(200);
      expect(identity.demoRequest).toHaveBeenCalledWith(expect.objectContaining({ kind: "partner", business: "Coventry" }));
    });

    it.each([
      ["missing name", { ...valid, name: undefined }],
      ["missing restaurant", { ...valid, business: "" }],
      ["invalid email", { ...valid, email: "nope" }],
      ["non-UK phone", { ...valid, phone: "+1 415 555 0100" }],
      ["short phone", { ...valid, phone: "0712" }],
      ["no consent", { ...valid, consent: false }],
      ["unknown kind", { ...valid, kind: "investor" }],
      ["unexpected field", { ...valid, notes: "hi" }],
    ])("rejects %s with 400", async (_label, body) => {
      await request(app.getHttpServer()).post("/api/v1/demo-requests").send(body).expect(400);
      expect(identity.demoRequest).not.toHaveBeenCalled();
    });

    it("rate-limits to 5 requests per minute per IP", async () => {
      for (let i = 0; i < 5; i++)
        await request(app.getHttpServer()).post("/api/v1/demo-requests").send(valid).expect(200);
      await request(app.getHttpServer()).post("/api/v1/demo-requests").send(valid).expect(429);
    });
  });

  describe("WebsiteLeadsService (identity)", () => {
    const created: any[] = [];
    const prisma = {
      websiteLead: {
        create: jest.fn(async ({ data }) => {
          const row = { id: `lead_${created.length + 1}`, createdAt: new Date("2026-11-14T15:30:00Z"), ...data };
          created.push(row);
          return row;
        }),
        update: jest.fn(async () => ({})),
      },
    };
    const notifier = { send: jest.fn(async () => true) };
    const service = new WebsiteLeadsService(prisma as never, notifier as never);
    const flush = () => new Promise((r) => setImmediate(r));
    const dto = (over: Partial<WebsiteLeadDto> = {}) =>
      Object.assign(new WebsiteLeadDto(), { ...valid, email: "jane@burgerhub.co.uk", phone: "07123456789", ...over });

    beforeEach(() => {
      created.length = 0;
      jest.clearAllMocks();
      notifier.send.mockResolvedValue(true);
    });

    it("saves a demo request, emails the team and stamps notifiedAt", async () => {
      const res = await service.create(dto());
      expect(res).toEqual({ received: true, kind: "demo", message: expect.stringContaining("one working day") });
      expect(created[0]).toMatchObject({ kind: LeadKind.DEMO, business: "Burger Hub", phone: "+447123456789" });
      await flush();
      expect(notifier.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "New demo request — Burger Hub",
          replyTo: "jane@burgerhub.co.uk",
          fields: expect.arrayContaining([["Restaurant", "Burger Hub"], ["Phone", "+447123456789"]]),
        }),
      );
      expect(prisma.websiteLead.update).toHaveBeenCalledWith({ where: { id: "lead_1" }, data: { notifiedAt: expect.any(Date) } });
    });

    it("saves a partner application with the area they cover", async () => {
      const res = await service.create(dto({ kind: "partner", business: "Coventry" }));
      expect(res.kind).toBe("partner");
      expect(created[0].kind).toBe(LeadKind.PARTNER);
      await flush();
      expect(notifier.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "New partner application — Jane Smith (Coventry)",
          fields: expect.arrayContaining([["Area they cover", "Coventry"]]),
        }),
      );
    });

    it("keeps the lead (no notifiedAt) when the email fails", async () => {
      notifier.send.mockResolvedValueOnce(false);
      await service.create(dto());
      await flush();
      expect(created).toHaveLength(1);
      expect(prisma.websiteLead.update).not.toHaveBeenCalled();
    });

    it("silently drops bot submissions that fill the honeypot", async () => {
      const res = await service.create(dto({ company: "Spam Ltd" }));
      expect(res.received).toBe(true);
      await flush();
      expect(prisma.websiteLead.create).not.toHaveBeenCalled();
      expect(notifier.send).not.toHaveBeenCalled();
    });

    it.each([
      ["07123456789", "+447123456789"],
      ["00447123456789", "+447123456789"],
      ["+447123456789", "+447123456789"],
      ["020 7946 0018", "+442079460018"],
    ])("normalises %s to %s", (input, out) => expect(normaliseUkPhone(input)).toBe(out));
  });

  describe("LeadNotificationService (email)", () => {
    const transport = { sendMail: jest.fn(), close: jest.fn() };
    const config = (over: Record<string, string> = {}) =>
      new ConfigService({
        SMTP_HOST: "smtp.example.com",
        SMTP_FROM: "no-reply@liberq.app",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
        LEADS_NOTIFY_EMAIL: "sales@liberq.app, ops@liberq.app, not-an-email",
        ...over,
      });
    beforeEach(() => {
      jest.resetAllMocks();
      jest.mocked(nodemailer.createTransport).mockReturnValue(transport as never);
      transport.sendMail.mockResolvedValue({ accepted: ["sales@liberq.app"], rejected: [] });
    });

    it("sends to every valid inbox in LEADS_NOTIFY_EMAIL with reply-to the visitor", async () => {
      const ok = await new LeadNotificationService(config()).send({
        subject: "New demo request — Burger Hub",
        heading: "New request",
        replyTo: "jane@burgerhub.co.uk",
        fields: [["Name", "Jane"]],
      });
      expect(ok).toBe(true);
      expect(transport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "no-reply@liberq.app",
          to: ["sales@liberq.app", "ops@liberq.app"],
          replyTo: "jane@burgerhub.co.uk",
          text: expect.stringContaining("Name: Jane"),
        }),
      );
      expect(transport.close).toHaveBeenCalled();
    });

    it("escapes HTML and strips line breaks from visitor input", async () => {
      await new LeadNotificationService(config()).send({
        subject: "New\r\nBcc: evil@x.com",
        heading: "x",
        fields: [["Restaurant", "<script>alert(1)</script>\nInjected"]],
      });
      const mail = transport.sendMail.mock.calls[0][0];
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.html).toContain("&lt;script&gt;");
      expect(mail.html).not.toContain("<script>");
      expect(mail.text).toContain("Restaurant: <script>alert(1)</script> Injected");
    });

    it("skips quietly when no inbox is configured", async () => {
      const ok = await new LeadNotificationService(config({ LEADS_NOTIFY_EMAIL: "" })).send({ subject: "s", heading: "h", fields: [] });
      expect(ok).toBe(false);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it("returns false instead of throwing when SMTP fails", async () => {
      transport.sendMail.mockRejectedValue(new Error("auth failed for user u / p"));
      await expect(new LeadNotificationService(config()).send({ subject: "s", heading: "h", fields: [] })).resolves.toBe(false);
      expect(transport.close).toHaveBeenCalled();
    });
  });
});
