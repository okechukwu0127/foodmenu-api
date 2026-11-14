import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

/*
 * Legal document format (shared contract with the mobile app, see PublicLegalDocument there).
 *
 *   { id: "terms", title, version, effectiveDate: "YYYY-MM-DD", blocks: LegalBlock[] }
 *
 *   LegalBlock =
 *     | { type: "heading"; level: 2 | 3; text }      // level 2 = part, level 3 = clause
 *     | { type: "paragraph"; text }
 *     | { type: "list"; items: string[] }             // bulleted list
 *     | { type: "table"; columns: string[]; rows: string[][] }
 *
 * Any `text`, list item or table cell may use two inline marks: **bold** and [label](url).
 * url is https://…, mailto:…, tel:… or an app-known route such as /privacy-policy.
 * The document title is NOT repeated as a block; the app shows it as the screen title.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const cell = z.string().trim().max(2000);

export const legalBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: text(300) }).strict(),
  z.object({ type: z.literal("paragraph"), text: text(10_000) }).strict(),
  z.object({ type: z.literal("list"), items: z.array(text(2000)).min(1) }).strict(),
  z
    .object({ type: z.literal("table"), columns: z.array(text(200)).min(1), rows: z.array(z.array(cell)).min(1) })
    .strict()
    .refine((t) => t.rows.every((row) => row.length === t.columns.length), "Every table row needs one cell per column"),
]);

export const legalDocumentSeedSchema = z
  .object({
    id: z.enum(["terms", "privacy"]),
    title: text(160),
    version: text(32),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    blocks: z.array(legalBlockSchema).min(1).max(2000),
  })
  .strict();

export type LegalDocumentSeed = z.infer<typeof legalDocumentSeedSchema>;

/** Publishes a legal document; only writes when the title, version, date or wording changed. */
export async function seedLegalDocument(db: PrismaClient, input: unknown) {
  const doc = legalDocumentSeedSchema.parse(input);
  const data = {
    title: doc.title,
    version: doc.version,
    effectiveDate: new Date(`${doc.effectiveDate}T00:00:00.000Z`),
    blocks: doc.blocks as Prisma.InputJsonValue,
  };
  const existing = await db.legalDocument.findUnique({ where: { id: doc.id } });
  if (!existing) {
    await db.legalDocument.create({ data: { id: doc.id, ...data } });
    return;
  }
  const changed =
    existing.title !== data.title ||
    existing.version !== data.version ||
    existing.effectiveDate.getTime() !== data.effectiveDate.getTime() ||
    JSON.stringify(existing.blocks) !== JSON.stringify(doc.blocks);
  if (changed) await db.legalDocument.update({ where: { id: doc.id }, data });
}
