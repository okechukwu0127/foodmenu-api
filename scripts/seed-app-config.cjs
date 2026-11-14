require("dotenv").config({ quiet: true });
require("ts-node/register/transpile-only");
const { PrismaClient } = require("@prisma/client");
const { readFileSync } = require("node:fs");
const {
  seedAppConfiguration,
} = require("../prisma/seed-data/app-config.seed.ts");
const {
  seedLegalDocument,
} = require("../prisma/seed-data/legal-documents.seed.ts");
const db = new PrismaClient();
(async () => {
  const input = JSON.parse(
    readFileSync(process.argv[2] || "prisma/app-config.json", "utf8"),
  );
  await seedAppConfiguration(db, input, true);
  for (const doc of ["terms", "privacy"])
    await seedLegalDocument(
      db,
      JSON.parse(readFileSync(`prisma/legal/${doc}.json`, "utf8")),
    );
  console.log("Public application configuration published");
})()
  .catch((error) => {
    console.error(
      error.name === "ZodError"
        ? "Invalid application configuration seed"
        : error.code || "Application configuration publish failed",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
