/* eslint-disable no-control-regex -- Reject control characters in catalog IDs, labels and asset URLs. */
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout } from "rxjs";
import { z } from "zod";
import { MENU_PATTERNS } from "@app/common";
import { ConciergeConfig } from "./config.schema";
import { digest, fail } from "../persistence/contracts";

const categoryRows = z
  .array(
    z.object({
      id: z
        .string()
        .min(1)
        .max(128)
        .refine((v) => v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v)),
      slug: z.string().min(1).max(256),
      name: z.unknown().optional(),
      displayName: z.string().nullable().optional(),
      imageUrl: z.string().max(2000).nullable().optional(),
      icon: z.string().max(2000).nullable().optional(),
      sortOrder: z.number().int(),
      isActive: z.boolean().optional(),
    }),
  )
  .max(1000);
const plainLabel = (v: unknown): string | undefined =>
  typeof v === "string" &&
  v.trim() &&
  !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)
    ? v.trim().slice(0, 1000)
    : undefined;

@Injectable()
export class ConciergeCategoryOptionsService {
  constructor(
    @Inject("AI_MENU_SERVICE") private readonly menu: ClientProxy,
    private readonly settings: ConfigService,
  ) {}
  private asset(value?: string | null): string | undefined {
    if (
      !value ||
      /[\s\\\u0000-\u001f\u007f]/.test(value) ||
      value.startsWith("//")
    )
      return undefined;
    try {
      if (/(?:^|\/)\.\.(?:\/|$)/.test(decodeURIComponent(value)))
        return undefined;
      const base = this.settings.get<string>("PUBLIC_ASSET_BASE_URL");
      const url = new URL(
        value,
        base ? base.replace(/\/$/, "") + "/" : undefined,
      );
      if (url.username || url.password) return undefined;
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          this.settings.get<string>("NODE_ENV", "development") !==
            "production" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
      )
        return undefined;
      return url.toString();
    } catch {
      return undefined;
    }
  }
  async load(
    config: Pick<ConciergeConfig, "supportedLocales" | "defaultLocale">,
  ) {
    let input: unknown;
    try {
      input = await firstValueFrom(
        this.menu.send(MENU_PATTERNS.GET_CATEGORIES, {}).pipe(timeout(5000)),
      );
    } catch {
      fail(
        "AI_MENU_UNAVAILABLE",
        "Food categories are unavailable; retry without discarding saved preferences",
        503,
      );
    }
    const parsed = categoryRows.safeParse(input);
    if (
      !parsed.success ||
      new Set(parsed.data.map((c) => c.id)).size !== parsed.data.length
    )
      fail("AI_MENU_UNAVAILABLE", "Menu category information is invalid", 503);
    const categories = parsed.data
      .filter((c) => c.isActive !== false)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    const options = categories.map((c) => {
      const names =
        c.name && typeof c.name === "object" && !Array.isArray(c.name)
          ? (c.name as Record<string, unknown>)
          : {};
      const label = Object.fromEntries(
        config.supportedLocales.map((locale) => [
          locale,
          plainLabel(names[locale]) ??
            plainLabel(names[config.defaultLocale]) ??
            plainLabel(c.displayName) ??
            plainLabel(c.slug) ??
            c.id,
        ]),
      );
      const image = this.asset(c.imageUrl);
      const icon =
        c.icon && /^[a-zA-Z0-9_-]{1,100}$/.test(c.icon)
          ? c.icon
          : this.asset(c.icon);
      return {
        id: c.id,
        label,
        ...(image ? { image } : {}),
        ...(icon ? { icon } : {}),
        exclusive: false,
      };
    });
    const fingerprints = Object.fromEntries(
      config.supportedLocales.map((locale) => [
        locale,
        digest(
          options.map((o, i) => ({
            id: o.id,
            label: o.label[locale],
            image: o.image ?? null,
            icon: o.icon ?? null,
            sortOrder: categories[i].sortOrder,
          })),
        ).slice(0, 32),
      ]),
    );
    return { options, fingerprints };
  }
}
