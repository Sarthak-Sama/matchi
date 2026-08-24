import { ACCESS_WALK_MINUTES, COMMUTE_LABEL, OFFPEAK_WAIT_MINUTES } from "@tokyo/shared";
import { describe, expect, it } from "vitest";

import { estimateCommute } from "./commute.js";
import { reverseDijkstra } from "./dijkstra.js";
import { buildGraph } from "./graph.js";
import type { RailEdgeRow } from "./graph.js";

// A single direct ride edge: sg-origin3 -(rl-direct)-> sg-dest3.
const DIRECT_EDGE: RailEdgeRow[] = [
  {
    fromStationGroupId: "sg-origin3",
    toStationGroupId: "sg-dest3",
    railLineId: "rl-direct",
    railLineName: "Direct Line",
    edgeType: "ride",
    peakTravelMinutes: 5,
    offpeakTravelMinutes: 5,
    peakWaitMinutes: 0,
    offpeakWaitMinutes: 0,
    confidence: "high",
  },
];

describe("estimateCommute", () => {
  it("a direct one-hop journey: exact minutes including one boarding wait and the 8-minute access walk", () => {
    // By hand (offpeak, OFFPEAK_WAIT_MINUTES = 6, ACCESS_WALK_MINUTES = 8):
    //   railMinutes = 5, waitMinutes = 6 (one boarding), transferCount = 0.
    //   dijkstra totalMinutes = 5 + 6 = 11.
    //   estimateCommute totalMinutes = 11 + 8 (access walk) = 19.
    const graph = buildGraph(DIRECT_EDGE, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-dest3", walkMinutes: 0 }]);

    const estimate = estimateCommute(result, "sg-origin3");

    expect(estimate).not.toBeNull();
    expect(estimate?.railMinutes).toBe(5);
    expect(estimate?.waitMinutes).toBe(OFFPEAK_WAIT_MINUTES);
    expect(estimate?.transferCount).toBe(0);
    expect(estimate?.transferPenaltyMinutes).toBe(0);
    expect(estimate?.accessWalkMinutes).toBe(ACCESS_WALK_MINUTES);
    expect(estimate?.totalMinutes).toBe(19);
    expect(estimate?.label).toBe(COMMUTE_LABEL);
    expect(estimate?.confidence).toBe("high");
    expect(estimate?.path).toEqual([
      {
        stationGroupId: "sg-origin3",
        nameEn: "sg-origin3",
        nameJa: "sg-origin3",
        lineName: "rl-direct",
      },
      { stationGroupId: "sg-dest3", nameEn: "sg-dest3", nameJa: "sg-dest3", lineName: null },
    ]);
  });

  it("adds the access walk exactly once even across a multi-hop journey", () => {
    // sg-before3 -(rl-direct, 3min)-> sg-origin3 -(rl-direct, 5min)-> sg-dest3,
    // both hops on the SAME line -> one boarding wait, not two.
    // By hand (offpeak, OFFPEAK_WAIT_MINUTES = 6, ACCESS_WALK_MINUTES = 8):
    //   dijkstra totalMinutes = 3 + 5 + 6 = 14
    //   estimateCommute totalMinutes = 14 + 8 = 22
    const multiHop: RailEdgeRow[] = [
      ...DIRECT_EDGE,
      {
        fromStationGroupId: "sg-before3",
        toStationGroupId: "sg-origin3",
        railLineId: "rl-direct",
        railLineName: "Direct Line",
        edgeType: "ride",
        peakTravelMinutes: 3,
        offpeakTravelMinutes: 3,
        peakWaitMinutes: 0,
        offpeakWaitMinutes: 0,
        confidence: "high",
      },
    ];
    const graph = buildGraph(multiHop, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-dest3", walkMinutes: 0 }]);
    const dijkstraState = result.get("sg-before3");
    const estimate = estimateCommute(result, "sg-before3");

    expect(dijkstraState?.totalMinutes).toBe(14);
    expect(estimate?.totalMinutes).toBe(22);
  });

  it("returns null when the origin is unreachable (disconnected node)", () => {
    const graph = buildGraph(DIRECT_EDGE, "offpeak");
    const result = reverseDijkstra(graph, [{ node: "sg-dest3", walkMinutes: 0 }]);

    expect(estimateCommute(result, "sg-isolated-test")).toBeNull();
  });
});
