import { describe, expect, it } from "vitest";

import { reverseDijkstra } from "../domain/transit/dijkstra.js";
import { buildGraphs } from "../domain/transit/graph.js";
import { localityCommute } from "./optimize.js";

const lookups = { stationNames: new Map([["a", { nameEn: "A", nameJa: "A" }], ["b", { nameEn: "B", nameJa: "B" }]]), lineNames: new Map([["line", "Line"]]) };
const graph = buildGraphs([{ fromStationGroupId: "a", toStationGroupId: "b", railLineId: "line", railLineName: "Line", edgeType: "ride", peakTravelMinutes: 20, offpeakTravelMinutes: 20, peakWaitMinutes: 0, offpeakWaitMinutes: 0, confidence: "high" }]).peak;

describe("localityCommute", () => {
  it("chooses direct walking nearby and rail for farther samples, then reports median and IQR", () => {
    const commute = localityCommute([
      { sampleNumber: 1, lat: 35.0, lon: 139.0, stations: [{ stationGroupId: "a", walkMinutes: 1, rank: 1 }] },
      { sampleNumber: 2, lat: 35.2, lon: 139.2, stations: [{ stationGroupId: "a", walkMinutes: 1, rank: 1 }] },
      { sampleNumber: 3, lat: 35.2, lon: 139.2, stations: [{ stationGroupId: "a", walkMinutes: 1, rank: 1 }] },
    ], { seeds: [{ node: "b", walkMinutes: 0 }], point: { lat: 35.0, lon: 139.0 } }, reverseDijkstra(graph, [{ node: "b", walkMinutes: 0 }]), lookups);

    expect(commute?.mode).toBe("transit"); // median of [walk, transit, transit]
    expect(commute?.rangeMinutes?.min).toBeLessThan(commute?.rangeMinutes?.max ?? 0);
    expect(commute?.totalMinutes).toBe(25);
  });
});
