import { OFFPEAK_WAIT_MINUTES, PEAK_WAIT_MINUTES } from "@tokyo/shared";
import { describe, expect, it } from "vitest";

import { buildGraph, buildGraphs } from "./graph.js";
import type { RailEdgeRow } from "./graph.js";

const RIDE_ROW: RailEdgeRow = {
  fromStationGroupId: "sg-x",
  toStationGroupId: "sg-y",
  railLineId: "rl-1",
  railLineName: "Line One",
  edgeType: "ride",
  peakTravelMinutes: 5,
  offpeakTravelMinutes: 3,
  peakWaitMinutes: 0,
  offpeakWaitMinutes: 0,
  confidence: "high",
};

const TRANSFER_ROW: RailEdgeRow = {
  fromStationGroupId: "sg-y",
  toStationGroupId: "sg-z",
  railLineId: null,
  railLineName: null,
  edgeType: "transfer",
  peakTravelMinutes: 2,
  offpeakTravelMinutes: 2,
  peakWaitMinutes: 0,
  offpeakWaitMinutes: 0,
  confidence: "medium",
};

describe("buildGraph", () => {
  it("selects peak travelMinutes and defaults waitMinutes to PEAK_WAIT_MINUTES when the row's own wait column is 0", () => {
    const graph = buildGraph([RIDE_ROW], "peak");
    const edges = graph.forward.get("sg-x");
    expect(edges).toHaveLength(1);
    expect(edges?.[0]?.travelMinutes).toBe(5);
    expect(edges?.[0]?.waitMinutes).toBe(PEAK_WAIT_MINUTES);
  });

  it("selects offpeak travelMinutes and defaults waitMinutes to OFFPEAK_WAIT_MINUTES", () => {
    const graph = buildGraph([RIDE_ROW], "offpeak");
    const edges = graph.forward.get("sg-x");
    expect(edges?.[0]?.travelMinutes).toBe(3);
    expect(edges?.[0]?.waitMinutes).toBe(OFFPEAK_WAIT_MINUTES);
  });

  it("uses the row's own wait column when it is set (> 0) instead of the global default", () => {
    const overridden: RailEdgeRow = { ...RIDE_ROW, peakWaitMinutes: 9, offpeakWaitMinutes: 11 };
    const peakGraph = buildGraph([overridden], "peak");
    const offpeakGraph = buildGraph([overridden], "offpeak");
    expect(peakGraph.forward.get("sg-x")?.[0]?.waitMinutes).toBe(9);
    expect(offpeakGraph.forward.get("sg-x")?.[0]?.waitMinutes).toBe(11);
  });

  it("builds a reverse adjacency keyed by the edge's `to` node", () => {
    const graph = buildGraph([RIDE_ROW], "peak");
    const reverseEdges = graph.reverse.get("sg-y");
    expect(reverseEdges).toHaveLength(1);
    expect(reverseEdges?.[0]?.from).toBe("sg-x");
    expect(reverseEdges?.[0]?.to).toBe("sg-y");
    // sg-x has no incoming edges in this fixture.
    expect(graph.reverse.get("sg-x")).toBeUndefined();
  });

  it("collects every node touched by any edge into `nodes`", () => {
    const graph = buildGraph([RIDE_ROW, TRANSFER_ROW], "peak");
    expect([...graph.nodes].sort()).toEqual(["sg-x", "sg-y", "sg-z"]);
  });

  it("carries edgeType, railLineId (null for transfer), and confidence through unchanged", () => {
    const graph = buildGraph([TRANSFER_ROW], "peak");
    const edge = graph.forward.get("sg-y")?.[0];
    expect(edge?.edgeType).toBe("transfer");
    expect(edge?.railLineId).toBeNull();
    expect(edge?.confidence).toBe("medium");
  });

  it("throws on a `ride` row with a null railLineId (only transfer edges may omit a line)", () => {
    const invalidRow: RailEdgeRow = { ...RIDE_ROW, railLineId: null };
    expect(() => buildGraph([invalidRow], "peak")).toThrow(/null railLineId/);
  });
});

describe("buildGraphs", () => {
  it("builds both a peak and an offpeak graph from the same rows", () => {
    const graphs = buildGraphs([RIDE_ROW]);
    expect(graphs.peak.period).toBe("peak");
    expect(graphs.offpeak.period).toBe("offpeak");
    expect(graphs.peak.forward.get("sg-x")?.[0]?.travelMinutes).toBe(5);
    expect(graphs.offpeak.forward.get("sg-x")?.[0]?.travelMinutes).toBe(3);
  });
});
