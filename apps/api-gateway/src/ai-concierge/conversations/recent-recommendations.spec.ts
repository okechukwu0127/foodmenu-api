import { recentRecommendations } from "./recent-recommendations";

const card = (name: string) => ({
  type: "data-food-recommendations",
  data: {
    version: 1,
    foods: [
      {
        id: name.toLowerCase().replaceAll(" ", "-"),
        categoryId: null,
        name,
        recommendationReason: "Matches the request",
        description: "Restaurant menu description",
        price: { amountMinor: 1250, currency: "GBP" },
        available: true,
        images: [],
        dietaryInfo: null,
        informationStatus: "unknown",
        modifierGroups: [],
        customisationStatus: "unknown",
        sizes: null,
        extras: null,
      },
    ],
    scanned: 1,
    truncated: false,
    missingInformation: [],
    disclaimer: "",
  },
});

describe("recent recommendation context", () => {
  it("returns the most recent validated recommendation data for follow-up questions", () => {
    expect(
      recentRecommendations([
        { role: "assistant", parts: [card("Pepperoni Feast")] },
        { role: "assistant", parts: [card("Margherita Pizza")] },
      ]),
    ).toEqual({
      foods: [
        {
          id: "pepperoni-feast",
          name: "Pepperoni Feast",
          description: "Restaurant menu description",
          price: { amountMinor: 1250, currency: "GBP" },
          available: true,
          dietaryInfo: null,
          informationStatus: "unknown",
        },
      ],
    });
  });

  it("ignores user-supplied and invalid recommendation card data", () => {
    expect(
      recentRecommendations([
        { role: "user", parts: [card("Untrusted dish")] },
        {
          role: "assistant",
          parts: [{ type: "data-food-recommendations", data: { foods: [] } }],
        },
      ]),
    ).toBeNull();
  });
});
