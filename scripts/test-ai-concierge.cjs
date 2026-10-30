require("dotenv").config({ quiet: true });
const { spawnSync } = require("node:child_process");
const explicit = process.env.AI_TEST_DATABASE_URL;
const databaseUrl = explicit || process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("Set AI_TEST_DATABASE_URL or local DATABASE_URL");
if (
  !explicit &&
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
)
  throw new Error(
    "Explicitly set AI_TEST_DATABASE_URL for a remote test database",
  );
const result = spawnSync(
  process.execPath,
  [
    "node_modules/jest/bin/jest.js",
    "--config",
    "test/jest-e2e.json",
    "--runInBand",
    "--watchman=false",
    "test/ai-concierge.e2e-spec.ts",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, AI_TEST_DATABASE_URL: databaseUrl },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
