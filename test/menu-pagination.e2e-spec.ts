import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { of } from "rxjs";
import { createValidationPipe, MENU_PATTERNS } from "@app/common";
import { MenuController } from "../apps/api-gateway/src/menu/menu.controller";

describe("Paginated menu HTTP contracts", () => {
  let app: INestApplication;
  const client = { send: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MenuController],
      providers: [{ provide: "MENU_SERVICE", useValue: client }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });
  beforeEach(() => {
    client.send.mockReset();
    client.send.mockReturnValue(
      of({ items: [], nextCursor: null, hasNextPage: false, limit: 20 }),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    ["foods", MENU_PATTERNS.GET_FOODS],
    ["deals", MENU_PATTERNS.GET_DEALS],
    ["hot-combos", MENU_PATTERNS.GET_HOT_COMBOS],
  ])(
    "GET %s transforms and forwards filters and field controls",
    async (path, pattern) => {
      await request(app.getHttpServer())
        .get(`/api/v1/menu/${path}`)
        .query({
          id: "exact-id",
          foodId: "food-id",
          search: "burger",
          categoryId: "burgers",
          isPopular: "false",
          page: "2",
          limit: "10",
          hideFulfillmentOptions: "true",
          hideModifierGroups: "true",
          hideSideOptions: "false",
          hideSizeOptions: "true",
          hideAppetizerOptions: "true",
          hideImages: "true",
        })
        .expect(200);
      expect(client.send).toHaveBeenCalledWith(
        pattern,
        expect.objectContaining({
          id: "exact-id",
          foodId: "food-id",
          search: "burger",
          categoryId: "burgers",
          isPopular: false,
          page: 2,
          limit: 10,
          hideFulfillmentOptions: true,
          hideModifierGroups: true,
          hideSideOptions: false,
          hideSizeOptions: true,
          hideAppetizerOptions: true,
          hideImages: true,
        }),
      );
    },
  );

  it.each(["foods", "deals", "hot-combos"])(
    "GET %s accepts cursors and defaults pagination",
    async (path) => {
      await request(app.getHttpServer())
        .get(`/api/v1/menu/${path}?cursor=previous-item`)
        .expect(200);
      expect(client.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cursor: "previous-item",
          limit: 20,
          page: 1,
        }),
      );
    },
  );

  it.each(["foods", "deals", "hot-combos"])(
    "GET %s rejects invalid page limits and boolean flags",
    async (path) => {
      for (const query of [
        "limit=51",
        "limit=0",
        "page=0",
        "page=1.5",
        "hideModifierGroups=maybe",
        "hideSizeOptions=1",
        "isPopular=maybe",
      ]) {
        await request(app.getHttpServer())
          .get(`/api/v1/menu/${path}?${query}`)
          .expect(400);
      }
      expect(client.send).not.toHaveBeenCalled();
    },
  );
});
