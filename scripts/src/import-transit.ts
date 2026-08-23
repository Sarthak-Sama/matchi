/**
 * `pnpm import:transit` — derives `rail_edges` (the commute engine's
 * entire routing graph, alongside `rail_lines`/`station_groups`) and any
 * new `station_source_refs` rows a GTFS feed's stops resolve to. This is
 * the last import script (Task 14) and the last backend task before the
 * deliberately minimal frontend.
 *
 * Two input modes, mutually exclusive:
 *
 *   pnpm import:transit --gtfs <dir-or-zip>     # real GTFS feed
 *   pnpm import:transit --from-topology         # rail_lines geometry only
 *
 * GTFS mode (`import-transit/gtfs-*.ts`, `stop-matching.ts`,
 * `route-line-mapping.ts`, `travel-stats.ts`, `gtfs-plan.ts`): reads
 * `stops.txt`/`routes.txt`/`trips.txt`/`calendar.txt`/
 * `calendar_dates.txt` fully into memory (all small) and STREAMS
 * `stop_times.txt` (GTFS's largest file by far — see
 * `gtfs-stop-times.ts`). Selects weekday services only, maps GTFS stops to
 * existing `station_groups` (via `station_source_refs` first, then
 * normalized-name + `STATION_MERGE_RADIUS_M` proximity, recording new refs
 * with `source = 'gtfs'`), computes median adjacent-stop travel times
 * (peak/off-peak) and headway-derived expected wait per route direction,
 * and writes `confidence = 'high'`, `source = 'gtfs'` ride edges. A GTFS
 * route this run cannot map to an existing `rail_lines` row is SKIPPED
 * ENTIRELY (never written with a null `rail_line_id` — see
 * `route-line-mapping.ts`'s doc comment for why that guard matters to
 * Task 8's router) and named in a loud warning. Stops that end up
 * unmatched are reported the same way, UNLESS more than 20% of the feed's
 * distinct stations are unmatched, which aborts the whole run.
 *
 * Fallback mode (`import-transit/fallback-topology.ts`): derives
 * `confidence = 'low'`, `source = 'mlit-topology'` ride edges purely from
 * `rail_lines.geom` + `station_groups.point`, for when a real GTFS feed
 * isn't available (this repo's own tests, or a live environment with no
 * ODPT credentials — both true "at test time" per this task's
 * constraints).
 *
 * Both modes then run the SAME two final steps: `writeTransferEdges`
 * (bidirectional `travel_minutes = 0` transfer edges between any two
 * DIFFERENT `station_groups` within `STATION_MERGE_RADIUS_M` — the
 * `TRANSFER_PENALTY_MINUTES` is applied once, by the router, never stored
 * here) and `validateGraph` (aborts if the WHOLE `rail_edges` table's
 * graph is too sparse, or too many `station_groups` end up with no edge at
 * all — a check on the table as a whole, not this run's own contribution).
 * Before either of those runs, `runTransitImport` separately aborts if
 * THIS RUN ITSELF wrote zero ride edges: `validateGraph`'s whole-table
 * check alone would let a run that mapped zero usable lines/routes still
 * report success on the strength of leftover seed/prior-import data, even
 * though `writeRideEdges`'s delete-then-upsert-on-this-source pattern just
 * silently wiped this source's own prior edges and replaced them with
 * nothing.
 *
 * `rail_edges` ride rows are upserted on the table's own natural key
 * (`from_station_group_id, to_station_group_id, rail_line_id, edge_type`),
 * then any `edge_type = 'ride'` row for THIS run's `source` not seen this
 * run is deleted — the same upsert-then-delete-stale shape as
 * `import:mlit`'s wards/stations/rail_lines, scoped so a GTFS run never
 * touches `mlit-topology` rows or vice versa (and neither ever touches
 * `seed`-sourced rows). Following the house pattern (Tasks 11-13):
 * everything above happens inside the `fn` passed to `runImport`
 * (`lib/import-run.ts`), so a bad feed or a failed validation rolls the
 * whole transaction back rather than leaving a partial graph.
 *
 * Never persisted anywhere: GTFS `trips`, `calendar`/`calendar_dates`, or
 * the full `stop_times` table — this script derives aggregate
 * medians/headways from them in memory and writes only the derived
 * `rail_edges` rows and `station_source_refs`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Confidence } from "@tokyo/shared";
import type { PoolClient } from "pg";

import { createPool } from "./lib/db.js";
import type { ImportResult } from "./lib/import-run.js";
import { runImport } from "./lib/import-run.js";
import { computeFallbackEdges } from "./import-transit/fallback-topology.js";
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
import type { CandidateStationGroup, ExistingGtfsRef } from "./import-transit/stop-matching.js";
import type { RailLineCandidate } from "./import-transit/route-line-mapping.js";
import { writeTransferEdges } from "./import-transit/transfer-edges.js";
import { validateGraph } from "./import-transit/validate-graph.js";

const GTFS_SOURCE = "gtfs";
const FALLBACK_SOURCE = "mlit-topology";

/** Sanity floor only — catches an empty/broken run, not a coverage target. */
const MIN_RAIL_EDGES = 1;

const MANUAL_GTFS_URL =
  "https://developer.odpt.org/ (Open Data Platform for Transportation in Tokyo — publishes GTFS " +
  "for Tokyo-area operators) or an individual operator's own open-data GTFS download. Save the " +
  "feed (directory of .txt files, or its .zip) and pass its path via --gtfs.";

export interface ImportTransitArgs {
  readonly gtfsPath?: string;
  readonly fromTopology: boolean;
  readonly sourceDate?: Date;
}

interface RideEdgeInput {
  readonly fromStationGroupId: string;
  readonly toStationGroupId: string;
  readonly railLineId: string;
  readonly edgeType: "ride";
  readonly peakTravelMinutes: number;
  readonly offpeakTravelMinutes: number;
  readonly peakWaitMinutes: number;
  readonly offpeakWaitMinutes: number;
  readonly confidence: Confidence;
}

/**
 * Upserts `edges` on the table's natural key, then deletes any
 * `edge_type = 'ride'` row for `source` not seen this run — the same
 * upsert-then-delete-stale shape `import:mlit` uses for wards/stations/
 * rail_lines (see this file's own module doc comment).
 */
async function writeRideEdges(
  client: PoolClient,
  source: string,
  sourceUpdatedAt: Date | null,
  edges: readonly RideEdgeInput[],
): Promise<number> {
  for (const e of edges) {
    await client.query(
      `INSERT INTO rail_edges
         (from_station_group_id, to_station_group_id, rail_line_id, edge_type,
          peak_travel_minutes, offpeak_travel_minutes, peak_wait_minutes, offpeak_wait_minutes,
          confidence, source, source_updated_at)
       VALUES ($1, $2, $3, 'ride', $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (from_station_group_id, to_station_group_id, rail_line_id, edge_type)
       DO UPDATE SET
         peak_travel_minutes = EXCLUDED.peak_travel_minutes,
         offpeak_travel_minutes = EXCLUDED.offpeak_travel_minutes,
         peak_wait_minutes = EXCLUDED.peak_wait_minutes,
         offpeak_wait_minutes = EXCLUDED.offpeak_wait_minutes,
         confidence = EXCLUDED.confidence,
         source = EXCLUDED.source,
         source_updated_at = EXCLUDED.source_updated_at,
         imported_at = now()`,
      [
        e.fromStationGroupId,
        e.toStationGroupId,
        e.railLineId,
        e.peakTravelMinutes,
        e.offpeakTravelMinutes,
        e.peakWaitMinutes,
        e.offpeakWaitMinutes,
        e.confidence,
        source,
        sourceUpdatedAt,
      ],
    );
  }

  const fromIds = edges.map((e) => e.fromStationGroupId);
  const toIds = edges.map((e) => e.toStationGroupId);
  const lineIds = edges.map((e) => e.railLineId);

  await client.query(
    `DELETE FROM rail_edges
     WHERE edge_type = 'ride'
       AND source = $4
       AND NOT EXISTS (
         SELECT 1 FROM unnest($1::text[], $2::text[], $3::text[]) AS seen(from_id, to_id, line_id)
         WHERE seen.from_id = rail_edges.from_station_group_id
           AND seen.to_id = rail_edges.to_station_group_id
           AND seen.line_id = rail_edges.rail_line_id
       )`,
    [fromIds, toIds, lineIds, source],
  );

  return edges.length;
}

async function fetchCandidateGroups(client: PoolClient): Promise<CandidateStationGroup[]> {
  const { rows } = await client.query<{
    station_group_id: string;
    name_ja: string;
    name_en: string;
    lon: number;
    lat: number;
  }>(
    `SELECT station_group_id, name_ja, name_en, ST_X(point) AS lon, ST_Y(point) AS lat FROM station_groups`,
  );
  return rows.map((r) => ({
    stationGroupId: r.station_group_id,
    nameJa: r.name_ja,
    nameEn: r.name_en,
    lon: r.lon,
    lat: r.lat,
  }));
}

async function fetchExistingGtfsRefs(client: PoolClient): Promise<ExistingGtfsRef[]> {
  const { rows } = await client.query<{ source_id: string; station_group_id: string }>(
    `SELECT source_id, station_group_id FROM station_source_refs WHERE source = $1`,
    [GTFS_SOURCE],
  );
  return rows.map((r) => ({ sourceId: r.source_id, stationGroupId: r.station_group_id }));
}

async function fetchRailLineCandidates(client: PoolClient): Promise<RailLineCandidate[]> {
  const { rows } = await client.query<{ rail_line_id: string; name_ja: string; name_en: string | null }>(
    `SELECT rail_line_id, name_ja, name_en FROM rail_lines`,
  );
  return rows.map((r) => ({ railLineId: r.rail_line_id, nameJa: r.name_ja, nameEn: r.name_en }));
}

async function readOptionalFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "";
    throw err;
  }
}

export interface TransitImportResult extends ImportResult {
  readonly rideEdgesWritten: number;
  readonly transferEdgesWritten: number;
  readonly newStationRefsWritten: number;
  readonly warnings: readonly string[];
}

async function runGtfsMode(
  client: PoolClient,
  gtfsPath: string,
  sourceUpdatedAt: Date | null,
): Promise<{ rideEdgesWritten: number; newStationRefsWritten: number; warnings: string[] }> {
  const resolved = await resolveGtfsSource(gtfsPath);
  try {
    const [stopsText, routesText, tripsText, calendarText, calendarDatesText] = await Promise.all([
      readFile(path.join(resolved.dir, "stops.txt"), "utf8"),
      readFile(path.join(resolved.dir, "routes.txt"), "utf8"),
      readFile(path.join(resolved.dir, "trips.txt"), "utf8"),
      readOptionalFile(path.join(resolved.dir, "calendar.txt")),
      readOptionalFile(path.join(resolved.dir, "calendar_dates.txt")),
    ]);

    const stops = parseGtfsStops(stopsText);
    const routes = parseGtfsRoutes(routesText);
    const allTrips = parseGtfsTrips(tripsText);
    const calendars = calendarText ? parseGtfsCalendar(calendarText) : [];
    const calendarDates = calendarDatesText ? parseGtfsCalendarDates(calendarDatesText) : [];

    const weekdayServiceIds = selectWeekdayServiceIds(calendars, calendarDates);
    const trips = allTrips.filter((t) => weekdayServiceIds.has(t.serviceId));

    const relevantTripIds = new Set(trips.map((t) => t.tripId));
    const stopTimesByTrip = await streamRelevantStopTimes(
      path.join(resolved.dir, "stop_times.txt"),
      relevantTripIds,
    );

    const [candidateGroups, existingRefs, railLines] = await Promise.all([
      fetchCandidateGroups(client),
      fetchExistingGtfsRefs(client),
      fetchRailLineCandidates(client),
    ]);

    const plan = buildGtfsPlan({
      stops,
      routes,
      trips,
      stopTimesByTrip,
      existingRefs,
      candidateGroups,
      railLines,
    });

    const unmatchedShare = plan.totalRefKeys > 0 ? plan.unmatchedRefKeys.length / plan.totalRefKeys : 0;
    if (unmatchedShare > 0.2) {
      throw new Error(
        `import:transit — ${String(plan.unmatchedRefKeys.length)} of ${String(plan.totalRefKeys)} ` +
          `GTFS stations (${(unmatchedShare * 100).toFixed(1)}%) could not be matched to an ` +
          `existing station_group, above the 20% limit: ${plan.unmatchedRefKeys.join(", ")}`,
      );
    }

    const warnings = [...plan.warnings];
    if (plan.unmatchedRefKeys.length > 0) {
      warnings.push(
        `${String(plan.unmatchedRefKeys.length)} GTFS station(s) could not be matched to an ` +
          `existing station_group and were skipped: ${plan.unmatchedRefKeys.join(", ")}`,
      );
    }

    for (const ref of plan.newRefs) {
      await client.query(
        `INSERT INTO station_source_refs (station_group_id, source, source_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (source, source_id) DO UPDATE SET station_group_id = EXCLUDED.station_group_id`,
        [ref.stationGroupId, GTFS_SOURCE, ref.sourceId],
      );
    }

    const rideEdgesWritten = await writeRideEdges(client, GTFS_SOURCE, sourceUpdatedAt, plan.edges);

    return { rideEdgesWritten, newStationRefsWritten: plan.newRefs.length, warnings };
  } finally {
    await resolved.cleanup();
  }
}

async function runFallbackMode(
  client: PoolClient,
  sourceUpdatedAt: Date | null,
): Promise<{ rideEdgesWritten: number; warnings: string[] }> {
  const { edges, warnings } = await computeFallbackEdges(client);
  const rideEdgesWritten = await writeRideEdges(client, FALLBACK_SOURCE, sourceUpdatedAt, edges);
  return { rideEdgesWritten, warnings: [...warnings] };
}

export async function runTransitImport(
  client: PoolClient,
  args: ImportTransitArgs,
): Promise<TransitImportResult> {
  const sourceUpdatedAt = args.sourceDate ?? null;

  let rideEdgesWritten: number;
  let newStationRefsWritten = 0;
  let warnings: string[];
  let source: string;

  if (args.gtfsPath !== undefined) {
    source = GTFS_SOURCE;
    const result = await runGtfsMode(client, args.gtfsPath, sourceUpdatedAt);
    rideEdgesWritten = result.rideEdgesWritten;
    newStationRefsWritten = result.newStationRefsWritten;
    warnings = result.warnings;
  } else {
    source = FALLBACK_SOURCE;
    const result = await runFallbackMode(client, sourceUpdatedAt);
    rideEdgesWritten = result.rideEdgesWritten;
    warnings = result.warnings;
  }

  // Print diagnostics BEFORE the zero-edges check below can abort — the
  // per-line/per-route/per-stop warnings collected above are exactly what
  // explains a zero-edge run, and should still reach the console even
  // though the transaction is about to be rolled back.
  for (const warning of warnings) {
    console.warn(`import:transit — ${warning}`);
  }

  // `validateGraph` below checks the WHOLE rail_edges table's health, not
  // this run's own contribution — a run that maps zero usable lines/routes
  // would otherwise still pass as long as leftover seed/prior-import data
  // keeps the graph above MIN_RAIL_EDGES, and (combined with
  // writeRideEdges's delete-then-upsert-on-this-source pattern) could wipe
  // its own source's prior edges, contribute nothing, and still exit 0 as
  // "complete". Treat a run's own zero-edge contribution as a hard failure
  // instead, naming the likely cause and remedy for each mode.
  if (rideEdgesWritten === 0) {
    const causeAndRemedy =
      source === GTFS_SOURCE
        ? "every GTFS route was unmapped to an existing rail_lines row, or every adjacent-stop " +
          "pair involved an unmatched stop (see the warnings above for which). Remedy: run " +
          "import:mlit first so rail_lines/station_groups exist for this feed's routes/stops to " +
          "resolve against, or check that route_id/route_short_name/route_long_name align with " +
          "rail_lines.name_ja/name_en."
        : "every candidate rail_lines row was skipped (see the warnings above — most likely every " +
          "line has geom IS NULL, or no station_groups fall within STATION_MERGE_RADIUS_M of any " +
          "line's geometry). Remedy: run import:mlit first to populate rail_lines.geom, or use " +
          "--gtfs instead of --from-topology.";
    throw new Error(
      `import:transit — this run (source='${source}') produced 0 ride edges. Aborting rather than ` +
        `report success while silently deleting this source's prior edges and contributing ` +
        `nothing. Likely cause: ${causeAndRemedy}`,
    );
  }

  const transferEdgesWritten = await writeTransferEdges(client, source, sourceUpdatedAt);

  const graphSummary = await validateGraph(client, { minEdges: MIN_RAIL_EDGES });

  console.log(
    `import:transit — mode=${source} ride_edges=${String(rideEdgesWritten)} ` +
      `transfer_edges=${String(transferEdgesWritten)} new_station_refs=${String(newStationRefsWritten)} ` +
      `total_graph_edges=${String(graphSummary.totalEdges)} orphan_station_groups=${String(graphSummary.orphanStationGroupIds.length)}/${String(graphSummary.totalStationGroups)}`,
  );

  return {
    rowsImported: rideEdgesWritten + transferEdgesWritten + newStationRefsWritten,
    sourceUpdatedAt: sourceUpdatedAt ?? undefined,
    rideEdgesWritten,
    transferEdgesWritten,
    newStationRefsWritten,
    warnings,
  };
}

function parseFlagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): ImportTransitArgs {
  const gtfsPath = parseFlagValue(argv, "--gtfs");
  const fromTopology = argv.includes("--from-topology");

  if (gtfsPath !== undefined && fromTopology) {
    throw new Error("import:transit — pass either --gtfs <dir-or-zip> or --from-topology, not both.");
  }
  if (gtfsPath === undefined && !fromTopology) {
    throw new Error(
      `import:transit — no input given. Pass --gtfs <dir-or-zip> to import a real GTFS feed ` +
        `(manual source: ${MANUAL_GTFS_URL}), or --from-topology to derive coarse edges from ` +
        `rail_lines geometry instead.`,
    );
  }

  const sourceDateRaw = parseFlagValue(argv, "--source-date");
  let sourceDate: Date | undefined;
  if (sourceDateRaw !== undefined) {
    const parsed = new Date(sourceDateRaw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`--source-date "${sourceDateRaw}" is not a valid date`);
    }
    sourceDate = parsed;
  }

  return { gtfsPath, fromTopology, sourceDate };
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error(
      "DATABASE_URL is not set. Set it to a PostgreSQL connection string, e.g.\n" +
        "  DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo pnpm import:transit --from-topology",
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const pool = createPool();
  try {
    const source = args.gtfsPath !== undefined ? GTFS_SOURCE : FALLBACK_SOURCE;
    const result = await runImport({ source, pool }, (client) => runTransitImport(client, args));
    console.log(`import:transit complete. rows_imported=${String(result.rowsImported)}`);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
