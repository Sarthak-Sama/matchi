/**
 * Vercel's Fastify preset discovers this conventional entrypoint. Export the
 * underlying Node server (rather than the Fastify instance) so Vercel can
 * invoke it as a serverless function.
 */
import { buildApp } from "./application.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { reloadGraph } from "./server.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, {
  maxConnections: config.DATABASE_POOL_MAX,
  idleTimeoutMs: config.DATABASE_POOL_IDLE_TIMEOUT_MS,
});
const graphs = await reloadGraph(pool);
const app = buildApp({ config, pool, graphs });

await app.ready();

export default app.server;
