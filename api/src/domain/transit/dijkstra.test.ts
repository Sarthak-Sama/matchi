import { OFFPEAK_WAIT_MINUTES, PEAK_WAIT_MINUTES, TRANSFER_PENALTY_MINUTES } from "@tokyo/shared";
import { describe, expect, it } from "vitest";

import { reconstructPath, reverseDijkstra } from "./dijkstra.js";
import { buildGraph } from "./graph.js";
import type { RailEdgeRow } from "./graph.js";

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
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-c", walkMinutes: 0 }]);
    const state = result.get("sg-a");
    expect(state).toBeDefined();
    expect(state?.railMinutes).toBe(7);
    expect(state?.waitMinutes).toBe(OFFPEAK_WAIT_MINUTES);
    expect(state?.transferCount).toBe(0);
    expect(state?.transferPenaltyMinutes).toBe(0);
    expect(state?.totalMinutes).toBe(13);
  });

  it("an explicit transfer edge (sg-c -> sg-c2) adds exactly TRANSFER_PENALTY_MINUTES and transferCount === 1", () => {
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-c2", walkMinutes: 0 }]);
    const state = result.get("sg-a");
    expect(state).toBeDefined();
    expect(state?.railMinutes).toBe(9);
    expect(state?.waitMinutes).toBe(6);
    expect(state?.transferCount).toBe(1);
    expect(state?.transferPenaltyMinutes).toBe(TRANSFER_PENALTY_MINUTES);
    expect(state?.totalMinutes).toBe(20);
  });

  it("a line change with NO explicit transfer edge (sg-c2 -> sg-d -> sg-e) is also charged the transfer penalty", () => {
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-e", walkMinutes: 0 }]);
    const state = result.get("sg-c2");
    expect(state).toBeDefined();
    expect(state?.railMinutes).toBe(7);
    expect(state?.waitMinutes).toBe(12);
    expect(state?.transferCount).toBe(1);
    expect(state?.transferPenaltyMinutes).toBe(TRANSFER_PENALTY_MINUTES);
    expect(state?.totalMinutes).toBe(24);
  });

  it("peak and off-peak produce different totals for the same origin/destination", () => {
    const offpeakGraph = buildGraph(MAIN_EDGES, "offpeak");
    const peakGraph = buildGraph(MAIN_EDGES, "peak");

    const offpeakState = reverseDijkstra(offpeakGraph, [{ node: "sg-dest", walkMinutes: 0 }]).get(
      "sg-a",
    );
    const peakState = reverseDijkstra(peakGraph, [{ node: "sg-dest", walkMinutes: 0 }]).get("sg-a");

    expect(offpeakState?.totalMinutes).toBe(47);
    expect(peakState?.totalMinutes).toBe(43);
    expect(offpeakState?.totalMinutes).not.toBe(peakState?.totalMinutes);
    expect(offpeakState?.waitMinutes).toBe(3 * OFFPEAK_WAIT_MINUTES);
    expect(peakState?.waitMinutes).toBe(3 * PEAK_WAIT_MINUTES);
  });

  it("a disconnected node is absent from the result map", () => {
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-dest", walkMinutes: 0 }]);

    expect(result.has("sg-isolated-test")).toBe(false);
    expect(result.get("sg-isolated-test")).toBeUndefined();
  });

  it("reconstructPath returns the correct ordered stations and lines for the full two-transfer journey", () => {
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-dest", walkMinutes: 0 }]);
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
    const result = reverseDijkstra(graph, [{ node: "sg-dest", walkMinutes: 0 }]);
    expect(reconstructPath(result, "sg-isolated-test")).toBeNull();
  });

  it("confidence for the full journey is the minimum confidence among its edges (sg-d -> sg-e is 'low')", () => {
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-dest", walkMinutes: 0 }]);
    expect(result.get("sg-a")?.confidence).toBe("low");

    expect(result.get("sg-c2")?.confidence).toBe("low");

    expect(result.get("sg-d")?.confidence).toBe("low");

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

    const toY = reverseDijkstra(graph, [{ node: "sg-only-y", walkMinutes: 0 }]);
    expect(toY.has("sg-only-x")).toBe(true);

    const toX = reverseDijkstra(graph, [{ node: "sg-only-x", walkMinutes: 0 }]);
    expect(toX.has("sg-only-y")).toBe(false);
    expect(toX.get("sg-only-x")?.totalMinutes).toBe(0);
    expect(toX.get("sg-only-x")?.destinationWalkMinutes).toBe(0);
  });
});

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
    const result = reverseDijkstra(graph, [{ node: "sg-dest2", walkMinutes: 0 }]);
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

const BRANCHING_EDGES: RailEdgeRow[] = [
  {
    fromStationGroupId: "sg-branch-u",
    toStationGroupId: "sg-branch-v",
    railLineId: "rl-branch-l",
    railLineName: "Branch L",
    edgeType: "ride",
    peakTravelMinutes: 3,
    offpeakTravelMinutes: 3,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-branch-v",
    toStationGroupId: "sg-branch-dest",
    railLineId: "rl-branch-l",
    railLineName: "Branch L",
    edgeType: "ride",
    peakTravelMinutes: 14,
    offpeakTravelMinutes: 14,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-branch-v",
    toStationGroupId: "sg-branch-dest",
    railLineId: "rl-branch-m",
    railLineName: "Branch M",
    edgeType: "ride",
    peakTravelMinutes: 12,
    offpeakTravelMinutes: 12,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
];

const BRANCH_WALK_MINUTES = 7;

describe("reconstructPath at a branching station follows the actual state chain, not each node's own best state", () => {
  it("sg-branch-v's own best state uses rl-branch-m, but sg-branch-u's cheapest path through it uses rl-branch-l", () => {
    const graph = buildGraph(BRANCHING_EDGES, "offpeak");
    const result = reverseDijkstra(graph, [
      { node: "sg-branch-dest", walkMinutes: BRANCH_WALK_MINUTES },
    ]);

    expect(result.get("sg-branch-v")?.totalMinutes).toBe(25);

    const uState = result.get("sg-branch-u");
    expect(uState?.totalMinutes).toBe(30);
    expect(uState?.railMinutes).toBe(17);
    expect(uState?.waitMinutes).toBe(6);
    expect(uState?.transferCount).toBe(0);
    expect(uState?.transferPenaltyMinutes).toBe(0);
    expect(uState?.destinationWalkMinutes).toBe(BRANCH_WALK_MINUTES);

    const hops = reconstructPath(result, "sg-branch-u");
    expect(hops).toEqual([
      { stationGroupId: "sg-branch-u", railLineId: "rl-branch-l", edgeType: "ride" },
      { stationGroupId: "sg-branch-v", railLineId: "rl-branch-l", edgeType: "ride" },
      { stationGroupId: "sg-branch-dest", railLineId: null, edgeType: null },
    ]);

    const recomputedRailMinutes = 3 + 14; // sg-branch-u->v (3) + sg-branch-v->dest via rl-branch-l (14)
    const recomputedWaitMinutes = OFFPEAK_WAIT_MINUTES; // one boarding, rl-branch-l used for both ride hops
    expect(recomputedRailMinutes + recomputedWaitMinutes + BRANCH_WALK_MINUTES).toBe(
      uState?.totalMinutes,
    );
  });
});

const WALK_TO_A = 20;
const WALK_TO_B = 3;

const MULTI_ACCESS_EDGES: RailEdgeRow[] = [
  {
    fromStationGroupId: "sg-p",
    toStationGroupId: "sg-stn-a",
    railLineId: "rl-pa",
    railLineName: "Line PA",
    edgeType: "ride",
    peakTravelMinutes: 10,
    offpeakTravelMinutes: 10,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
  {
    fromStationGroupId: "sg-p",
    toStationGroupId: "sg-stn-b",
    railLineId: "rl-pb",
    railLineName: "Line PB",
    edgeType: "ride",
    peakTravelMinutes: 12,
    offpeakTravelMinutes: 12,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
];

const A_AND_B_SEEDS = [
  { node: "sg-stn-a", walkMinutes: WALK_TO_A },
  { node: "sg-stn-b", walkMinutes: WALK_TO_B },
];

describe("reverseDijkstra is multi-source: the search itself picks the access station", () => {
  it("prefers the farther-by-rail access station when its walk to the destination is shorter", () => {
    const graph = buildGraph(MULTI_ACCESS_EDGES, "offpeak");
    const result = reverseDijkstra(graph, A_AND_B_SEEDS);

    const pState = result.get("sg-p");
    expect(pState?.totalMinutes).toBe(21);
    expect(pState?.railMinutes).toBe(12);
    expect(pState?.waitMinutes).toBe(OFFPEAK_WAIT_MINUTES);
    expect(pState?.destinationWalkMinutes).toBe(WALK_TO_B);
    expect(pState?.transferCount).toBe(0);

    expect(reconstructPath(result, "sg-p")).toEqual([
      { stationGroupId: "sg-p", railLineId: "rl-pb", edgeType: "ride" },
      { stationGroupId: "sg-stn-b", railLineId: null, edgeType: null },
    ]);
  });

  it("a seed's own cost is its walk to the destination, not zero", () => {
    const graph = buildGraph(MULTI_ACCESS_EDGES, "offpeak");
    const result = reverseDijkstra(graph, A_AND_B_SEEDS);

    expect(result.get("sg-stn-a")?.totalMinutes).toBe(WALK_TO_A);
    expect(result.get("sg-stn-a")?.destinationWalkMinutes).toBe(WALK_TO_A);
    expect(result.get("sg-stn-a")?.railMinutes).toBe(0);
    expect(result.get("sg-stn-b")?.totalMinutes).toBe(WALK_TO_B);
    expect(result.get("sg-stn-b")?.destinationWalkMinutes).toBe(WALK_TO_B);
  });

  it.each([
    ["worse duplicate last", [...A_AND_B_SEEDS, { node: "sg-stn-b", walkMinutes: 30 }]],
    ["worse duplicate first", [{ node: "sg-stn-b", walkMinutes: 30 }, ...A_AND_B_SEEDS]],
  ])("a duplicate seed with a worse walk cannot corrupt the result (%s)", (_label, seeds) => {
    const graph = buildGraph(MULTI_ACCESS_EDGES, "offpeak");
    const result = reverseDijkstra(graph, seeds);

    expect(result.get("sg-stn-b")?.totalMinutes).toBe(WALK_TO_B);
    expect(result.get("sg-p")?.totalMinutes).toBe(21);
    expect(result.get("sg-p")?.destinationWalkMinutes).toBe(WALK_TO_B);
  });

  it("a seed reachable more cheaply by rail than by its own walk takes the rail route", () => {
    const withTransfer: RailEdgeRow[] = [
      ...MULTI_ACCESS_EDGES,
      {
        fromStationGroupId: "sg-stn-a",
        toStationGroupId: "sg-stn-b",
        railLineId: null,
        railLineName: null,
        edgeType: "transfer",
        peakTravelMinutes: 2,
        offpeakTravelMinutes: 2,
        peakWaitMinutes: 0,
        offpeakWaitMinutes: 0,
        confidence: "high",
      },
    ];
    const graph = buildGraph(withTransfer, "offpeak");
    const result = reverseDijkstra(graph, A_AND_B_SEEDS);

    const aState = result.get("sg-stn-a");
    expect(aState?.totalMinutes).toBe(WALK_TO_B + 2 + TRANSFER_PENALTY_MINUTES);
    expect(aState?.destinationWalkMinutes).toBe(WALK_TO_B);
    expect(aState?.transferCount).toBe(1);
    expect(reconstructPath(result, "sg-stn-a")).toEqual([
      { stationGroupId: "sg-stn-a", railLineId: null, edgeType: "transfer" },
      { stationGroupId: "sg-stn-b", railLineId: null, edgeType: null },
    ]);
  });

  it("carries the destination walk verbatim through same-line, explicit-transfer and implicit-transfer hops", () => {
    const walkMinutes = 9;
    const graph = buildGraph(MAIN_EDGES, "offpeak");
    const state = reverseDijkstra(graph, [{ node: "sg-dest", walkMinutes }]).get("sg-a");

    expect(state?.railMinutes).toBe(19);
    expect(state?.waitMinutes).toBe(3 * OFFPEAK_WAIT_MINUTES);
    expect(state?.transferPenaltyMinutes).toBe(2 * TRANSFER_PENALTY_MINUTES);
    expect(state?.destinationWalkMinutes).toBe(walkMinutes);
    expect(state?.totalMinutes).toBe(47 + walkMinutes);
  });
});

describe("reverseDijkstra rejects seed lists it cannot search correctly", () => {
  const graph = buildGraph(MULTI_ACCESS_EDGES, "offpeak");

  it("throws on an empty seed list rather than reporting every node as disconnected", () => {
    expect(() => reverseDijkstra(graph, [])).toThrow(/must not be empty/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws on a non-finite walkMinutes (%p), which would otherwise make the seed vanish silently",
    (walkMinutes) => {
      expect(() => reverseDijkstra(graph, [{ node: "sg-stn-a", walkMinutes }])).toThrow(
        /non-finite walkMinutes/,
      );
    },
  );

  it("throws on a negative walkMinutes, which would break Dijkstra's settle-once guarantee", () => {
    expect(() => reverseDijkstra(graph, [{ node: "sg-stn-a", walkMinutes: -1 }])).toThrow(
      /negative walkMinutes/,
    );
  });

  it("validates every seed, not just the first", () => {
    expect(() =>
      reverseDijkstra(graph, [
        { node: "sg-stn-a", walkMinutes: 4 },
        { node: "sg-stn-b", walkMinutes: Number.NaN },
      ]),
    ).toThrow(/sg-stn-b/);
  });
});
