import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "@app/database";
import { AppError } from "@app/errors";

export const LEGAL_DOCUMENT_IDS = ["terms", "privacy"] as const;
export type LegalDocumentId = (typeof LEGAL_DOCUMENT_IDS)[number];

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
    // Only version stamps travel with the config; the apps fetch the full text from
    // GET /legal/:id when the user opens that screen (keeps start-up light).
    const legalDocuments = await this.db.legalDocument.findMany({
      where: { id: { in: [...LEGAL_DOCUMENT_IDS] } },
      select: { id: true, version: true, updatedAt: true },
    });
    const legalStamp = (id: LegalDocumentId) => {
      const doc = legalDocuments.find((d) => d.id === id);
      return doc
        ? { version: doc.version, updatedAt: doc.updatedAt.toISOString() }
        : null;
    };
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
      // Delivered with the config so the apps store it with everything else and work offline.
      legal: {
        terms: legalStamp("terms"),
        privacy: legalStamp("privacy"),
      },
      updatedAt: new Date(
        Math.max(
          config.updatedAt.getTime(),
          restaurant.updatedAt.getTime(),
          ...legalDocuments.map((d) => d.updatedAt.getTime()),
        ),
      ).toISOString(),
    };
    const etag = `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
    return { data, etag };
  }

  /** Full legal document for GET /legal/:id. */
  async getLegalDocument(id: LegalDocumentId) {
    const doc = await this.db.legalDocument.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        version: true,
        effectiveDate: true,
        blocks: true,
        updatedAt: true,
      },
    });
    if (!doc)
      throw new AppError(
        "LEGAL_DOCUMENT_NOT_FOUND",
        "This document has not been published",
        404,
      );
    const data = {
      id: doc.id,
      title: doc.title,
      version: doc.version,
      effectiveDate: doc.effectiveDate.toISOString().slice(0, 10),
      updatedAt: doc.updatedAt.toISOString(),
      blocks: doc.blocks,
    };
    const etag = `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
    return { data, etag };
  }
}
