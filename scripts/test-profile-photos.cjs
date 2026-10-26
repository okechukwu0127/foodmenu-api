// Run database integration tests in a new, disposable schema, never public.
require("dotenv").config({ quiet: true });
const { spawnSync } = require("node:child_process");
const explicitUrl = process.env.PROFILE_PHOTOS_TEST_DATABASE_URL;
const databaseUrl = explicitUrl || process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set PROFILE_PHOTOS_TEST_DATABASE_URL or a local DATABASE_URL.",
  );
if (
  !explicitUrl &&
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
) {
  throw new Error(
    "For a remote test database, explicitly set PROFILE_PHOTOS_TEST_DATABASE_URL.",
  );
}
const result = spawnSync(
  process.execPath,
  [
    "node_modules/jest/bin/jest.js",
    "--config",
    "test/jest-e2e.json",
    "--runInBand",
    "--watchman=false",
    "test/profile-photos.e2e-spec.ts",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, PROFILE_PHOTOS_TEST_DATABASE_URL: databaseUrl },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
