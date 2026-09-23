import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { of } from "rxjs";
import { AppModule } from "../apps/api-gateway/src/app.module";

describe("Stripe payment intent (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://foodmenu:foodmenu@localhost:5432/foodmenu_api?schema=public";
    process.env.STRIPE_SECRET_KEY =
      process.env.STRIPE_SECRET_KEY ?? "sk_test_123";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider("PAYMENT_SERVICE")
      .useValue({
        send: jest.fn().mockReturnValue(
          of({
            clientSecret: "pi_secret",
            paymentIntentId: "pi_123",
            status: "requires_payment_method",
          }),
        ),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/v1/payments/stripe/payment-intent", () => {
    return request(app.getHttpServer())
      .post("/api/v1/payments/stripe/payment-intent")
      .send({ amount: 2500, currency: "gbp" })
      .expect(201)
      .expect({
        clientSecret: "pi_secret",
        paymentIntentId: "pi_123",
        status: "requires_payment_method",
      });
  });
});
