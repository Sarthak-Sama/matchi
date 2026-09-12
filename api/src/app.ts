/**
 * Vercel's Fastify preset discovers this conventional entrypoint. It needs a
 * request handler (not the Fastify instance) as the default export.
 */
import { buildApp } from "./application.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { reloadGraph } from "./server.js";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";

let appPromise: Promise<FastifyInstance> | undefined;

function getApp(): Promise<FastifyInstance> {
  appPromise ??= (async () => {
    const config = loadConfig();
    const pool = createPool(config.DATABASE_URL, {
      maxConnections: config.DATABASE_POOL_MAX,
      idleTimeoutMs: config.DATABASE_POOL_IDLE_TIMEOUT_MS,
    });
    const graphs = await reloadGraph(pool);
    const app = buildApp({ config, pool, graphs });
    await app.ready();
    return app;
  })();
  return appPromise;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit("request", request, response);
}
