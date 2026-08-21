import { OFFPEAK_WAIT_MINUTES, PEAK_WAIT_MINUTES, TRANSFER_PENALTY_MINUTES } from "@tokyo/shared";
import { describe, expect, it } from "vitest";

import { reconstructPath, reverseDijkstra } from "./dijkstra.js";
import { buildGraph } from "./graph.js";
import type { RailEdgeRow } from "./graph.js";

// ---------------------------------------------------------------------------
// Main fixture: sg-a -(rl-1)-> sg-b -(rl-1)-> sg-c -(transfer)-> sg-c2
//               -(rl-2)-> sg-d -(rl-3, IMPLICIT transfer at sg-d)-> sg-e
//               -(rl-3)-> sg-dest
//
// Edges are defined ONLY in the forward (origin -> destination) direction
// — deliberately not bidirectional — so every test below only passes if
// `reverseDijkstra` genuinely walks the graph's REVERSE adjacency. A
// implementation that (bug) walked `graph.forward` from the destination
// instead would find nothing at all.
//
// sg-c -> sg-c2 is an EXPLICIT transfer edge, and sg-c2's only outgoing
// edge is on rl-2 while sg-c's only incoming edge is on rl-1 — i.e. there
// is no alternate route from rl-1 to rl-2 other than through this transfer
// edge, so the optimal path is forced to use it (nothing to test if a
// cheaper implicit-transfer shortcut existed around it).
//
// sg-d has BOTH an incoming rl-2 edge and an outgoing rl-3 edge with no
// transfer edge between them — the implicit-transfer case.
//
// waitMinutes is left at 0 on every row so it falls back to the global
// PEAK_WAIT_MINUTES / OFFPEAK_WAIT_MINUTES constant (see graph.ts) — i.e.
// every ride edge's wait is uniform per period, which is what makes the
// reverse "charge on entry" attribution produce the same total as forward
// "charge on the true boarding edge" attribution (see dijkstra.ts's doc
// comment).
// ---------------------------------------------------------------------------
const MAIN_EDGES: RailEdgeRow[] = [
  {
    fromStationGroupId: "sg-a",
    toStationGroupId: "sg-b",
    railLineId: "rl-1",
    railLineName: "Line 1",
    edgeType: "ride",
    peakTravelMinutes: 5,
    offpeakTravelMinutes: 3,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-b",
    toStationGroupId: "sg-c",
    railLineId: "rl-1",
    railLineName: "Line 1",
    edgeType: "ride",
    peakTravelMinutes: 4,
    offpeakTravelMinutes: 4,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "medium",
  },
  {
    fromStationGroupId: "sg-c",
    toStationGroupId: "sg-c2",
    railLineId: null,
    railLineName: null,
    edgeType: "transfer",
    peakTravelMinutes: 2,
    offpeakTravelMinutes: 2,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-c2",
    toStationGroupId: "sg-d",
    railLineId: "rl-2",
    railLineName: "Line 2",
    edgeType: "ride",
    peakTravelMinutes: 5,
    offpeakTravelMinutes: 5,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-d",
    toStationGroupId: "sg-e",
    railLineId: "rl-3",
    railLineName: "Line 3",
    edgeType: "ride",
    peakTravelMinutes: 2,
    offpeakTravelMinutes: 2,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "low",
  },
  {
    fromStationGroupId: "sg-e",
    toStationGroupId: "sg-dest",
    railLineId: "rl-3",
    railLineName: "Line 3",
    edgeType: "ride",
    peakTravelMinutes: 3,
    offpeakTravelMinutes: 3,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
];

describe("reverseDijkstra + reconstructPath — main fixture", () => {
  it("charges the boarding wait ONCE across a two-hop same-line journey (sg-a -> sg-b -> sg-c)", () => {
    // By hand (offpeak, OFFPEAK_WAIT_MINUTES = 6):
    //   sg-a -> sg-b: 3 min travel, NEW boarding on rl-1 -> +6 wait.
    //   sg-b -> sg-c: 4 min travel, SAME line rl-1 -> no extra wait.
    //   railMinutes = 3 + 4 = 7, waitMinutes = 6 (not 12), transferCount = 0.
    //   totalMinutes = 7 + 6 + 0 = 13.
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, "sg-c");
    const state = result.get("sg-a");
    expect(state).toBeDefined();
    expect(state?.railMinutes).toBe(7);
    expect(state?.waitMinutes).toBe(OFFPEAK_WAIT_MINUTES);
    expect(state?.transferCount).toBe(0);
    expect(state?.transferPenaltyMinutes).toBe(0);
    expect(state?.totalMinutes).toBe(13);
  });

  it("an explicit transfer edge (sg-c -> sg-c2) adds exactly TRANSFER_PENALTY_MINUTES and transferCount === 1", () => {
    // By hand (offpeak): sg-a->sg-b (3, +wait 6) + sg-b->sg-c (4, same line)
    // + sg-c->sg-c2 TRANSFER (travel 2 + TRANSFER_PENALTY_MINUTES 5).
    //   railMinutes = 3 + 4 + 2 = 9
    //   waitMinutes = 6 (still just the one rl-1 boarding)
    //   transferPenaltyMinutes = 5, transferCount = 1
    //   totalMinutes = 9 + 6 + 5 = 20
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, "sg-c2");
    const state = result.get("sg-a");
    expect(state).toBeDefined();
    expect(state?.railMinutes).toBe(9);
    expect(state?.waitMinutes).toBe(6);
    expect(state?.transferCount).toBe(1);
    expect(state?.transferPenaltyMinutes).toBe(TRANSFER_PENALTY_MINUTES);
    expect(state?.totalMinutes).toBe(20);
  });

  it("a line change with NO explicit transfer edge (sg-c2 -> sg-d -> sg-e) is also charged the transfer penalty", () => {
    // By hand (offpeak): sg-c2->sg-d (rl-2, NEW boarding: travel 5 + wait 6)
    // then sg-d->sg-e (rl-3, line changed from rl-2 with no transfer edge
    // between them -> IMPLICIT transfer: travel 2 + wait 6 + PENALTY 5).
    //   railMinutes = 5 + 2 = 7
    //   waitMinutes = 6 + 6 = 12 (two separate boardings: rl-2, then rl-3)
    //   transferPenaltyMinutes = 5, transferCount = 1
    //   totalMinutes = 7 + 12 + 5 = 24
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, "sg-e");
    const state = result.get("sg-c2");
    expect(state).toBeDefined();
    expect(state?.railMinutes).toBe(7);
    expect(state?.waitMinutes).toBe(12);
    expect(state?.transferCount).toBe(1);
    expect(state?.transferPenaltyMinutes).toBe(TRANSFER_PENALTY_MINUTES);
    expect(state?.totalMinutes).toBe(24);
  });

  it("peak and off-peak produce different totals for the same origin/destination", () => {
    // Full sg-a -> sg-dest journey. See the worked trace in
    // task-8-report.md for the complete hand computation.
    // Offpeak: railMinutes=19, waitMinutes=18, transferPenaltyMinutes=10 -> totalMinutes=47.
    // Peak:    railMinutes=21, waitMinutes=12, transferPenaltyMinutes=10 -> totalMinutes=43.
    const offpeakGraph = buildGraph(MAIN_EDGES, "offpeak");
    const peakGraph = buildGraph(MAIN_EDGES, "peak");

    const offpeakState = reverseDijkstra(offpeakGraph, "sg-dest").get("sg-a");
    const peakState = reverseDijkstra(peakGraph, "sg-dest").get("sg-a");

    expect(offpeakState?.totalMinutes).toBe(47);
    expect(peakState?.totalMinutes).toBe(43);
    expect(offpeakState?.totalMinutes).not.toBe(peakState?.totalMinutes);
    expect(offpeakState?.waitMinutes).toBe(3 * OFFPEAK_WAIT_MINUTES);
    expect(peakState?.waitMinutes).toBe(3 * PEAK_WAIT_MINUTES);
  });

  it("a disconnected node is absent from the result map", () => {
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, "sg-dest");
    // sg-isolated-test is never referenced by any edge in this fixture
    // (mirrors the real seed's sg-isolated-test, which has zero rail_edges rows).
    expect(result.has("sg-isolated-test")).toBe(false);
    expect(result.get("sg-isolated-test")).toBeUndefined();
  });

  it("reconstructPath returns the correct ordered stations and lines for the full two-transfer journey", () => {
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, "sg-dest");
    const hops = reconstructPath(result, "sg-a");

    expect(hops).toEqual([
      { stationGroupId: "sg-a", railLineId: "rl-1", edgeType: "ride" },
      { stationGroupId: "sg-b", railLineId: "rl-1", edgeType: "ride" },
      { stationGroupId: "sg-c", railLineId: null, edgeType: "transfer" },
      { stationGroupId: "sg-c2", railLineId: "rl-2", edgeType: "ride" },
      { stationGroupId: "sg-d", railLineId: "rl-3", edgeType: "ride" },
      { stationGroupId: "sg-e", railLineId: "rl-3", edgeType: "ride" },
      { stationGroupId: "sg-dest", railLineId: null, edgeType: null },
    ]);
  });

  it("reconstructPath returns null for an unreachable origin", () => {
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, "sg-dest");
    expect(reconstructPath(result, "sg-isolated-test")).toBeNull();
  });

  it("confidence for the full journey is the minimum confidence among its edges (sg-d -> sg-e is 'low')", () => {
    // Edge confidences: sg-a-b high, sg-b-c medium, transfer high,
    // sg-c2-d high, sg-d-e LOW, sg-e-dest high. Min = low.
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, "sg-dest");
    expect(result.get("sg-a")?.confidence).toBe("low");
    // sg-c2's own best path to sg-dest also crosses the low-confidence
    // sg-d->sg-e edge, so it's "low" too.
    expect(result.get("sg-c2")?.confidence).toBe("low");
    // sg-d's own best path to sg-dest still crosses it.
    expect(result.get("sg-d")?.confidence).toBe("low");
    // sg-dest itself has no edges on its (trivial, zero-length) path.
    expect(result.get("sg-dest")?.confidence).toBe("high");
  });

  it("reverse search is directional: an edge usable one way doesn't imply the reverse is reachable", () => {
    const oneWay: RailEdgeRow[] = [
      {
        fromStationGroupId: "sg-only-x",
        toStationGroupId: "sg-only-y",
        railLineId: "rl-one-way",
        railLineName: "One Way Line",
        edgeType: "ride",
        peakTravelMinutes: 5,
        offpeakTravelMinutes: 5,
        peakWaitMinutes: 0,
        offpeakWaitMinutes: 0,
        confidence: "high",
      },
    ];
    const graph = buildGraph(oneWay, "offpeak");

    // Destination sg-only-y: sg-only-x can reach it (forward edge exists).
    const toY = reverseDijkstra(graph, "sg-only-y");
    expect(toY.has("sg-only-x")).toBe(true);

    // Destination sg-only-x: sg-only-y has no path TO sg-only-x (the only
    // edge runs the other way) — only sg-only-x itself (cost 0) appears.
    const toX = reverseDijkstra(graph, "sg-only-x");
    expect(toX.has("sg-only-y")).toBe(false);
    expect(toX.get("sg-only-x")?.totalMinutes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Second fixture: a genuinely cheaper longer-hop-count route vs. a shorter
// one that pays a transfer.
//
//   Route via "hub" (3 edges: ride, transfer, ride):
//     sg-origin2 -(rl-shorta)-> sg-hub -(transfer)-> sg-hub2 -(rl-shortb)-> sg-dest2
//   Route via m1/m2/m3 (4 ride edges, all one line, no transfer):
//     sg-origin2 -(rl-longc)-> sg-m1 -> sg-m2 -> sg-m3 -(rl-longc)-> sg-dest2
//
// By hand (offpeak, OFFPEAK_WAIT_MINUTES = 6, TRANSFER_PENALTY_MINUTES = 5):
//   hub route:  boarding(3+6=9) + transfer(2+5=7) + boarding(3+6=9) = 25
//   long route: boarding(4+6=10) + 4 + 4 + 4                        = 22
// The long, transfer-free route is cheaper (22 < 25) despite more hops.
// ---------------------------------------------------------------------------
const HUB_VS_LONG_EDGES: RailEdgeRow[] = [
  {
    fromStationGroupId: "sg-origin2",
    toStationGroupId: "sg-hub",
    railLineId: "rl-shorta",
    railLineName: "Short A",
    edgeType: "ride",
    peakTravelMinutes: 3,
    offpeakTravelMinutes: 3,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-hub",
    toStationGroupId: "sg-hub2",
    railLineId: null,
    railLineName: null,
    edgeType: "transfer",
    peakTravelMinutes: 2,
    offpeakTravelMinutes: 2,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-hub2",
    toStationGroupId: "sg-dest2",
    railLineId: "rl-shortb",
    railLineName: "Short B",
    edgeType: "ride",
    peakTravelMinutes: 3,
    offpeakTravelMinutes: 3,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-origin2",
    toStationGroupId: "sg-m1",
    railLineId: "rl-longc",
    railLineName: "Long C",
    edgeType: "ride",
    peakTravelMinutes: 4,
    offpeakTravelMinutes: 4,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-m1",
    toStationGroupId: "sg-m2",
    railLineId: "rl-longc",
    railLineName: "Long C",
    edgeType: "ride",
    peakTravelMinutes: 4,
    offpeakTravelMinutes: 4,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-m2",
    toStationGroupId: "sg-m3",
    railLineId: "rl-longc",
    railLineName: "Long C",
    edgeType: "ride",
    peakTravelMinutes: 4,
    offpeakTravelMinutes: 4,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-m3",
    toStationGroupId: "sg-dest2",
    railLineId: "rl-longc",
    railLineName: "Long C",
    edgeType: "ride",
    peakTravelMinutes: 4,
    offpeakTravelMinutes: 4,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
];

describe("reverseDijkstra picks the genuinely cheapest route", () => {
  it("prefers the longer (4-hop, no transfer) route over the shorter (3-hop, one transfer) route", () => {
    const graph = buildGraph(HUB_VS_LONG_EDGES, "offpeak");
    const result = reverseDijkstra(graph, "sg-dest2");
    const state = result.get("sg-origin2");

    expect(state?.totalMinutes).toBe(22);
    expect(state?.transferCount).toBe(0);

    const hops = reconstructPath(result, "sg-origin2");
    expect(hops?.[0]).toEqual({
      stationGroupId: "sg-origin2",
      railLineId: "rl-longc",
      edgeType: "ride",
    });
  });
});
