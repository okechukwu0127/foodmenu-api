import { PrismaClient } from "@prisma/client";
import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
export const appConfigSeedSchema = z
  .object({
    appName: text(120),
    shortName: text(80).nullable().default(null),
    defaultRestaurant: z
      .object({
        id: z.string().uuid(),
        restaurantName: text(160),
        address: z
          .object({
            formatted: text(500),
            line1: text(200),
            line2: text(200).nullable().default(null),
            city: text(100),
            postcode: text(30),
            countryCode: z.string().regex(/^[A-Z]{2}$/),
            latitude: z.number().finite().min(-90).max(90),
            longitude: z.number().finite().min(-180).max(180),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export async function seedAppConfiguration(
  db: PrismaClient,
  input: unknown,
  overwrite = false,
) {
  const data = appConfigSeedSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8740023)`;
    const existing = await tx.appConfiguration.findUnique({
      where: { id: "default" },
    });
    // Normal catalogue seeding must not reset an operator's live app settings.
    if (existing && !overwrite) return;
    const restaurant = data.defaultRestaurant;
    const address = restaurant.address;
    const fields = {
      restaurantName: restaurant.restaurantName,
      isActive: true,
      addressFormatted: address.formatted,
      addressLine1: address.line1,
      addressLine2: address.line2,
      city: address.city,
      postcode: address.postcode,
      countryCode: address.countryCode,
      latitude: address.latitude,
      longitude: address.longitude,
    };
    const oldRestaurant = await tx.restaurant.findUnique({
      where: { id: restaurant.id },
    });
    if (!oldRestaurant)
      await tx.restaurant.create({ data: { id: restaurant.id, ...fields } });
    else if (
      Object.entries(fields).some(([key, value]) => {
        const previous = oldRestaurant[key as keyof typeof oldRestaurant];
        // PostgreSQL/Prisma float serialization can differ by one ULP.
        return typeof previous === "number" && typeof value === "number"
          ? Math.abs(previous - value) > 1e-12
          : previous !== value;
      })
    )
      await tx.restaurant.update({
        where: { id: restaurant.id },
        data: fields,
      });
    const settings = {
      appName: data.appName,
      shortName: data.shortName,
      defaultRestaurantId: restaurant.id,
    };
    if (!existing)
      await tx.appConfiguration.create({
        data: { id: "default", ...settings },
      });
    else if (
      Object.entries(settings).some(
        ([key, value]) => existing[key as keyof typeof existing] !== value,
      )
    )
      await tx.appConfiguration.update({
        where: { id: "default" },
        data: settings,
      });
  });
}
