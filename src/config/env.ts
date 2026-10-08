// Centralised, validated environment configuration.
//
// Every external input is validated - environment variables are no exception.
// A missing or malformed variable fails fast at boot instead of surfacing as a
// confusing runtime error later.
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

// Load order: ./.env (backend folder, from .env.example) then ../.env (the
// monorepo root, if any). Values already present in process.env
// (e.g. set by Render) always win.
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), "../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Comma-separated list of allowed browser origins (see src/app.ts).
  CORS_ORIGIN: z.string().default("http://localhost:4200"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // The assignment has no authentication layer, so the tenant for every
  // request is resolved from configuration. In a production system this value
  // would come from the authenticated principal (JWT claim / session).
  DEFAULT_ACCOUNT_ID: z
    .string()
    .uuid()
    .default("00000000-0000-4000-8000-0000000000aa"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Intentionally printed (not thrown) so the failure is readable even if a
  // logger cannot be constructed yet.
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;
