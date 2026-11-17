import type { Anchor, AreaFeatures } from "@tokyo/shared";
import { describe, expect, it, vi } from "vitest";

import type { DbPool } from "../db.js";
import type { RailEdgeRow } from "../domain/transit/graph.js";
import { emptyGraphs, graphsFromEdges } from "../test-support/fixtures.js";
import { createComputeAnchorTimes } from "./anchor-times.js";

const edge = (from: string, to: string): RailEdgeRow => ({
  fromStationGroupId: from,
  toStationGroupId: to,
  railLineId: "L1",
  railLineName: "Line 1",
  edgeType: "ride",
  peakTravelMinutes: from === "A" ? 4 : 3,
  offpeakTravelMinutes: from === "A" ? 6 : 5,
  peakWaitMinutes: 4,
  offpeakWaitMinutes: 6,
  confidence: "high",
});
const graphs = graphsFromEdges([edge("A", "B"), edge("B", "C")]);

const areas = [{ locality_id: "x" }, { locality_id: "y" }] as AreaFeatures[];

// Locality x has one sample at station A (5 min walk); y has no samples.
function stubPool(opts: { stationPoint?: { lat: number | null; lon: number | null } | null; accessRows?: unknown[] } = {}) {
  const stationPoint = opts.stationPoint === undefined ? { lat: 35.0, lon: 139.0 } : opts.stationPoint;
  const query = vi.fn(async (text: string) => {
    if (text.includes("locality_samples")) {
      return {
        rows: [
          {
            localityId: "x",
            sampleNumber: 1,
            lat: 36.5,
            lon: 140.5,
            stations: [{ stationGroupId: "A", walkMinutes: 5, rank: 1 }],
          },
        ],
      };
    }
    if (text.includes("station_group_id = $1")) return { rows: stationPoint === null ? [] : [stationPoint] };
    if (text.includes("ST_DWithin")) return { rows: opts.accessRows ?? [] };
    throw new Error(`unexpected query: ${text}`);
  });
  return { query } as DbPool & { query: typeof query };
}

const anchor = (over: Partial<Anchor> = {}): Anchor => ({
  id: "work",
  label: "Work",
  stationId: "C",
  tripsPerWeek: 5,
  period: "peak",
  ...over,
});

describe("createComputeAnchorTimes", () => {
  it("returns minutes aligned to areas, NaN where no sample can route (peak)", async () => {
    const compute = createComputeAnchorTimes({ pool: stubPool(), graphs });
    const { times, refused } = await compute([anchor()], areas);
    expect(refused).toEqual([]);
    const t = times["work"]!;
    expect(t).toHaveLength(2);
    // rail C<-B (3+4 wait) + B<-A (4) = 11, +8 default access walk, -8 +5 sample walk
    expect(t[0]).toBe(16);
    expect(Number.isNaN(t[1]!)).toBe(true);
  });

  it("uses the offpeak graph for offpeak anchors", async () => {
    const compute = createComputeAnchorTimes({ pool: stubPool(), graphs });
    const { times } = await compute([anchor({ period: "offpeak" })], areas);
    expect(times["work"]![0]).toBe(5 + 6 + 6 + 5);
  });

  it("caches per areas array and target", async () => {
    const pool = stubPool();
    const compute = createComputeAnchorTimes({ pool, graphs });
    const first = await compute([anchor()], areas);
    const second = await compute([anchor({ id: "other" })], areas);
    expect(second.times["other"]).toBe(first.times["work"]);
    const sampleCalls = pool.query.mock.calls.filter(([text]) => text.includes("FROM public.locality_samples"));
    expect(sampleCalls).toHaveLength(1);
  });

  it("refuses unknown stations, points far from any station, and anchors with no target", async () => {
    const unknown = createComputeAnchorTimes({ pool: stubPool({ stationPoint: null }), graphs });
    expect((await unknown([anchor()], areas)).refused[0]).toMatchObject({ anchorId: "work", reason: "unknown_station" });

    const farPoint = createComputeAnchorTimes({ pool: stubPool(), graphs });
    const r1 = await farPoint([anchor({ stationId: undefined, point: { lat: 35, lon: 139 } })], areas);
    expect(r1.refused[0]).toMatchObject({ reason: "no_station_within_1500m" });
    expect(r1.times).toEqual({});

    const none = await farPoint([anchor({ stationId: undefined })], areas);
    expect(none.refused[0]).toMatchObject({ reason: "unknown_station" });
  });

  it("accepts a point with a station nearby", async () => {
    const pool = stubPool({ accessRows: [{ stationGroupId: "C", distanceM: 0 }] });
    const { times, refused } = await createComputeAnchorTimes({ pool, graphs })(
      [anchor({ stationId: undefined, point: { lat: 35, lon: 139 } })],
      areas,
    );
    expect(refused).toEqual([]);
    expect(times["work"]![0]).toBe(16);
  });

  it("refuses an anchor that reaches no area", async () => {
    // Station with no coordinates (so no walking) and not on any rail edge.
    const pool = stubPool({ stationPoint: { lat: null, lon: null } });
    const { times, refused } = await createComputeAnchorTimes({ pool, graphs })(
      [anchor({ stationId: "Z" })],
      areas,
    );
    expect(times).toEqual({});
    expect(refused[0]).toMatchObject({ reason: "outside_coverage" });
  });

  it("keeps good anchors when another is refused", async () => {
    const compute = createComputeAnchorTimes({ pool: stubPool(), graphs });
    const { times, refused } = await compute(
      [anchor(), anchor({ id: "bad", stationId: undefined })],
      areas,
    );
    expect(Object.keys(times)).toEqual(["work"]);
    expect(refused.map((r) => r.anchorId)).toEqual(["bad"]);
  });

  it("throws 503 when the transit graph is empty and anchors are given", async () => {
    const compute = createComputeAnchorTimes({ pool: stubPool(), graphs: emptyGraphs() });
    await expect(compute([anchor()], areas)).rejects.toMatchObject({ statusCode: 503 });
    await expect(compute([], areas)).resolves.toEqual({ times: {}, refused: [] });
  });
});
