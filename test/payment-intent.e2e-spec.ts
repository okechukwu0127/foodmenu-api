import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { of } from "rxjs";
import { AppModule } from "../apps/api-gateway/src/app.module";

import { PrismaService } from "@app/database";
import { IdentityClientService } from "../apps/api-gateway/src/auth/identity-client.service";
import { createValidationPipe } from "@app/common";

describe("Stripe payment intent (e2e)", () => {
  let app: INestApplication;
  const send = jest.fn().mockReturnValue(
    of({
      clientSecret: "pi_secret",
      paymentIntentId: "pi_123",
      status: "requires_payment_method",
    }),
  );

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://foodmenu:foodmenu@localhost:5432/foodmenu_api?schema=public";
    process.env.STRIPE_SECRET_KEY =
      process.env.STRIPE_SECRET_KEY ?? "sk_test_123";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        order: { findFirst: jest.fn().mockResolvedValue(null) },
        paymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
        customerPaymentMethod: { findFirst: jest.fn().mockResolvedValue(null) },
      })
      .overrideProvider(IdentityClientService)
      .useValue({
        authenticate: jest.fn().mockImplementation(async (token: string) => {
          if (token !== "a".repeat(64)) {
            const { UnauthorizedException } = await import("@nestjs/common");
            throw new UnauthorizedException();
          }
          return {
            customerId: "customer-1",
            user: {
              email: "john@example.com",
              name: "John Doe",
              phone: "+447700900123",
            },
          };
        }),
      })
      .overrideProvider("PAYMENT_SERVICE")
      .useValue({ send })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/v1/payments/stripe/payment-intent", () => {
    return request(app.getHttpServer())
      .post("/api/v1/payments/stripe/payment-intent")
      .set("Authorization", `Bearer ${"a".repeat(64)}`)
      .send({
        quoteId: "16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7",
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          data: {
            clientSecret: "pi_secret",
            paymentIntentId: "pi_123",
            status: "requires_payment_method",
          },
          message: "Request successful",
          path: "/api/v1/payments/stripe/payment-intent",
          status: "success",
          statusCode: 201,
          success: true,
          timestamp: expect.any(String),
        });
      });
  });
  it("uses the authenticated customer for checkout", () => {
    expect(send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        customerId: "customer-1",
        quoteId: "16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7",
      }),
    );
  });

  it("rejects client pricing and ownership fields", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/payments/stripe/payment-intent")
      .set("Authorization", `Bearer ${"a".repeat(64)}`)
      .send({
        quoteId: "16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7",
        amount: 1,
        customerId: "victim",
      })
      .expect(400);
  });

  it.each([
    ["post", "/payments/stripe/payment-intent"],
    ["post", "/payments/stripe/setup-intent"],
    ["get", "/payments/stripe/payment-methods"],
    ["post", "/payments/stripe/payment-methods"],
    ["patch", "/payments/stripe/payment-methods/pm_other"],
    ["delete", "/payments/stripe/payment-methods/pm_other"],
    ["post", "/payments/stripe/confirm"],
    ["get", "/payments/stripe/status/pi_other"],
    ["post", "/payments/stripe/refund"],
    ["get", "/orders"],
    ["get", "/orders/order_other"],
    ["get", "/orders/order_other/tracking"],
    ["post", "/orders/order_other/fulfilment"],
    ["patch", "/orders/order_other/fulfilment/fulfilment_other"],
    ["get", "/orders/fulfilment/providers"],
  ])("requires login for %s %s", async (method, path) => {
    const client = request(app.getHttpServer()) as any;
    await client[method](`/api/v1${path}`).expect(401);
  });

  it("rejects expired or revoked tokens", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/payments/stripe/payment-intent")
      .set("Authorization", `Bearer ${"b".repeat(64)}`)
      .send({ amount: 2500 })
      .expect(401);
  });

  it("rejects another customer's payment", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/payments/stripe/status/pi_other")
      .set("Authorization", `Bearer ${"a".repeat(64)}`)
      .expect(404);
  });
});
