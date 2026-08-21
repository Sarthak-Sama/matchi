/**
 * API entrypoint: loads config, builds the DB pool and the Fastify app,
 * starts listening, and shuts down gracefully on SIGTERM/SIGINT (close
 * the HTTP server, then the DB pool).
 */

import { buildApp } from "./app.js";
import type { Config } from "./config.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const config = loadConfigOrExit();
const pool = createPool(config.DATABASE_URL);
const app = buildApp({ config, pool });

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
