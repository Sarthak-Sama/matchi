import { describe, expect, it } from "vitest";

import type { TopologyStation } from "./fallback-topology.js";
import { planLineLinks } from "./fallback-topology.js";

const YAMANOTE = "mlit-東日本旅客鉄道-山手線";
const RING_STATIONS = 29;

// An uneven ring of stations, roughly the size of the Yamanote line.
function ring(count: number): TopologyStation[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * (i + 0.3 * Math.sin(i))) / count;
    return {
      stationGroupId: `sg-${String(i)}`,
      nameJa: `駅${String(i)}`,
      lat: 35.68 + 0.05 * Math.sin(angle),
      lon: 139.7 + 0.04 * Math.cos(angle),
    };
  });
}

describe("planLineLinks", () => {
  it("closes the ring when the MST is combined with the loops override", () => {
    const stations = ring(RING_STATIONS);

    const links = planLineLinks(YAMANOTE, stations, stations, { loops: [YAMANOTE], ordered: {} });

    expect(links).toHaveLength(RING_STATIONS);
    const degree = new Map<string, number>();
    for (const { fromId, toId } of links) {
      degree.set(fromId, (degree.get(fromId) ?? 0) + 1);
      degree.set(toId, (degree.get(toId) ?? 0) + 1);
    }
    expect(degree.size).toBe(RING_STATIONS);
    expect([...degree.values()].every((d) => d === 2)).toBe(true);
  });

  it("leaves the MST open without the loops override", () => {
    const stations = ring(RING_STATIONS);

    const links = planLineLinks(YAMANOTE, stations, stations, { loops: [], ordered: {} });

    expect(links).toHaveLength(RING_STATIONS - 1);
  });
});
