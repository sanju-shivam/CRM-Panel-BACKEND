// Health endpoint: liveness for humans, readiness for docker-compose/cron.
// Reports database connectivity and returns 503 when the database is down so
// orchestrators stop routing traffic to this instance.
import type { Request, RequestHandler, Response } from "express";
import { prisma } from "../../lib/prisma";

export const healthController = {
  check: (async (req: Request, res: Response) => {
    let database: "up" | "down" = "down";
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "up";
    } catch (error) {
      req.log.error({ err: error }, "health check: database unreachable");
    }

    res.status(database === "up" ? 200 : 503).json({
      status: database === "up" ? "ok" : "degraded",
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }) as RequestHandler,
};
