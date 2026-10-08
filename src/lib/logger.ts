// Application-wide Pino logger. Never log request bodies: they can contain
// personal data (this is a CRM).
import { pino } from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "crm-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
