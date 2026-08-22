/**
 * API entrypoint: loads config, builds the DB pool, loads the transit graph,
 * builds the Fastify app, starts listening, and shuts down gracefully on
 * SIGTERM/SIGINT (close the HTTP server, then the DB pool).
 *
 * `reloadGraph` and `main` are exported (not just run as a side effect of
 * importing this module) so tests can exercise startup graph loading
 * against a fake pool without spinning up a real listener or a real DB
 * connection — `main()` (the part with actual side effects) only runs when
 * this file is executed directly, guarded by the `isMainModule` check at
 * the bottom.
 */

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

/**
 * Loads every `rail_edges` row and builds both the peak/off-peak graphs
 * from it. Read-only (never mutates the database), so it's safe to call
 * from tests against a fake pool. Logs a `warn` — never throws — when the
 * graph comes back empty: the server still starts, `/health` still reports
 * `ok`, and `/v1/optimize` is responsible for reporting a clear
 * `GRAPH_UNAVAILABLE` 503 to callers in that case (see routes/optimize.ts).
 */
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

/**
 * Loads the transit graph, exiting the process the same way
 * `loadConfigOrExit` does (a readable `console.error` + `process.exit(1)`,
 * no raw unhandled-rejection stack trace) if it throws — e.g. the database
 * is unreachable at startup. Distinct from `reloadGraph` itself staying
 * throw-free for the "loaded, but zero rows" case (see its own doc
 * comment): THIS wrapper only guards against `reloadGraph` REJECTING
 * outright, which is a startup failure, not an empty-graph warning.
 */
async function reloadGraphOrExit(pool: DbPool): Promise<TransitGraphs> {
  try {
    return await reloadGraph(pool);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** Runs the real server: connects to Postgres, loads the graph, listens, and wires shutdown. */
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
