// Runs once before the whole test suite.
//
// Recreates the dedicated test database from scratch (drop + create + migrate)
// so every run starts from a known schema state, independent of whatever the
// development database contains. Runs in the Vitest main process, where
// `test.env` has not been applied, so it loads the environment files itself:
// .env followed by .env.test (override, backend folder), which pins the suite
// to the local PostgreSQL test database - never Supabase.
import { config as loadEnv } from "dotenv";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

loadEnv({ path: ".env" });
loadEnv({ path: "../.env" });
loadEnv({ path: ".env.test", override: true });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set - cannot run the test suite.`);
  }
  return value;
}

const testDatabaseUrl = requiredEnv("DATABASE_URL");

// Safety belt: dropping/creating databases below must never touch a Supabase
// database. Tests truncate and mutate data, so they always run against the
// local PostgreSQL test database.
if (!testDatabaseUrl.includes("crm_test")) {
  throw new Error(
    `Refusing to run tests: test database must be local crm_test, got: ${testDatabaseUrl}`,
  );
}
if (/supabase\.(co|com)\b/.test(testDatabaseUrl)) {
  throw new Error(
    "Refusing to run tests against a Supabase database. Tests use the local crm_test database (.env.test).",
  );
}

/** Same URL with the database name replaced by the maintenance database. */
function maintenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

async function recreateDatabase(url: string): Promise<void> {
  const admin = new Client({ connectionString: maintenanceUrl(url) });
  try {
    await admin.connect();
    // WITH (FORCE) terminates leftover connections from a previous run so the
    // drop can never fail with "database is being accessed".
    await admin.query("DROP DATABASE IF EXISTS crm_test WITH (FORCE)");
    await admin.query("CREATE DATABASE crm_test");
  } finally {
    await admin.end().catch(() => undefined);
  }
}

function applyMigrations(url: string): void {
  // Single command string (no args array): Node deprecates args combined with
  // `shell: true`, and the shell is required for cross-platform `npx`.
  // Both DATABASE_URL and DIRECT_URL are pinned so the Prisma CLI config
  // (which prefers DIRECT_URL for migrations) targets the test database.
  const result = spawnSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed with status ${result.status}`);
  }
}

export default async function globalSetup(): Promise<void> {
  await recreateDatabase(testDatabaseUrl);
  applyMigrations(testDatabaseUrl);
}