// Vitest configuration for the backend integration suite.
//
// The suite runs against a dedicated database (crm_test) so it can never
// touch development, E2E or - importantly - the Supabase demo data:
//  - .env.test (this folder) pins DATABASE_URL/DIRECT_URL to the LOCAL
//    PostgreSQL test database and is loaded with `override` LAST, so test
//    runs keep using crm_test even when .env is configured for Supabase;
//  - global-setup drops + recreates crm_test and applies pending migrations
//    once per run (see tests/global-setup.ts);
//  - `test.env` points the application code at crm_test inside the worker
//    process, before any application module is imported;
//  - files run one at a time in a single process, so a file's per-file
//    database reset can never race another file's fixtures.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: ".env" });
loadEnv({ path: "../.env" });
// Test pinning: this file wins over .env so the suite can never be aimed at
// a Supabase database by accident.
loadEnv({ path: ".env.test", override: true });

const testDatabaseUrl = process.env.DATABASE_URL;
if (!testDatabaseUrl || !testDatabaseUrl.includes("crm_test")) {
  throw new Error(
    ".env.test must set DATABASE_URL to the local crm_test database (see backend/tests/global-setup.ts). " +
      "Do not run tests against Supabase.",
  );
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    },
    pool: "forks",
    // Files run one at a time (maxWorkers forced to 1), so a file's database
    // reset can never race another file's fixtures.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});