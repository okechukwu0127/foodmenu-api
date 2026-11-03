// Restore missing presentation images only; never change order prices or status.
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
async function main() {
  const args = process.argv.slice(2);
  if (
    args.length &&
    (args.length !== 2 || args[0] !== "--order-id" || !args[1])
  )
    throw new Error(
      "Usage: node scripts/backfill-order-images.cjs [--order-id ORDER_ID]",
    );
  const orderId = args[1];
  let cursor,
    updated = 0,
    checked = 0;
  while (true) {
    const items = await db.orderItem.findMany({
      where: {
        ...(orderId ? { orderId } : {}),
        OR: [{ imageUrl: null }, { imageUrl: "" }],
        foodItemId: { not: null },
      },
      select: { id: true, foodItemId: true, itemSnapshot: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!items.length) break;
    const foods = await db.foodItem.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.foodItemId))] } },
      select: {
        id: true,
        images: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          take: 1,
          select: { url: true },
        },
      },
    });
    const images = new Map(foods.map((food) => [food.id, food.images[0]?.url]));
    for (const item of items) {
      const snapshot = item.itemSnapshot;
      const imageUrl =
        typeof snapshot?.imageUrl === "string" && snapshot.imageUrl.trim()
          ? snapshot.imageUrl
          : images.get(item.foodItemId);
      checked++;
      if (!imageUrl) continue;
      const result = await db.orderItem.updateMany({
        where: { id: item.id, OR: [{ imageUrl: null }, { imageUrl: "" }] },
        data: { imageUrl },
      });
      updated += result.count;
    }
    cursor = items[items.length - 1].id;
  }
  console.log(JSON.stringify({ checked, updated }));
}
main()
  .catch((error) => {
    console.error(error.code || error.message || "Order image backfill failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
