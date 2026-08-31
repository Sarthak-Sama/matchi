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

export function emptyGraphs(): TransitGraphs {
  return buildGraphs([]);
}

export function graphsFromEdges(edges: readonly RailEdgeRow[]): TransitGraphs {
  return buildGraphs(edges);
}
