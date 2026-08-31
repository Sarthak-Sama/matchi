import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_EXPECTED_WAIT_MINUTES,
  MIN_EXPECTED_WAIT_MINUTES,
  OFFPEAK_WAIT_MINUTES,
  PEAK_WAIT_MINUTES,
} from "@tokyo/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { multiLineStringWKT, pointWKT } from "./fixtures/seed/geo.js";
import type { GtfsPlanInput } from "./import-transit/gtfs-plan.js";
import { buildGtfsPlan } from "./import-transit/gtfs-plan.js";
import { resolveGtfsSource } from "./import-transit/gtfs-source.js";
import {
  parseGtfsCalendar,
  parseGtfsCalendarDates,
  parseGtfsRoutes,
  parseGtfsStops,
  parseGtfsTrips,
  selectWeekdayServiceIds,
} from "./import-transit/gtfs-static.js";
import { streamRelevantStopTimes } from "./import-transit/gtfs-stop-times.js";
import { minutesOfDay, parseGtfsTime } from "./import-transit/gtfs-time.js";
import { mapRoutesToLines } from "./import-transit/route-line-mapping.js";
import type { CandidateStationGroup, ExistingGtfsRef } from "./import-transit/stop-matching.js";
import { matchStops } from "./import-transit/stop-matching.js";
import { writeTransferEdges } from "./import-transit/transfer-edges.js";
import {
  computeAdjacentPairStats,
  computeHeadways,
  directionKey,
  expectedWaitFromHeadway,
  median,
} from "./import-transit/travel-stats.js";
import { validateGraph } from "./import-transit/validate-graph.js";
import type { ImportTransitArgs, TransitImportResult } from "./import-transit.js";
import { parseArgs, runTransitImport } from "./import-transit.js";
import { runImport } from "./lib/import-run.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";
import { destructiveTestDatabaseUrl } from "./test-support/database-url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures/gtfs");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

describe("parseArgs", () => {
  it("accepts --gtfs alone", () => {
    expect(parseArgs(["--gtfs", "/tmp/feed"])).toEqual({
      gtfsPath: "/tmp/feed",
      fromTopology: false,
      sourceDate: undefined,
    });
  });

  it("accepts --from-topology alone", () => {
    expect(parseArgs(["--from-topology"])).toEqual({
      gtfsPath: undefined,
      fromTopology: true,
      sourceDate: undefined,
    });
  });

  it("rejects both flags together", () => {
    expect(() => parseArgs(["--gtfs", "/tmp/feed", "--from-topology"])).toThrow(/not both/);
  });

  it("rejects neither flag", () => {
    expect(() => parseArgs([])).toThrow(/no input given/);
  });

  it("parses --source-date", () => {
    const args = parseArgs(["--from-topology", "--source-date", "2026-01-01"]);
    expect(args.sourceDate).toBeInstanceOf(Date);
  });
});

describe("parseGtfsTime / minutesOfDay", () => {
  it("parses a normal time", () => {
    expect(parseGtfsTime("07:40:00", "t")).toBe(460);
  });

  it("preserves a post-midnight rollover past 24:00", () => {
    expect(parseGtfsTime("25:10:00", "t")).toBe(1510);
  });

  it("rejects a malformed time", () => {
    expect(() => parseGtfsTime("7:4", "t")).toThrow(/not a valid GTFS/);
  });

  it("wraps a rollover time back into 0-1439 for time-of-day comparisons", () => {
    expect(minutesOfDay(1510)).toBe(70);
    expect(minutesOfDay(460)).toBe(460);
  });
});

describe("selectWeekdayServiceIds", () => {
  it("excludes a weekend-only service and includes a Mon-Fri one", () => {
    const calendars = parseGtfsCalendar(fixture("calendar.txt"));
    const ids = selectWeekdayServiceIds(calendars, []);
    expect(ids.has("WKDY")).toBe(true);
    expect(ids.has("WKEND")).toBe(false);
  });

  it("falls back to calendar_dates.txt for a service with no calendar.txt row", () => {
    const ids = selectWeekdayServiceIds(
      [],
      [{ serviceId: "ADHOC", date: "20260302", exceptionType: 1 }],
    );
    expect(ids.has("ADHOC")).toBe(true);
  });

  it("does not select a calendar_dates-only service whose added dates are all weekend", () => {
    const ids = selectWeekdayServiceIds(
      [],
      [{ serviceId: "SPECIAL", date: "20260307", exceptionType: 1 }],
    );
    expect(ids.has("SPECIAL")).toBe(false);
  });
});

describe("median", () => {
  it("computes the middle value for an odd-length array", () => {
    expect(median([6, 4, 5])).toBe(5);
  });

  it("averages the two middle values for an even-length array", () => {
    expect(median([2, 3])).toBe(2.5);
  });

  it("throws on an empty array", () => {
    expect(() => median([])).toThrow(/empty/);
  });
});

describe("expectedWaitFromHeadway", () => {
  it("halves a mid-range headway with no clamping", () => {
    expect(expectedWaitFromHeadway(10)).toBe(5);
  });

  it("clamps to MIN_EXPECTED_WAIT_MINUTES for a very short headway", () => {
    expect(expectedWaitFromHeadway(1)).toBe(MIN_EXPECTED_WAIT_MINUTES);
    expect(MIN_EXPECTED_WAIT_MINUTES).toBe(1);
  });

  it("clamps to MAX_EXPECTED_WAIT_MINUTES for a very long headway", () => {
    expect(expectedWaitFromHeadway(40)).toBe(MAX_EXPECTED_WAIT_MINUTES);
    expect(MAX_EXPECTED_WAIT_MINUTES).toBe(15);
  });
});

describe("directionKey / pairMapKey collision guard", () => {
  it("directionKey does not collide across a naive-concatenation boundary shift", () => {
    const a = directionKey("AB", "C");
    const b = directionKey("A", "BC");
    expect(a).not.toBe(b);
  });

  it("computeAdjacentPairStats keeps two boundary-shifted (route, firstStop, from, to) tuples distinct", () => {
    const trip1 = { tripId: "t1", routeId: "AB", serviceId: "s" };
    const stopTimes1 = [
      { tripId: "t1", stopId: "C", stopSequence: 1, arrivalMinutes: 360, departureMinutes: 360 },
      { tripId: "t1", stopId: "X", stopSequence: 2, arrivalMinutes: 370, departureMinutes: 370 },
    ];

    const trip2 = { tripId: "t2", routeId: "A", serviceId: "s" };
    const stopTimes2 = [
      { tripId: "t2", stopId: "BC", stopSequence: 1, arrivalMinutes: 360, departureMinutes: 360 },
      { tripId: "t2", stopId: "C", stopSequence: 2, arrivalMinutes: 365, departureMinutes: 365 },
      { tripId: "t2", stopId: "X", stopSequence: 3, arrivalMinutes: 367, departureMinutes: 367 },
    ];

    const stopTimesByTrip = new Map([
      ["t1", stopTimes1],
      ["t2", stopTimes2],
    ]);
    const stats = computeAdjacentPairStats([trip1, trip2], stopTimesByTrip);

    const fromAB = stats.find(
      (s) =>
        s.routeId === "AB" && s.firstStopId === "C" && s.fromStopId === "C" && s.toStopId === "X",
    );
    const fromA = stats.find(
      (s) =>
        s.routeId === "A" && s.firstStopId === "BC" && s.fromStopId === "C" && s.toStopId === "X",
    );

    expect(fromAB).toBeDefined();
    expect(fromA).toBeDefined();
    expect(fromAB?.offpeakMinutes).toBe(10);
    expect(fromAB?.offpeakSampleCount).toBe(1);
    expect(fromA?.offpeakMinutes).toBe(2);
    expect(fromA?.offpeakSampleCount).toBe(1);
  });
});

async function loadFixtureGtfs(): Promise<{
  stops: ReturnType<typeof parseGtfsStops>;
  routes: ReturnType<typeof parseGtfsRoutes>;
  trips: ReturnType<typeof parseGtfsTrips>;
  stopTimesByTrip: Awaited<ReturnType<typeof streamRelevantStopTimes>>;
}> {
  const stops = parseGtfsStops(fixture("stops.txt"));
  const routes = parseGtfsRoutes(fixture("routes.txt"));
  const allTrips = parseGtfsTrips(fixture("trips.txt"));
  const calendars = parseGtfsCalendar(fixture("calendar.txt"));
  const calendarDates = parseGtfsCalendarDates("");
  const weekdayIds = selectWeekdayServiceIds(calendars, calendarDates);
  const trips = allTrips.filter((t) => weekdayIds.has(t.serviceId));
  const stopTimesByTrip = await streamRelevantStopTimes(
    fixturePath("stop_times.txt"),
    new Set(trips.map((t) => t.tripId)),
  );
  return { stops, routes, trips, stopTimesByTrip };
}

describe("computeAdjacentPairStats / computeHeadways (fixture)", () => {
  it("computes the hand-checked Shibuya->Daikanyama median, peak and off-peak, excluding the weekend trip", async () => {
    const { trips, stopTimesByTrip } = await loadFixtureGtfs();
    const stats = computeAdjacentPairStats(trips, stopTimesByTrip);
    const pair = stats.find(
      (s) => s.fromStopId === "gtfs-shibuya" && s.toStopId === "gtfs-daikanyama",
    );
    expect(pair).toBeDefined();

    expect(pair?.peakMinutes).toBe(5);
    expect(pair?.peakSampleCount).toBe(3);

    expect(pair?.offpeakMinutes).toBe(2.5);
    expect(pair?.offpeakSampleCount).toBe(2);
  });

  it("computes the hand-checked headway/expected-wait for the Shibuya-first-stop direction", async () => {
    const { trips, stopTimesByTrip } = await loadFixtureGtfs();
    const headways = computeHeadways(trips, stopTimesByTrip);
    const forward = headways.find((h) => h.routeId === "R1" && h.firstStopId === "gtfs-shibuya");
    expect(forward).toBeDefined();

    expect(forward?.peakWaitMinutes).toBe(5);

    expect(forward?.offpeakWaitMinutes).toBe(10);
  });

  it("leaves a period's headway undefined when fewer than 2 departures exist in it", async () => {
    const { trips, stopTimesByTrip } = await loadFixtureGtfs();
    const headways = computeHeadways(trips, stopTimesByTrip);

    const backward = headways.find(
      (h) => h.routeId === "R1" && h.firstStopId === "gtfs-nakameguro",
    );
    expect(backward).toBeDefined();
    expect(backward?.peakWaitMinutes).toBeDefined();
    expect(backward?.offpeakWaitMinutes).toBeUndefined();
  });
});

describe("matchStops", () => {
  const candidates: CandidateStationGroup[] = [
    { stationGroupId: "sg-a", nameJa: "Aoyama", nameEn: "Aoyama", lon: 139.72, lat: 35.67 },
  ];

  it("matches via an existing station_source_refs row, even when the name wouldn't match", () => {
    const stops = [
      {
        stopId: "child-1",
        name: "Totally Different Name",
        lat: 35.67,
        lon: 139.72,
        parentStation: "parent-1",
      },
      {
        stopId: "parent-1",
        name: "Totally Different Name",
        lat: 35.67,
        lon: 139.72,
        parentStation: undefined,
      },
    ];
    const existingRefs: ExistingGtfsRef[] = [{ sourceId: "parent-1", stationGroupId: "sg-a" }];
    const result = matchStops(stops, existingRefs, []);
    expect(result.matchedStopToGroup.get("child-1")).toBe("sg-a");
    expect(result.matchedStopToGroup.get("parent-1")).toBe("sg-a");
    expect(result.newRefs).toEqual([]);
    expect(result.unmatchedRefKeys).toEqual([]);
  });

  it("falls back to normalized-name + proximity matching when there is no existing ref", () => {
    const stops = [
      {
        stopId: "s1",
        name: "Aoyama Station",
        lat: 35.6701,
        lon: 139.7201,
        parentStation: undefined,
      },
    ];
    const result = matchStops(stops, [], candidates);
    expect(result.matchedStopToGroup.get("s1")).toBe("sg-a");
    expect(result.newRefs).toEqual([{ sourceId: "s1", stationGroupId: "sg-a" }]);
  });

  it("does not match a same-named candidate outside STATION_MERGE_RADIUS_M", () => {
    const farStop = [
      { stopId: "s2", name: "Aoyama", lat: 36.5, lon: 140.5, parentStation: undefined },
    ];
    const result = matchStops(farStop, [], candidates);
    expect(result.matchedStopToGroup.has("s2")).toBe(false);
    expect(result.unmatchedRefKeys).toEqual(["s2"]);
  });

  it("reports an unmatched stop (no ref, no name/proximity match) in the unmatched summary", () => {
    const stops = [
      { stopId: "ghost", name: "Nowhere Station", lat: 10, lon: 10, parentStation: undefined },
    ];
    const result = matchStops(stops, [], candidates);
    expect(result.unmatchedRefKeys).toEqual(["ghost"]);
    expect(result.matchedStopToGroup.size).toBe(0);
    expect(result.totalRefKeys).toBe(1);
  });
});

describe("mapRoutesToLines", () => {
  it("maps a route whose route_id equals an existing rail_line_id", () => {
    const { mapped, unmapped } = mapRoutesToLines(
      [{ routeId: "rl-toyoko", shortName: undefined, longName: undefined }],
      [{ railLineId: "rl-toyoko", nameJa: "東急東横線", nameEn: "Tokyu Toyoko Line" }],
    );
    expect(mapped.get("rl-toyoko")).toBe("rl-toyoko");
    expect(unmapped).toEqual([]);
  });

  it("falls back to a case-insensitive name match", () => {
    const { mapped } = mapRoutesToLines(
      [{ routeId: "R99", shortName: undefined, longName: "tokyu toyoko line" }],
      [{ railLineId: "rl-toyoko", nameJa: "東急東横線", nameEn: "Tokyu Toyoko Line" }],
    );
    expect(mapped.get("R99")).toBe("rl-toyoko");
  });

  it("reports a route with no id or name match as unmapped, never fabricating a null-line mapping", () => {
    const { mapped, unmapped } = mapRoutesToLines(
      [{ routeId: "R-unknown", shortName: "???", longName: undefined }],
      [{ railLineId: "rl-toyoko", nameJa: "東急東横線", nameEn: "Tokyu Toyoko Line" }],
    );
    expect(mapped.has("R-unknown")).toBe(false);
    expect(unmapped).toEqual(["R-unknown"]);
  });
});

describe("resolveGtfsSource", () => {
  it("passes a directory through unchanged, with a no-op cleanup", async () => {
    const resolved = await resolveGtfsSource(FIXTURES_DIR);
    expect(resolved.dir).toBe(FIXTURES_DIR);
    await expect(resolved.cleanup()).resolves.toBeUndefined();
  });

  it("throws a clear error for a path that does not exist", async () => {
    await expect(resolveGtfsSource("/no/such/path/at/all")).rejects.toThrow(/does not exist/);
  });

  it("throws a clear error for a file that is neither a directory nor a .zip", async () => {
    await expect(resolveGtfsSource(fixturePath("stops.txt"))).rejects.toThrow(
      /neither a directory nor a \.zip file/,
    );
  });

  const hasZipBinary = (() => {
    try {
      execFileSync("zip", ["-v"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasZipBinary)(
    "extracts a real .zip archive (via the system unzip binary) and cleans up the temp dir afterward",
    async () => {
      const zipPath = path.join(tmpdir(), `tokyo-gtfs-fixture-${String(process.pid)}.zip`);
      execFileSync("zip", [
        "-j",
        "-q",
        zipPath,
        fixturePath("stops.txt"),
        fixturePath("routes.txt"),
      ]);
      try {
        const resolved = await resolveGtfsSource(zipPath);
        expect(resolved.dir).not.toBe(FIXTURES_DIR);
        const extracted = readFileSync(path.join(resolved.dir, "stops.txt"), "utf8");
        expect(extracted).toBe(fixture("stops.txt"));

        await resolved.cleanup();
        expect(existsSync(resolved.dir)).toBe(false);
      } finally {
        await rm(zipPath, { force: true });
      }
    },
  );
});

describe("buildGtfsPlan (fixture)", () => {
  async function buildFixturePlan() {
    const { stops, routes, trips, stopTimesByTrip } = await loadFixtureGtfs();
    const candidateGroups: CandidateStationGroup[] = [
      {
        stationGroupId: "cand-shibuya",
        nameJa: "Shibuya",
        nameEn: "Shibuya",
        lon: 139.7016,
        lat: 35.658,
      },
      {
        stationGroupId: "cand-daikanyama",
        nameJa: "Daikanyama",
        nameEn: "Daikanyama",
        lon: 139.7031,
        lat: 35.6486,
      },
      {
        stationGroupId: "cand-nakameguro",
        nameJa: "Nakameguro",
        nameEn: "Nakameguro",
        lon: 139.696,
        lat: 35.642,
      },

      {
        stationGroupId: "cand-shinjuku-real",
        nameJa: "ShinjukuXYZ",
        nameEn: "ShinjukuXYZ",
        lon: 139.7006,
        lat: 35.6896,
      },
    ];
    const existingRefs: ExistingGtfsRef[] = [
      { sourceId: "gtfs-shinjuku", stationGroupId: "cand-shinjuku-real" },
    ];
    const railLines = [
      { railLineId: "R1", nameJa: "Fixture Line One", nameEn: null },
      { railLineId: "R2", nameJa: "Fixture Line Two", nameEn: null },
    ];

    const input: GtfsPlanInput = {
      stops,
      routes,
      trips,
      stopTimesByTrip,
      existingRefs,
      candidateGroups,
      railLines,
    };
    return buildGtfsPlan(input);
  }

  it("matches 4 of 5 stations, leaving the unreachable ghost stop unmatched (exactly 20%, not aborting)", async () => {
    const plan = await buildFixturePlan();
    expect(plan.totalRefKeys).toBe(5);
    expect(plan.unmatchedRefKeys).toEqual(["gtfs-ghost"]);
    const unmatchedShare = plan.unmatchedRefKeys.length / plan.totalRefKeys;
    expect(unmatchedShare).toBe(0.2);
  });

  it("writes new station_source_refs only for name/proximity matches, not the ref-based one", async () => {
    const plan = await buildFixturePlan();
    expect(plan.newRefs).toHaveLength(3);
    expect(new Set(plan.newRefs.map((r) => r.sourceId))).toEqual(
      new Set(["gtfs-shibuya", "gtfs-daikanyama", "gtfs-nakameguro"]),
    );
  });

  it("maps both fixture routes and writes the 4 matched-stop ride edges with plausible minutes", async () => {
    const plan = await buildFixturePlan();
    expect(plan.unmappedRouteIds).toEqual([]);
    expect(plan.edges).toHaveLength(4);
    for (const edge of plan.edges) {
      expect(edge.confidence).toBe("high");
      expect(edge.railLineId).toBe("R1");
      expect(edge.peakTravelMinutes).toBeGreaterThan(0);
      expect(edge.offpeakTravelMinutes).toBeGreaterThan(0);
    }

    const forward = plan.edges.find(
      (e) => e.fromStationGroupId === "cand-shibuya" && e.toStationGroupId === "cand-daikanyama",
    );
    expect(forward).toMatchObject({
      peakTravelMinutes: 5,
      offpeakTravelMinutes: 2.5,
      peakWaitMinutes: 5,
      offpeakWaitMinutes: 10,
    });

    const backward = plan.edges.find(
      (e) => e.fromStationGroupId === "cand-daikanyama" && e.toStationGroupId === "cand-shibuya",
    );

    expect(backward?.peakTravelMinutes).toBe(backward?.offpeakTravelMinutes);
  });

  it("warns about the unmatched-stop edge skip and the off-peak-fallback, but never writes a null-line edge", async () => {
    const plan = await buildFixturePlan();
    expect(plan.warnings.some((w) => w.includes("skipped because one or"))).toBe(true);
    expect(plan.warnings.some((w) => w.includes("no off-peak samples"))).toBe(true);
    expect(
      plan.edges.every((e) => typeof e.railLineId === "string" && e.railLineId.length > 0),
    ).toBe(true);
  });
});

describe("GTFS bulk tables are never persisted", () => {
  it("no import-transit source module contains a SQL write to trips/stop_times/calendar/calendar_dates", () => {
    const srcDir = __dirname;
    const filesToCheck = [
      "import-transit.ts",
      "import-transit/gtfs-plan.ts",
      "import-transit/fallback-topology.ts",
      "import-transit/transfer-edges.ts",
      "import-transit/gtfs-stop-times.ts",
    ];
    const forbidden = /INSERT\s+INTO\s+(trips|stop_times|calendar|calendar_dates)\b/i;
    for (const file of filesToCheck) {
      const content = readFileSync(path.join(srcDir, file), "utf8");
      expect(content).not.toMatch(forbidden);
    }
  });

  it("no migration creates a trips/stop_times/calendar/calendar_dates table", () => {
    const migrationsDir = path.resolve(__dirname, "../../db/migrations");
    const files = [
      "0001_init.sql",
      "0002_geography_indexes.sql",
      "0003_land_price_used_fallback.sql",
      "0004_lifestyle_metrics.sql",
    ];
    const forbidden = /CREATE\s+TABLE\s+(trips|stop_times|calendar|calendar_dates)\b/i;
    for (const file of files) {
      const content = readFileSync(path.join(migrationsDir, file), "utf8");
      expect(content).not.toMatch(forbidden);
    }
  });
});

const databaseUrl = destructiveTestDatabaseUrl();

async function buildLineGeometryFromEdges(pool: Pool, railLineId: string): Promise<void> {
  const { rows: edgeRows } = await pool.query<{ from_id: string; to_id: string }>(
    `SELECT DISTINCT from_station_group_id AS from_id, to_station_group_id AS to_id
     FROM rail_edges WHERE rail_line_id = $1 AND edge_type = 'ride'`,
    [railLineId],
  );
  if (edgeRows.length === 0) return;

  const neighbors = new Map<string, Set<string>>();
  for (const e of edgeRows) {
    if (!neighbors.has(e.from_id)) neighbors.set(e.from_id, new Set());
    if (!neighbors.has(e.to_id)) neighbors.set(e.to_id, new Set());
    neighbors.get(e.from_id)?.add(e.to_id);
    neighbors.get(e.to_id)?.add(e.from_id);
  }

  const endpoint = [...neighbors.entries()].find(([, n]) => n.size === 1)?.[0];
  const start = endpoint ?? [...neighbors.keys()][0];
  if (start === undefined) return;

  const orderedIds: string[] = [start];
  const visited = new Set([start]);
  let current = start;
  for (;;) {
    const next = [...(neighbors.get(current) ?? [])].find((n) => !visited.has(n));
    if (next === undefined) break;
    orderedIds.push(next);
    visited.add(next);
    current = next;
  }

  const { rows: pointRows } = await pool.query<{
    station_group_id: string;
    lon: number;
    lat: number;
  }>(
    `SELECT station_group_id, ST_X(point) AS lon, ST_Y(point) AS lat
     FROM station_groups WHERE station_group_id = ANY($1::text[])`,
    [orderedIds],
  );
  const byId = new Map(pointRows.map((r) => [r.station_group_id, [r.lon, r.lat] as const]));
  const orderedPoints = orderedIds
    .map((id) => byId.get(id))
    .filter((p): p is readonly [number, number] => !!p);
  if (orderedPoints.length < 2) return;

  const wkt = multiLineStringWKT([orderedPoints]);
  await pool.query(
    `UPDATE rail_lines SET geom = ST_SetSRID(ST_GeomFromText($1), 4326) WHERE rail_line_id = $2`,
    [wkt, railLineId],
  );
}

describe.runIf(Boolean(databaseUrl))("import:transit (DB integration)", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) return;
    await runMigrations({ dryRun: false });
    await runSeed();
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    if (!databaseUrl) return;

    await runSeed();
    await pool.end();
  });

  it("the trips/stop_times/calendar/calendar_dates tables genuinely do not exist in this schema", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('trips', 'stop_times', 'calendar', 'calendar_dates')`,
    );
    expect(rows).toEqual([]);
  });

  it("aborts (and rolls back) when this run's own mode produces zero ride edges, even though the whole-table graph is otherwise healthy", async () => {
    const { rows: geomRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM rail_lines WHERE geom IS NOT NULL`,
    );
    expect(Number(geomRows[0]?.count)).toBe(0);

    const args: ImportTransitArgs = { fromTopology: true };
    await expect(
      runImport({ source: "mlit-topology", pool }, (client) => runTransitImport(client, args)),
    ).rejects.toThrow(/produced 0 ride edges/);

    const { rows: afterRows } = await pool.query<{ source: string; count: string }>(
      `SELECT source, count(*)::text AS count FROM rail_edges GROUP BY source`,
    );
    expect(afterRows).toEqual([{ source: "seed", count: "44" }]);
  });

  it("--from-topology derives low-confidence edges with plausible minutes over the seeded rail lines", async () => {
    for (const line of [
      "rl-toyoko",
      "rl-yamanote",
      "rl-keio",
      "rl-inokashira",
      "rl-denentoshi",
      "rl-chuo",
      "rl-fukutoshin",
    ]) {
      await buildLineGeometryFromEdges(pool, line);
    }

    const args: ImportTransitArgs = { fromTopology: true };
    const result = (await runImport({ source: "mlit-topology", pool }, (client) =>
      runTransitImport(client, args),
    )) as TransitImportResult;

    expect(result.rideEdgesWritten).toBeGreaterThan(0);

    const { rows: edgeRows } = await pool.query<{
      peak_travel_minutes: number;
      offpeak_travel_minutes: number;
      confidence: string;
      peak_wait_minutes: number;
      offpeak_wait_minutes: number;
    }>(`SELECT peak_travel_minutes, offpeak_travel_minutes, confidence, peak_wait_minutes, offpeak_wait_minutes
        FROM rail_edges WHERE source = 'mlit-topology' AND edge_type = 'ride'`);
    expect(edgeRows.length).toBeGreaterThan(0);
    for (const row of edgeRows) {
      expect(row.confidence).toBe("low");

      expect(row.peak_travel_minutes).toBeGreaterThan(0);
      expect(row.peak_travel_minutes).toBeLessThan(60);
      expect(row.offpeak_travel_minutes).toBe(row.peak_travel_minutes);
      expect(row.peak_wait_minutes).toBe(PEAK_WAIT_MINUTES);
      expect(row.offpeak_wait_minutes).toBe(OFFPEAK_WAIT_MINUTES);
    }

    const { rows: seedCount } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM rail_edges WHERE source = 'seed'`,
    );
    expect(Number(seedCount[0]?.count)).toBeGreaterThan(0);

    const { rows: interchangeRows } = await pool.query<{ from_id: string; to_id: string }>(
      `SELECT from_station_group_id AS from_id, to_station_group_id AS to_id
       FROM rail_edges
       WHERE edge_type = 'transfer'
         AND from_station_group_id <> to_station_group_id
         AND from_station_group_id IN ('sg-nakameguro', 'sg-yutenji')
         AND to_station_group_id IN ('sg-nakameguro', 'sg-yutenji')`,
    );
    expect(interchangeRows.map((r) => `${r.from_id}->${r.to_id}`).sort()).toEqual([
      "sg-nakameguro->sg-yutenji",
      "sg-yutenji->sg-nakameguro",
    ]);
  });

  it("writes a transfer edge exactly once per direction between two close-but-distinct station_groups, and none elsewhere", async () => {
    await pool.query(
      `INSERT INTO station_groups (station_group_id, name_ja, name_en, point, source)
       VALUES
         ('sg-test-interchange-a', 'テスト接続A', 'Test Interchange A', ST_SetSRID(ST_GeomFromText($1), 4326), 'test-fixture'),
         ('sg-test-interchange-b', 'テスト接続B', 'Test Interchange B', ST_SetSRID(ST_GeomFromText($2), 4326), 'test-fixture')`,
      [pointWKT([139.75, 35.7]), pointWKT([139.7515, 35.7008])],
    );

    const client = await pool.connect();
    try {
      const written = await writeTransferEdges(client, "mlit-topology", null);
      expect(written).toBeGreaterThanOrEqual(2);

      const { rows } = await pool.query<{
        from_id: string;
        to_id: string;
        peak_travel_minutes: number;
        confidence: string;
        rail_line_id: string | null;
      }>(
        `SELECT from_station_group_id AS from_id, to_station_group_id AS to_id, peak_travel_minutes, confidence, rail_line_id
         FROM rail_edges
         WHERE edge_type = 'transfer'
           AND from_station_group_id IN ('sg-test-interchange-a', 'sg-test-interchange-b')
           AND to_station_group_id IN ('sg-test-interchange-a', 'sg-test-interchange-b')`,
      );
      expect(rows).toHaveLength(2);
      const pairs = rows.map((r) => `${r.from_id}->${r.to_id}`).sort();
      expect(pairs).toEqual([
        "sg-test-interchange-a->sg-test-interchange-b",
        "sg-test-interchange-b->sg-test-interchange-a",
      ]);
      for (const row of rows) {
        expect(row.peak_travel_minutes).toBe(0);
        expect(row.confidence).toBe("medium");
        expect(row.rail_line_id).toBeNull();
      }

      await writeTransferEdges(client, "mlit-topology", null);
      const { rows: rowsAfter } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rail_edges
         WHERE edge_type = 'transfer'
           AND from_station_group_id IN ('sg-test-interchange-a', 'sg-test-interchange-b')
           AND to_station_group_id IN ('sg-test-interchange-a', 'sg-test-interchange-b')`,
      );
      expect(Number(rowsAfter[0]?.count)).toBe(2);
    } finally {
      client.release();
      await pool.query(
        `DELETE FROM rail_edges WHERE from_station_group_id IN ('sg-test-interchange-a', 'sg-test-interchange-b')
           OR to_station_group_id IN ('sg-test-interchange-a', 'sg-test-interchange-b')`,
      );
      await pool.query(
        `DELETE FROM station_groups WHERE station_group_id IN ('sg-test-interchange-a', 'sg-test-interchange-b')`,
      );
    }
  });

  it("validateGraph aborts when the minimum edge count isn't met", async () => {
    const client = await pool.connect();
    try {
      await expect(validateGraph(client, { minEdges: 1_000_000 })).rejects.toThrow(
        /below the configured minimum/,
      );
    } finally {
      client.release();
    }
  });
});

describe("import:transit", () => {
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "import-transit.test.ts: DATABASE_URL is not set; skipping PostGIS integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});
