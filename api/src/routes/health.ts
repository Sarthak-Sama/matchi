import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DbPool } from "../db.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(dirname, "..", "..", "package.json");
const { version: API_VERSION } = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
  version: string;
};

export interface HealthRouteDeps {
  pool: DbPool;
}

interface HealthResponseBody {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  database: { reachable: boolean; latencyMs: number | null };
  version: string;
}

export function registerHealthRoute(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get("/health", async (request, reply) => {
    const start = Date.now();
    let reachable: boolean;
    let latencyMs: number | null;

    try {
      await deps.pool.query("select 1");
      reachable = true;
      latencyMs = Date.now() - start;
    } catch (err) {
      request.log.warn({ err }, "health check: database unreachable");
      reachable = false;
      latencyMs = null;
    }

    const body: HealthResponseBody = {
      status: reachable ? "ok" : "degraded",
      uptimeSeconds: process.uptime(),
      database: { reachable, latencyMs },
      version: API_VERSION,
    };

    reply.status(reachable ? 200 : 503).send(body);
  });
}
