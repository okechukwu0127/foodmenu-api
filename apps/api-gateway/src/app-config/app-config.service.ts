import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "@app/database";
import { AppError } from "@app/errors";

@Injectable()
export class AppConfigService {
  constructor(private readonly db: PrismaService) {}

  async getPublicConfig() {
    const config = await this.db.appConfiguration.findUnique({
      where: { id: "default" },
      select: {
        appName: true,
        shortName: true,
        updatedAt: true,
        defaultRestaurant: {
          select: {
            id: true,
            restaurantName: true,
            isActive: true,
            addressFormatted: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            postcode: true,
            countryCode: true,
            latitude: true,
            longitude: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!config || !config.defaultRestaurant.isActive)
      throw new AppError(
        "APP_CONFIG_UNAVAILABLE",
        "Application configuration is unavailable",
        503,
      );
    const restaurant = config.defaultRestaurant;
    const data = {
      version: 1 as const,
      branding: {
        appName: config.appName,
        shortName: config.shortName ?? config.appName,
      },
      defaultRestaurant: {
        id: restaurant.id,
        restaurantName: restaurant.restaurantName,
        address: {
          formatted: restaurant.addressFormatted,
          line1: restaurant.addressLine1,
          line2: restaurant.addressLine2,
          city: restaurant.city,
          postcode: restaurant.postcode,
          countryCode: restaurant.countryCode,
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
        },
      },
      updatedAt: new Date(
        Math.max(config.updatedAt.getTime(), restaurant.updatedAt.getTime()),
      ).toISOString(),
    };
    const etag = `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
    return { data, etag };
  }
}
