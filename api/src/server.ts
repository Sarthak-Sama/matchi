import { buildApp } from "./app.js";
import type { Config } from "./config.js";
import { loadConfig } from "./config.js";
import type { DbPool } from "./db.js";
import { createPool } from "./db.js";
import type { TransitGraphs } from "./domain/transit/graph.js";
import { buildGraphs } from "./domain/transit/graph.js";
import { loadRailEdges } from "./domain/transit/loader.js";

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function reloadGraph(pool: DbPool): Promise<TransitGraphs> {
  const edges = await loadRailEdges(pool);
  if (edges.length === 0) {
    console.warn(
      "reloadGraph: loaded zero rail_edges rows — the transit graph is empty. " +
        "/v1/optimize will report 503 GRAPH_UNAVAILABLE until transit data is imported.",
    );
  }
  return buildGraphs(edges);
}

async function reloadGraphOrExit(pool: DbPool): Promise<TransitGraphs> {
  try {
    return await reloadGraph(pool);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function main(): Promise<void> {
  const config = loadConfigOrExit();
  const pool = createPool(config.DATABASE_URL);
  const graphs = await reloadGraphOrExit(pool);
  const app = buildApp({ config, pool, graphs });

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
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  void main();
}
