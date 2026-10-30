import { checkoutInputSchema } from "./contracts";

describe("checkoutInputSchema", () => {
  const address = {
    line1: "12 Example Road",
    city: "London",
    postcode: "SW1A 1AA",
    country: "GB",
  };

  it("requires a valid map location for delivery", () => {
    expect(
      checkoutInputSchema.safeParse({
        fulfilment: "delivery",
        deliveryAddress: address,
      }).success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse({
        fulfilment: "delivery",
        deliveryAddress: { ...address, latitude: 91, longitude: -0.1276 },
      }).success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse({
        fulfilment: "delivery",
        deliveryAddress: { ...address, latitude: 51.5072, longitude: -0.1276 },
      }).success,
    ).toBe(true);
  });

  it("does not require a delivery address for pickup", () => {
    expect(
      checkoutInputSchema.safeParse({
        fulfilment: "pickup",
        pickupLocation: {
          name: "Configured Restaurant",
          address: "10 Store Road",
          latitude: 51.5,
          longitude: -0.1,
        },
      }).success,
    ).toBe(true);
  });
});
