// Translation layer between Prisma/PostgreSQL errors and typed application
// errors. Business rules live in services; this file only translates
// infrastructure-level failures so that services can `catch` and rethrow.
import { Prisma } from "../generated/prisma/client";
import { AppError, ERROR_CODES, errors } from "./errors";

interface KnownPrismaError {
  code: string;
  meta?: unknown;
}

function asKnownPrismaError(error: unknown): KnownPrismaError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return { code: error.code, meta: error.meta };
  }
  return null;
}

interface DriverAdapterCause {
  originalMessage?: string;
  constraint?: { index?: string; columns?: string[] };
  table?: string;
}

/**
 * Names of the constraints/indexes a unique violation hit.
 *
 * Two shapes exist depending on Prisma runtime:
 *  - legacy: `meta.target` is the column array or constraint name;
 *  - Prisma 7 + driver adapters: columns are gone; the PostgreSQL error is
 *    nested at `meta.driverAdapterError.cause.constraint.index` (e.g.
 *    "contacts_account_id_email_key") with `originalMessage` as fallback.
 */
function metaTarget(meta: unknown): string[] {
  const names: string[] = [];
  if (!meta || typeof meta !== "object") return names;
  const root = meta as Record<string, unknown>;

  if (Array.isArray(root.target)) {
    names.push(...root.target.map(String));
  } else if (typeof root.target === "string") {
    names.push(root.target);
  }

  const adapter = root.driverAdapterError as { cause?: DriverAdapterCause } | undefined;
  const cause = adapter?.cause;
  if (cause) {
    if (typeof cause.constraint?.index === "string") names.push(cause.constraint.index);
    if (Array.isArray(cause.constraint?.columns)) names.push(...cause.constraint.columns.map(String));
    if (typeof cause.table === "string") names.push(cause.table);
    if (typeof cause.originalMessage === "string") names.push(cause.originalMessage);
  }

  return names;
}

/**
 * True when PostgreSQL rejected a write because of a unique constraint.
 * Used by services that own a more specific translation than
 * `mapPrismaError` (e.g. duplicate tag assignment).
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return asKnownPrismaError(error)?.code === "P2002";
}

/** True when PostgreSQL rejected a write because a referenced row is gone. */
export function isForeignKeyViolation(error: unknown): boolean {
  return asKnownPrismaError(error)?.code === "P2003";
}

/**
 * Map a Prisma known request error to an AppError.
 *
 * Returns `null` when the error is not a known request error (or has no
 * meaningful translation), leaving the caller to decide how to surface it.
 */
export function mapPrismaError(error: unknown): AppError | null {
  const prismaError = asKnownPrismaError(error);
  if (!prismaError) return null;

  if (prismaError.code === "P2002") {
    // Unique constraint violation. The only user-visible unique constraint in
    // this application is contacts (accountId, email); anything else is
    // internal (matchers are substring-based so they survive both the legacy
    // and the driver-adapter meta shapes).
    const target = metaTarget(prismaError.meta).map((name) => name.toLowerCase());
    if (target.some((name) => name.includes("email"))) {
      return errors.emailAlreadyExists();
    }
    return new AppError(
      ERROR_CODES.INTERNAL_SERVER_ERROR,
      500,
      "An unexpected error occurred.",
    );
  }

  // P2025: record required for update/delete was not found. The calling
  // service already verified existence, so treat it as a state conflict.
  if (prismaError.code === "P2025") {
    return errors.versionConflict();
  }

  return null;
}
