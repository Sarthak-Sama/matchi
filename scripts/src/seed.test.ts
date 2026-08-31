import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATCHMENT_RADIUS_M } from "@tokyo/shared";

import { PINNED_POI_COUNTS } from "./fixtures/seed/index.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";
import { destructiveTestDatabaseUrl } from "./test-support/database-url.js";

const databaseUrl = destructiveTestDatabaseUrl();

const EXPECTED_ROW_COUNTS: Record<string, number> = {
  wards: 4,
  station_groups: 21,
  station_source_refs: 5,
  rail_lines: 7,
  rail_edges: 44,
  rent_stats: 5,
  land_prices: 78,
  zoning_areas: 6,
  pois: 225,
  major_roads: 4,
  green_spaces: 1,
};

const GEOMETRY_COLUMNS: readonly { table: string; column: string }[] = [
  { table: "wards", column: "geom" },
  { table: "station_groups", column: "point" },
  { table: "zoning_areas", column: "geom" },
  { table: "pois", column: "point" },
  { table: "major_roads", column: "geom" },
  { table: "land_prices", column: "point" },
  { table: "green_spaces", column: "geom" },
];

const ISOLATED_STATION = "sg-isolated-test";

describe.runIf(Boolean(databaseUrl))("seed", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) return;
    await runMigrations({ dryRun: false });
    pool = new Pool({ connectionString: databaseUrl });
    await runSeed();
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.end();
  });

  it("inserts the expected row count per seeded table", async () => {
    for (const [table, expected] of Object.entries(EXPECTED_ROW_COUNTS)) {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table}`,
      );
      expect(Number(rows[0]?.count), `row count of ${table}`).toBe(expected);
    }
  });

  it("every geometry is valid (ST_IsValid)", async () => {
    for (const { table, column } of GEOMETRY_COLUMNS) {
      const { rows } = await pool.query<{ invalid: string }>(
        `SELECT count(*)::text AS invalid FROM ${table} WHERE NOT ST_IsValid(${column})`,
      );
      expect(Number(rows[0]?.invalid), `invalid geometries in ${table}.${column}`).toBe(0);
    }
  });

  it("every station falls inside its declared ward via ST_Contains", async () => {
    const { rows: total } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM station_groups",
    );
    expect(Number(total[0]?.count)).toBe(21);

    const { rows: outside } = await pool.query<{ station_group_id: string }>(`
      SELECT sg.station_group_id
      FROM station_groups sg
      JOIN wards w ON w.ward_code = sg.ward_code
      WHERE NOT ST_Contains(w.geom, sg.point)
    `);
    expect(outside, "stations outside their declared ward").toEqual([]);
  });

  it("has the rail graph connected except for sg-isolated-test", async () => {
    const { rows: isolatedEdges } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM rail_edges
       WHERE from_station_group_id = $1 OR to_station_group_id = $1`,
      [ISOLATED_STATION],
    );
    expect(Number(isolatedEdges[0]?.count), "sg-isolated-test must have zero rail_edges").toBe(0);

    const { rows: unreached } = await pool.query<{ station_group_id: string }>(
      `
      WITH RECURSIVE reach(id) AS (
        SELECT station_group_id FROM station_groups WHERE station_group_id = 'sg-shibuya'
        UNION
        SELECT re.to_station_group_id FROM rail_edges re JOIN reach r ON re.from_station_group_id = r.id
      )
      SELECT sg.station_group_id
      FROM station_groups sg
      WHERE sg.station_group_id != $1
        AND sg.station_group_id NOT IN (SELECT id FROM reach)
      `,
      [ISOLATED_STATION],
    );
    expect(unreached, "real stations unreachable from sg-shibuya").toEqual([]);
  });

  it("pinned POI counts (fixtures/seed/pois.ts) match a live ST_DWithin count", async () => {
    const stationGroupIds = Object.keys(PINNED_POI_COUNTS);
    const { rows } = await pool.query<{ station_group_id: string; count: string }>(
      `SELECT sg.station_group_id, count(p.id)::text AS count
       FROM station_groups sg
       LEFT JOIN pois p ON ST_DWithin(p.point::geography, sg.point::geography, $2)
       WHERE sg.station_group_id = ANY($1)
       GROUP BY sg.station_group_id`,
      [stationGroupIds, CATCHMENT_RADIUS_M],
    );
    const actual = new Map(rows.map((r) => [r.station_group_id, Number(r.count)]));
    for (const [stationGroupId, expected] of Object.entries(PINNED_POI_COUNTS)) {
      expect(
        actual.get(stationGroupId),
        `live POI count within ${CATCHMENT_RADIUS_M}m of ${stationGroupId}`,
      ).toBe(expected);
    }
  });

  it("is idempotent: a second seed run leaves row counts unchanged", async () => {
    await runSeed();
    for (const [table, expected] of Object.entries(EXPECTED_ROW_COUNTS)) {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table}`,
      );
      expect(Number(rows[0]?.count), `row count of ${table} after second seed`).toBe(expected);
    }
  });
});

describe("seed", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "seed.test.ts: DATABASE_URL is not set; skipping PostGIS integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});
