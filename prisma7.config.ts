// Prisma CLI configuration (Prisma 7 uses a dedicated config file instead of
// the package.json "prisma" key used by older versions).
//
// Two connection URLs, matching the Supabase setup documented in the README:
//
//   DATABASE_URL  runtime queries (Prisma client via the pg driver adapter,
//                 see src/lib/prisma.ts) - pooled connection through PgBouncer.
//   DIRECT_URL    Prisma CLI commands (migrate/studio/introspection) - the
//                 direct, non-pooled PostgreSQL connection. Migrations must
//                 never run through the pooled connection.
//
// Prisma 7 no longer accepts `url`/`directUrl` in the schema's datasource
// block (it errors with "The datasource property `directUrl` is no longer
// supported in schema files"), so the CLI-side URL lives here instead. The
// application code never reads this file.
//
// Environment resolution order: ./.env (backend folder, from .env.example)
// then ../.env (the monorepo root, if any). On Render neither file exists and values come from the
// service's environment. Values already present in process.env (e.g. the test
// setups, which pin DATABASE_URL/DIRECT_URL explicitly) always win.
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), "../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx src/scripts/seed.ts",
  },
  datasource: {
    // Direct connection for the CLI; falls back to DATABASE_URL when no
    // DIRECT_URL is configured (plain local PostgreSQL, where both point at
    // the same database anyway).
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
