require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const { z } = require("zod");
const { readFileSync } = require("node:fs");
const db = new PrismaClient();
const schema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    pickupEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    deliveryFee: z.number().int().nonnegative().max(100000),
    deliveryCountries: z.array(z.string().regex(/^[A-Z]{2}$/)),
    deliveryPostcodePrefixes: z.array(z.string().trim().min(1).max(20)),
    taxRateBps: z.number().int().min(0).max(10000),
  })
  .strict()
  .refine(
    (v) => !v.deliveryEnabled || v.deliveryCountries.length > 0,
    "Delivery requires at least one configured country",
  );
(async () => {
  const data = schema.parse(
    JSON.parse(
      readFileSync(process.argv[2] || "prisma/checkout-policy.json", "utf8"),
    ),
  );
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8740022)`;
    const old = await tx.checkoutPolicy.findUnique({
      where: { currency: data.currency },
    });
    const equal =
      old &&
      Object.entries(data).every(
        ([k, v]) => JSON.stringify(old[k]) === JSON.stringify(v),
      );
    if (!equal)
      await tx.checkoutPolicy.upsert({
        where: { currency: data.currency },
        create: data,
        update: { ...data, revision: { increment: 1 } },
      });
  });
  console.log("Checkout policy published");
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
