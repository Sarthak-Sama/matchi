/**
 * `lib/access-stations.ts` tests.
 *
 * The metres -> minutes conversion is pure and tested directly. The
 * `ST_DWithin` query is the first PostGIS predicate in the API, so it gets
 * a real integration suite against the seeded database (guarded on
 * `DATABASE_URL`, same pattern as `optimize.test.ts`) rather than a fake
 * pool asserting on SQL text — a query that returns the wrong rows, or
 * silently swaps lat and lon, still "matches the string".
 */

import {
  MAX_DESTINATION_WALK_M,
  WALK_DETOUR_FACTOR,
  WALK_SPEED_M_PER_MIN,
} from "@tokyo/shared";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DbPool } from "../../db.js";
import { findAccessStations, walkMinutesForMetres } from "./access-stations.js";

describe("walkMinutesForMetres", () => {
  it("is zero for a destination on top of the station", () => {
    expect(walkMinutesForMetres(0)).toBe(0);
  });

  it("applies the detour factor before the walking speed, then rounds UP to a whole minute", () => {
    // 800 straight-line metres -> 800 * 1.3 = 1040 walked metres
    // -> 1040 / 80 = exactly 13 minutes (no rounding needed).
    expect(walkMinutesForMetres(800)).toBe(13);
    // 80 m -> 104 m walked -> 1.3 min -> rounded UP to 2, the way a
    // Japanese listing states 徒歩○分.
    expect(walkMinutesForMetres(80)).toBe(2);
  });

  it("never understates: the rounded value is always >= the raw walk", () => {
    for (const metres of [1, 37, 199, 640, 1234, MAX_DESTINATION_WALK_M]) {
      const raw = (metres * WALK_DETOUR_FACTOR) / WALK_SPEED_M_PER_MIN;
      expect(walkMinutesForMetres(metres)).toBeGreaterThanOrEqual(raw);
      expect(walkMinutesForMetres(metres) - raw).toBeLessThan(1);
    }
  });

  it("caps the destination-side walk at about 25 minutes at the search radius", () => {
    expect(walkMinutesForMetres(MAX_DESTINATION_WALK_M)).toBe(25);
  });
});

describe("findAccessStations (query shape)", () => {
  it("binds lon as $1 and lat as $2 — ST_MakePoint takes X (lon) FIRST", async () => {
    // The classic PostGIS foot-gun: ST_MakePoint(x, y) is (lon, lat), not
    // (lat, lon). Transposing them puts a Tokyo office in the Indian Ocean
    // and quietly returns zero access stations.
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await findAccessStations(pool, { lat: 35.658, lon: 139.7016 });

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
      139.7016,
      35.658,
      MAX_DESTINATION_WALK_M,
    ]);
  });

  it("converts each row's distance to that seed's own walk", async () => {
    const pool: DbPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { stationGroupId: "sg-a", distanceM: 0 },
          { stationGroupId: "sg-b", distanceM: 800 },
        ],
      }),
    };

    await expect(findAccessStations(pool, { lat: 35.658, lon: 139.7016 })).resolves.toEqual([
      { node: "sg-a", walkMinutes: 0 },
      { node: "sg-b", walkMinutes: 13 },
    ]);
  });

  it("returns an empty array rather than throwing when nothing is in range", async () => {
    // The caller (POST /v1/optimize) is what turns this into a typed
    // NO_ACCESS_STATIONS 400 — see resolveDestinationSeeds.
    const pool: DbPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(findAccessStations(pool, { lat: 35.0, lon: 145.0 })).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Integration — real PostGIS, real seeded station_groups.
// ---------------------------------------------------------------------------

const databaseUrl = process.env["DATABASE_URL"];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function runCli(script: string): void {
  execFileSync("npx", ["tsx", script], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

describe.runIf(Boolean(databaseUrl))("findAccessStations (integration)", () => {
  let pool: Pool;

  beforeAll(() => {
    if (!databaseUrl) return;
    // Self-sufficient, like every other integration suite here: another
    // suite's TRUNCATE must not be able to make this one silently pass on
    // an empty table.
    runCli("scripts/src/migrate.ts");
    runCli("scripts/src/seed.ts");
    pool = new Pool({ connectionString: databaseUrl });
  }, 60_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.end();
  });

  it("resolves a point between Shibuya and Ebisu to BOTH, nearest first, each with its own walk", async () => {
    // Roughly halfway between sg-shibuya (139.7016, 35.6580) and
    // sg-ebisu (139.7101, 35.6480) — the exact case the feature exists
    // for: an office where the user would have to GUESS a station.
    const seeds = await findAccessStations(pool, { lat: 35.653, lon: 139.7059 });

    const ids = seeds.map((seed) => seed.node);
    expect(ids).toContain("sg-shibuya");
    expect(ids).toContain("sg-ebisu");

    // Every walk is real (non-zero, since the point is on no station) and
    // within the radius' cap.
    for (const seed of seeds) {
      expect(seed.walkMinutes).toBeGreaterThan(0);
      expect(seed.walkMinutes).toBeLessThanOrEqual(walkMinutesForMetres(MAX_DESTINATION_WALK_M));
    }

    // Nearest first.
    const walks = seeds.map((seed) => seed.walkMinutes);
    expect([...walks].sort((a, b) => a - b)).toEqual(walks);
  });

  it("gives a point exactly on a station a zero walk to that station", async () => {
    const seeds = await findAccessStations(pool, { lat: 35.658, lon: 139.7016 });
    expect(seeds[0]).toEqual({ node: "sg-shibuya", walkMinutes: 0 });
  });

  it("returns nothing for a point in the middle of the ocean", async () => {
    // ~500 km east of Tokyo, open Pacific.
    await expect(findAccessStations(pool, { lat: 35.0, lon: 145.0 })).resolves.toEqual([]);
  });

  it("excludes stations beyond MAX_DESTINATION_WALK_M rather than returning the whole table", async () => {
    const seeds = await findAccessStations(pool, { lat: 35.658, lon: 139.7016 });
    const total = (await pool.query("SELECT count(*)::int AS n FROM station_groups")) as {
      rows: { n: number }[];
    };

    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.length).toBeLessThan(total.rows[0]?.n ?? 0);
  });
});

describe("findAccessStations (integration)", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "access-stations.test.ts: DATABASE_URL is not set; skipping the ST_DWithin integration tests.",
      );
    },
  );
});
