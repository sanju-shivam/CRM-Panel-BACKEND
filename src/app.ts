// Express application factory.
//
// Middleware order is deliberate:
//   1. request id      - every subsequent log line and error carries it
//   2. pino-http       - request logging (body parsing failures included)
//   3. cors / json     - transport concerns
//   4. routes          - docs, health, /api/v1
//   5. 404 + error     - single exit point for every failure
import cors from "cors";
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./docs/openapi";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestContext } from "./middleware/request-context";
import { logger } from "./lib/logger";
import contactsRouter from "./modules/contacts/contacts.router";
import healthRouter from "./modules/health/health.router";
import tagsRouter from "./modules/tags/tags.router";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestContext());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => String(req.id),
      autoLogging: {
        ignore: (req) => req.url === "/health" || req.url === "/api/v1/health",
      },
    }),
  );

  // In docker the nginx in front of the Angular bundle proxies /api to this
  // service (same origin), and the Angular dev server proxies /api too, so
  // CORS only matters when the API is called directly from another origin.
  // CORS_ORIGIN is a comma-separated allowlist (default covers the Angular
  // dev server).
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    }),
  );

  // Hard bound on body size: bulk assignment is capped at 100 contacts, so
  // anything large is a client bug or an abuse attempt.
  app.use(express.json({ limit: "200kb" }));

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      explorer: false,
      customSiteTitle: "CRM Contact Workspace API",
      customCss: ".swagger-ui .topbar { display: none; }",
    }),
  );
  app.get("/api-docs.json", (_req, res) => {
    res.json(openApiDocument);
  });

  // Health exists both standalone (for docker healthchecks) and under the
  // versioned base path (as specified).
  app.use("/health", healthRouter);
  app.use("/api/v1/health", healthRouter);

  // Tags router is registered before contacts because it owns the
  // /contacts/bulk/tags route, which must win over /contacts/:contactId/tags.
  app.use("/api/v1", tagsRouter);
  app.use("/api/v1", contactsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
