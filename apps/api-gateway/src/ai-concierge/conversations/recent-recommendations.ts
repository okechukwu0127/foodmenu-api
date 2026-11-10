import { recommendationCardSchema } from "../tools/cards.schema";

type MessageWithParts = {
  role: string;
  parts: unknown;
};

export function recentRecommendations(history: MessageWithParts[]) {
  for (const message of history) {
    if (message.role !== "assistant" || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const card = part as Record<string, unknown>;
      if (card.type !== "data-food-recommendations") continue;
      const result = recommendationCardSchema.safeParse(card.data);
      if (!result.success || !result.data.foods.length) continue;
      return {
        foods: result.data.foods.slice(0, 5).map((food) => ({
          id: food.id,
          name: food.name,
          description: food.description?.slice(0, 300) ?? null,
          price: food.price,
          available: food.available,
          dietaryInfo: food.dietaryInfo,
          informationStatus: food.informationStatus,
        })),
      };
    }
  }
  return null;
}
