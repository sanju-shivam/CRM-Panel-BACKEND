// Request context: every request gets an id (honouring an inbound
// x-request-id when present) that is echoed in the response header, included
// in every log line and in every error payload. This is what makes a client
// error report traceable to a specific server log entry.
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function requestContext(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.headers["x-request-id"];
    const requestId =
      typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();

    req.id = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  };
}
