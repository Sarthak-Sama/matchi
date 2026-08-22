/**
 * `reloadGraph` tests. Importing `server.ts` never opens a real DB
 * connection or starts a real listener — `main()`'s side effects are
 * gated behind an `isMainModule` check (see `server.ts`'s doc comment) —
 * so this is a plain unit test against a fake pool, matching
 * `domain/transit/loader.test.ts`'s pattern.
 */

import { describe, expect, it, vi } from "vitest";

import type { DbPool } from "./db.js";
import { reloadGraph } from "./server.js";

const FAKE_EDGE = {
  fromStationGroupId: "sg-a",
  toStationGroupId: "sg-b",
  railLineId: "rl-1",
  railLineName: "Line One",
  edgeType: "ride",
  peakTravelMinutes: 5,
  offpeakTravelMinutes: 3,
  peakWaitMinutes: 0,
  offpeakWaitMinutes: 0,
  confidence: "high",
};

describe("reloadGraph", () => {
  it("builds both peak and off-peak graphs from the loaded rail_edges rows", async () => {
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [FAKE_EDGE] }) };

    const graphs = await reloadGraph(pool);

    expect(graphs.peak.nodes.size).toBe(2);
    expect(graphs.offpeak.nodes.size).toBe(2);
    expect(graphs.peak.nodes.has("sg-a")).toBe(true);
    expect(graphs.peak.nodes.has("sg-b")).toBe(true);
  });

  it("does NOT warn when the graph has at least one edge", async () => {
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [FAKE_EDGE] }) };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await reloadGraph(pool);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns a well-formed but EMPTY TransitGraphs, and logs a warn, when rail_edges has zero rows", async () => {
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const graphs = await reloadGraph(pool);

    expect(graphs.peak.nodes.size).toBe(0);
    expect(graphs.offpeak.nodes.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain("zero rail_edges");
    expect(message).toContain("GRAPH_UNAVAILABLE");
    warnSpy.mockRestore();
  });
});
