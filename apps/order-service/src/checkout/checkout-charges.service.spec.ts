import { PrismaService } from "@app/database";
import { CheckoutChargesService } from "./checkout-charges.service";

describe("Checkout charges", () => {
  const findUnique = jest.fn();
  const service = new CheckoutChargesService({
    checkoutPolicy: { findUnique },
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("allows all postcodes in a configured country when no prefix restriction is set", async () => {
    findUnique.mockResolvedValue({
      currency: "GBP",
      deliveryEnabled: true,
      deliveryFee: 500,
      deliveryCountries: ["GB"],
      deliveryPostcodePrefixes: [],
      pickupEnabled: true,
      revision: 1,
      taxRateBps: 0,
    });

    await expect(
      service.quote({
        subtotal: 1200,
        currency: "GBP",
        checkout: {
          fulfilment: "delivery",
          deliveryAddress: {
            line1: "1 Main Street",
            city: "London",
            postcode: "AB12 3CD",
            country: "GB",
            latitude: 51.5072,
            longitude: -0.1276,
          },
        },
      }),
    ).resolves.toMatchObject({
      amount: 1700,
      deliveryFee: 500,
      currency: "GBP",
    });
  });

  it("still rejects countries outside the configured delivery area", async () => {
    findUnique.mockResolvedValue({
      currency: "GBP",
      deliveryEnabled: true,
      deliveryFee: 500,
      deliveryCountries: ["GB"],
      deliveryPostcodePrefixes: [],
      pickupEnabled: true,
      revision: 1,
      taxRateBps: 0,
    });

    await expect(
      service.quote({
        subtotal: 1200,
        currency: "GBP",
        checkout: {
          fulfilment: "delivery",
          deliveryAddress: {
            line1: "1 Main Street",
            city: "Paris",
            postcode: "75001",
            country: "FR",
            latitude: 48.8566,
            longitude: 2.3522,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_UNAVAILABLE", statusCode: 409 });
  });

  it("accepts a configured pickup location without adding delivery charges", async () => {
    findUnique.mockResolvedValue({
      currency: "GBP",
      deliveryEnabled: true,
      deliveryFee: 500,
      deliveryCountries: ["GB"],
      deliveryPostcodePrefixes: [],
      pickupEnabled: true,
      revision: 1,
      taxRateBps: 0,
    });

    await expect(
      service.quote({
        subtotal: 1200,
        currency: "GBP",
        checkout: {
          fulfilment: "pickup",
          pickupLocation: {
            name: "Configured Restaurant",
            address: "10 Store Road",
            latitude: 51.5,
            longitude: -0.1,
          },
        },
      }),
    ).resolves.toMatchObject({
      amount: 1200,
      deliveryFee: 0,
      currency: "GBP",
    });
  });
});
