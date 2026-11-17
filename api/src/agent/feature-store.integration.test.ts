import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { buildGraphs } from "../domain/transit/graph.js";
import { loadRailEdges } from "../domain/transit/loader.js";
import { createComputeAnchorTimes } from "./anchor-times.js";
import { loadFeatureStore } from "./feature-store.js";

// Read-only. Runs only when DATABASE_URL points at a local database.
// The repo-wide vitest guard also requires ALLOW_DESTRUCTIVE_TESTS=1 for a non-_test database name.
const url = process.env["DATABASE_URL"] ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!isLocal)("loadFeatureStore against the local database", () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  afterAll(() => pool.end());

  it("loads 937 localities, the model params and column comments", async () => {
    const store = await loadFeatureStore(pool);
    expect(store.areas).toHaveLength(937);
    expect(store.areaIndex.size).toBe(937);
    expect(store.params.rentElasticity).toBeGreaterThan(0.3);
    expect(store.params.rentElasticity).toBeLessThan(0.4);
    expect(Object.keys(store.columnComments).length).toBeGreaterThan(40);
    expect(store.columnComments["locality_id"]).toBeTruthy();
    expect(typeof store.areas[0]!.lat).toBe("number");
  });

  it("routes a real station anchor to every area (Shinjuku, peak)", async () => {
    const store = await loadFeatureStore(pool);
    const station = await pool.query(
      `SELECT station_group_id FROM public.station_groups WHERE name_ja = '新宿' ORDER BY station_group_id LIMIT 1`,
    );
    const stationId = station.rows[0]?.station_group_id as string | undefined;
    expect(stationId).toBeTruthy();
    const compute = createComputeAnchorTimes({ pool, graphs: buildGraphs(await loadRailEdges(pool)) });
    const { times, refused } = await compute(
      [{ id: "work", label: "Work", stationId: stationId!, tripsPerWeek: 5, period: "peak" }],
      store.areas,
    );
    expect(refused).toEqual([]);
    const t = times["work"]!;
    expect(t).toHaveLength(store.areas.length);
    const finite = Array.from(t).filter(Number.isFinite);
    expect(finite.length).toBeGreaterThan(store.areas.length * 0.8);
    expect(Math.min(...finite)).toBeGreaterThan(0);
  }, 60_000);
});
