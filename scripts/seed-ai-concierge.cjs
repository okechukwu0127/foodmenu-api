// Publish immutable configuration versions, never overwrite a released version.
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
require("ts-node/register/transpile-only");
const {
  configSchema,
} = require("../apps/api-gateway/src/ai-concierge/config/config.schema.ts");
const db = new PrismaClient();
async function main() {
  const data = configSchema.parse(
    JSON.parse(
      readFileSync(
        process.argv[2] || "prisma/ai-concierge-config.json",
        "utf8",
      ),
    ),
  );
  const version =
    process.argv[3] ||
    createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex")
      .slice(0, 20);
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(version))
    throw new Error("Invalid configuration version");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8740021)`;
    const existing = await tx.aiConfiguration.findUnique({
      where: { version },
    });
    if (
      existing &&
      JSON.stringify(existing.data) !==
        JSON.stringify(JSON.parse(JSON.stringify(data)))
    ) {
      // PostgreSQL jsonb key order differs: use canonical hashing below.
      const canonical = (v) =>
        Array.isArray(v)
          ? v.map(canonical)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.keys(v)
                  .sort()
                  .map((k) => [k, canonical(v[k])]),
              )
            : v;
      if (
        JSON.stringify(canonical(existing.data)) !==
        JSON.stringify(canonical(data))
      )
        throw new Error(
          "Version already exists with different data; publish a new version",
        );
    }
    await tx.aiConfiguration.updateMany({
      where: { active: true },
      data: { active: false },
    });
    await tx.aiConfiguration.upsert({
      where: { version },
      create: { version, data, active: true },
      update: { active: true },
    });
  });
  console.log(`Published concierge configuration ${version}`);
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
