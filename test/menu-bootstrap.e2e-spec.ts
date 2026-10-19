import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { of } from "rxjs";
import { AppModule } from "../apps/api-gateway/src/app.module";

describe("Menu bootstrap (e2e)", () => {
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
      .useValue({ send: jest.fn() })
      .overrideProvider("MENU_SERVICE")
      .useValue({
        send: jest.fn().mockReturnValue(
          of({
            categories: [],
            deals: [],
            defaultModifierGroupIds: [],
            drinkAddOns: [],
            foodItems: [],
            heroSlides: [],
            hotCombos: [],
            modifierGroups: [],
            modifierLabelTranslations: [],
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

  it("GET /api/v1/menu/bootstrap", () => {
    return request(app.getHttpServer())
      .get("/api/v1/menu/bootstrap")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          data: {
            categories: [],
            deals: [],
            defaultModifierGroupIds: [],
            drinkAddOns: [],
            foodItems: [],
            heroSlides: [],
            hotCombos: [],
            modifierGroups: [],
            modifierLabelTranslations: [],
          },
          message: "Request successful",
          path: "/api/v1/menu/bootstrap",
          status: "success",
          statusCode: 200,
          success: true,
          timestamp: expect.any(String),
        });
      });
  });
});
