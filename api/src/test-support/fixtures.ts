/**
 * Shared test-only fixtures for API tests: a minimal valid `Config` and an
 * empty (but well-formed) `TransitGraphs`. Not itself a `*.test.ts` file, so
 * Vitest's `include: ["src/**\/*.test.ts"]` glob never picks it up as a
 * suite — it's imported BY suites (`app.test.ts`, `routes/*.test.ts`).
 */

import type { Config } from "../config.js";
import type { RailEdgeRow, TransitGraphs } from "../domain/transit/graph.js";
import { buildGraphs } from "../domain/transit/graph.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    DATABASE_URL: "postgresql://tokyo:tokyo@localhost:5432/tokyo_test",
    PORT: 4000,
    HOST: "0.0.0.0",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "*",
    NODE_ENV: "test",
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_OPTIMIZE_MAX: 20,
    TRUST_PROXY: false,
    ...overrides,
  };
}

/**
 * A structurally valid `TransitGraphs` built from zero `rail_edges` rows —
 * both `peak.nodes` and `offpeak.nodes` are empty sets, exactly the
 * "GRAPH_UNAVAILABLE" condition `routes/optimize.ts` checks for.
 */
export function emptyGraphs(): TransitGraphs {
  return buildGraphs([]);
}

/** Builds both graphs from a hand-written fixture edge list. */
export function graphsFromEdges(edges: readonly RailEdgeRow[]): TransitGraphs {
  return buildGraphs(edges);
}
