// Zod validation layer between the router and the controller.
//
// Express 5 exposes req.query through a getter (assignment throws), so
// validated values are attached to `req.validated` instead. Controllers read
// them back through the strongly typed `validated<T>()` helper.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType, ZodError } from "zod";
import { errors } from "../lib/errors";

export interface ValidatedInput {
  query?: unknown;
  params?: unknown;
  body?: unknown;
}

declare global {
  namespace Express {
    interface Request {
      validated?: ValidatedInput;
    }
  }
}

function toIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export interface ValidationSchemas {
  query?: ZodType;
  params?: ZodType;
  body?: ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const validated: ValidatedInput = {};

    // params -> query -> body: reject as early as possible.
    for (const key of ["params", "query", "body"] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        next(
          errors.validationError(`Invalid request ${key}.`, {
            issues: toIssues(result.error),
          }),
        );
        return;
      }
      validated[key] = result.data;
    }

    req.validated = { ...req.validated, ...validated };
    next();
  };
}

/**
 * Read a value that the `validate()` middleware parsed for this request.
 * The controller must only request keys that were listed in its route's
 * validation schemas.
 */
export function validated<T>(req: Request, key: keyof ValidatedInput): T {
  const value = req.validated?.[key];
  if (value === undefined) {
    // Programming error: the route did not validate this input.
    throw errors.internal();
  }
  return value as T;
}
