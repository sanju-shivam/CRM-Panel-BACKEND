// Centralised error handling.
//
// Guarantees:
//  - one wire shape for every failure: { error: { code, message, requestId } }
//  - client never sees stack traces or database internals
//  - every failure is logged server-side with the request id
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppError, ERROR_CODES, errors, type ErrorDetails } from "../lib/errors";
import { mapPrismaError } from "../lib/prisma-errors";

function requestIdOf(req: Request): string {
  return typeof req.id === "string" ? req.id : String(req.id ?? "unknown");
}

interface BodyParserError extends Error {
  status?: number;
  type?: string;
  statusCode?: number;
}

function fromBodyParserError(error: unknown): AppError | null {
  const err = error as BodyParserError;
  if (typeof err?.type !== "string" || !err.type.startsWith("entity.")) return null;

  if (err.type === "entity.parse.failed") {
    return errors.invalidRequest("Request body is not valid JSON.");
  }
  if (err.type === "entity.too.large") {
    return errors.invalidRequest("Request body is too large.");
  }
  return errors.invalidRequest("Malformed request body.");
}

function fromZodError(error: unknown): AppError | null {
  if (!(error instanceof ZodError)) return null;
  const issues = error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  return errors.validationError("Request validation failed.", { issues });
}

function send(req: Request, res: Response, error: AppError): void {
  const body: { error: { code: string; message: string; requestId: string; details?: ErrorDetails } } = {
    error: {
      code: error.code,
      message: error.message,
      requestId: requestIdOf(req),
    },
  };
  if (error.details) body.error.details = error.details;

  if (error.status >= 500) {
    req.log.error({ err: error, code: error.code }, error.message);
  } else {
    req.log.warn({ code: error.code, status: error.status }, error.message);
  }
  res.status(error.status).json(body);
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError =
    error instanceof AppError
      ? error
      : (fromBodyParserError(error) ??
        fromZodError(error) ??
        mapPrismaError(error));

  if (appError) {
    send(req, res, appError);
    return;
  }

  // Unexpected failure: log everything, tell the client nothing.
  req.log.error({ err: error }, "Unhandled request error");
  send(req, res, errors.internal());
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: ERROR_CODES.INVALID_REQUEST,
      message: `Route ${req.method} ${req.path} does not exist.`,
      requestId: requestIdOf(req),
    },
  });
};
