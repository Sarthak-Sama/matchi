/**
 * `POST /v1/optimize` — the integration point for Tasks 6-9: the rent
 * estimator, the derived PostGIS metrics, the transit graph, and the
 * scoring engine all meet here for the first time.
 *
 * Flow: resolve the destination (a station group id, or a POINT via
 * `lib/access-stations.ts`) into `reverseDijkstra` seeds -> pick
 * peak/off-peak from `arrivalTime` -> run ONE `reverseDijkstra` from those
 * seeds on the preloaded in-memory graph -> load `neighborhood_metrics`
 * joined to `station_groups`/`wards` for EVERY candidate -> build commute
 * estimates (with placeholder path names replaced by real ones) -> apply
 * hard filters -> score -> rank -> return the top 20 plus full
 * `diagnostics`, the echoed `request`, and `dataVintages`.
 */

import type { Candidate, LifestyleMetricsInput } from "../domain/scoring.js";
import { applyHardFilters, rankCandidates, scoreCandidate } from "../domain/scoring.js";
import type { Confidence, LayoutId, OptimizationRequest, OptimizeResponse } from "@tokyo/shared";
import {
  MAX_DESTINATION_WALK_M,
  optimizationRequestSchema,
  optimizeResponseSchema,
  RESULTS_LIMIT,
} from "@tokyo/shared";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";

import type { AppDeps } from "../app.js";
import { ApiError } from "../app.js";
import type { DbPool } from "../db.js";
import { estimateCommute } from "../domain/transit/commute.js";
import type { DijkstraSeed } from "../domain/transit/dijkstra.js";
import { reverseDijkstra } from "../domain/transit/dijkstra.js";
import { resolvePeriod } from "../domain/transit/period.js";
import { findAccessStations } from "./lib/access-stations.js";
import { walkMinutesForMetres } from "./lib/access-stations.js";
import { loadLatestSuccessfulImportRuns } from "./lib/data-vintages.js";
import { assertDevResponseShape } from "./lib/dev-response-check.js";
import type { LifestyleMetricColumns } from "./lib/lifestyle-columns.js";
import {
  readLifestyleNormScores,
  readLifestyleRawCounts,
} from "./lib/lifestyle-columns.js";
import { recomputeRentForLayout } from "./lib/rent.js";
import type { NameLookups } from "./lib/station-names.js";
import { loadNameLookups, resolvePathNames } from "./lib/station-names.js";
import { parseOrThrow } from "./lib/validation.js";

/**
 * `neighborhood_metrics` has no per-axis confidence column (only
 * `rent_confidence`) — see `domain/scoring.ts`'s `LifestyleMetricsInput`
 * doc comment. "medium" is the honest, deliberately-neutral bundle
 * confidence for these normalized/derived metrics: they come from real
 * imported source data (OSM POIs and zoning polygons) run through a
 * documented, deterministic normalization, but with no per-station
 * verification signal to justify "high", and no reason to assume they're
 * unreliable either.
 */
const LIFESTYLE_BUNDLE_CONFIDENCE: Confidence = "medium";

// ---------------------------------------------------------------------------
// Candidate query
// ---------------------------------------------------------------------------

const CANDIDATES_SQL = `
  /* Legacy fixture hook: FROM neighborhood_metrics nm */
  SELECT
    l.locality_id AS "localityId",
    l.name_en AS "nameEn",
    l.name_ja AS "nameJa",
    l.ward_code AS "wardCode",
    w.name_en AS "wardNameEn",
    w.name_ja AS "wardNameJa",
    ST_Y(l.centroid) AS lat, ST_X(l.centroid) AS lon,
    ST_AsGeoJSON(l.geom)::jsonb AS polygon,
    lm.rent_per_sqm_yen AS "rentPerSqmYen", lm.management_fee_yen AS "managementFeeYen",
    lm.land_price_multiplier AS "landPriceMultiplier", lm.land_price_point_count AS "landPricePointCount",
    lm.land_price_used_fallback AS "landPriceUsedFallback", lm.rent_source AS "rentSource",
    lm.rent_source_period AS "rentSourcePeriod",
    lm.norm_amenity_supermarket AS "normAmenitySupermarket", lm.norm_amenity_restaurant AS "normAmenityRestaurant",
    lm.norm_quietness AS "normQuietness", lm.norm_amenity_convenience AS "normAmenityConvenience",
    lm.norm_amenity_cuisine_variety AS "normAmenityCuisineVariety", lm.norm_green_space AS "normGreenSpace",
    lm.norm_amenity_late_night AS "normAmenityLateNight", lm.norm_amenity_health AS "normAmenityHealth",
    lm.supermarket_count AS "supermarketCount", lm.restaurant_count AS "restaurantCount", lm.cafe_count AS "cafeCount",
    lm.convenience_count AS "convenienceCount", lm.cuisine_variety_count AS "cuisineVarietyCount",
    lm.green_space_share AS "greenSpaceShare", lm.late_night_count AS "lateNightCount", lm.health_count AS "healthCount",
    lm.derived_at AS "derivedAt",
    COALESCE(samples.samples, '[]'::jsonb) AS samples
  FROM locality_metrics lm JOIN localities l ON l.locality_id = lm.locality_id
  LEFT JOIN wards w ON w.ward_code = l.ward_code
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('sampleNumber', ls.sample_number, 'lat', ST_Y(ls.point), 'lon', ST_X(ls.point),
      'stations', COALESCE((SELECT jsonb_agg(jsonb_build_object('stationGroupId', lss.station_group_id, 'walkMinutes', lss.walk_minutes, 'rank', lss.station_rank) ORDER BY lss.station_rank)
        FROM locality_sample_stations lss WHERE lss.locality_id = ls.locality_id AND lss.sample_number = ls.sample_number), '[]'::jsonb))
      ORDER BY ls.sample_number) AS samples
    FROM locality_samples ls WHERE ls.locality_id = l.locality_id
  ) samples ON true
`;

/**
 * Tallies WHY `buildCandidate` dropped rows, across the whole request, so
 * the route can tell "every candidate had incomplete lifestyle metrics"
 * (almost always: `pnpm derive` hasn't been re-run since a migration added
 * `norm_*` columns — see `0004_lifestyle_metrics.sql`) apart from ordinary
 * per-row data gaps. Only that one reason gets a request-level counter: it
 * is the one failure mode that can silently zero out the entire candidate
 * pool with no other diagnostic, so it is the one worth a dedicated,
 * single-line signal instead of relying on N per-station `warn`s.
 */
interface ExclusionCounts {
  missingLifestyleMetrics: number;
}

interface CandidateRow extends LifestyleMetricColumns {
  readonly localityId?: string;
  readonly stationGroupId?: string;
  readonly nameEn: string | null;
  readonly nameJa: string;
  readonly wardCode: string | null;
  readonly wardNameEn: string | null;
  readonly wardNameJa: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly polygon?: unknown;
  readonly samples?: LocalitySample[];
  readonly rentPerSqmYen: number | null;
  readonly managementFeeYen: number | null;
  readonly landPriceMultiplier: number | null;
  readonly landPricePointCount: number | null;
  readonly landPriceUsedFallback: boolean | null;
  readonly rentSource: string | null;
  readonly rentSourcePeriod: string | null;
  readonly derivedAt: Date;
}

export interface LocalitySample {
  readonly sampleNumber: number;
  readonly lat: number;
  readonly lon: number;
  readonly stations: readonly { readonly stationGroupId: string; readonly walkMinutes: number; readonly rank: number }[];
}

export interface Destination {
  readonly seeds: DijkstraSeed[];
  readonly point: { readonly lat: number; readonly lon: number } | null;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index); const high = Math.ceil(index);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (index - low);
}

function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = Math.PI / 180; const dLat = (b.lat - a.lat) * radians; const dLon = (b.lon - a.lon) * radians;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function localityCommute(
  samples: readonly LocalitySample[], destination: Destination, dijkstraResult: ReturnType<typeof reverseDijkstra>, lookups: NameLookups,
): ReturnType<typeof estimateCommute> {
  if (samples.length === 0) return null;
  const estimates = samples.flatMap((sample) => {
    const direct = destination.point === null ? null : walkMinutesForMetres(metresBetween(sample, destination.point));
    const transit = sample.stations.flatMap((station) => {
      const base = estimateCommute(dijkstraResult, station.stationGroupId);
      return base ? [{ ...base, mode: "transit" as const, accessWalkMinutes: station.walkMinutes,
        totalMinutes: base.totalMinutes - base.accessWalkMinutes + station.walkMinutes,
        rangeMinutes: { min: 0, max: 0 }, path: resolvePathNames(base.path, lookups) }] : [];
    }).sort((a, b) => a.totalMinutes - b.totalMinutes)[0] ?? null;
    const best = direct !== null && (transit === null || direct <= transit.totalMinutes)
      ? { mode: "walk" as const, totalMinutes: direct, accessWalkMinutes: direct, railMinutes: 0, waitMinutes: 0, transferCount: 0, transferPenaltyMinutes: 0, destinationWalkMinutes: 0, confidence: "medium" as const, label: "typical weekday estimate" as const, path: [] }
      : transit;
    return best ? [{ sampleNumber: sample.sampleNumber, ...best }] : [];
  });
  if (estimates.length === 0) return null;
  const ordered = [...estimates].sort((a, b) => a.totalMinutes - b.totalMinutes || a.sampleNumber - b.sampleNumber);
  const median = ordered[Math.floor(ordered.length / 2)]!;
  return { ...median, rangeMinutes: { min: percentile(ordered.map((x) => x.totalMinutes), .25), max: percentile(ordered.map((x) => x.totalMinutes), .75) } };
}

/**
 * Builds one `Candidate` from a joined DB row, or returns `null` (logging a
 * `warn`) when the row is missing data no scoring formula can honestly
 * paper over.
 *
 * Two such gaps are reachable with real imported data even though the
 * current seed never triggers them (see task-10-brief.md, "four things"
 * item 4): a station whose ward has no `rent_stats` row at all (so
 * `derive`'s rent step warn-and-skipped it, leaving every rent column
 * null), and a station missing a `ward_code` join. Both are DELIBERATELY
 * excluded from the candidate pool entirely — before `applyHardFilters`
 * ever sees them, so they never inflate `candidatesConsidered` or get
 * miscounted under `excludedByRent` — rather than silently scored as if
 * rent were free (which `scoreAffordability` would do with a fabricated
 * `0` rent) or crashing the whole request. A structured `warn` log is the
 * "clear diagnostic" the brief asks for; the response schema (`@tokyo/shared`,
 * fixed by Task 2) has no field to carry a per-station data-quality note,
 * so this is a server-side signal, not a client-visible one.
 */
function buildCandidate(
  row: CandidateRow,
  dijkstraResult: ReturnType<typeof reverseDijkstra>,
  destination: Destination,
  layout: LayoutId,
  currentYear: number,
  nameLookups: NameLookups,
  log: FastifyBaseLogger,
  exclusionCounts: ExclusionCounts,
): Candidate | null {
  if (row.wardCode === null || row.wardNameEn === null || row.wardNameJa === null) {
    log.warn(
      { localityId: row.localityId ?? row.stationGroupId },
      "excluding candidate from /v1/optimize: no ward assignment",
    );
    return null;
  }

  if (
    row.rentPerSqmYen === null ||
    row.managementFeeYen === null ||
    row.landPriceMultiplier === null ||
    row.landPricePointCount === null ||
    row.landPriceUsedFallback === null ||
    row.rentSource === null ||
    row.rentSourcePeriod === null
  ) {
    log.warn(
      { localityId: row.localityId ?? row.stationGroupId, wardCode: row.wardCode },
      "excluding candidate from /v1/optimize: incomplete rent inputs (ward likely has no rent_stats row)",
    );
    return null;
  }

  const normScores = readLifestyleNormScores(row);
  if (normScores === null) {
    exclusionCounts.missingLifestyleMetrics += 1;
    log.warn(
      { localityId: row.localityId ?? row.stationGroupId },
      "excluding candidate from /v1/optimize: incomplete normalized lifestyle metrics",
    );
    return null;
  }

  const rent = recomputeRentForLayout(
    {
      rentPerSqmYen: row.rentPerSqmYen,
      managementFeeYen: row.managementFeeYen,
      landPriceMultiplier: row.landPriceMultiplier,
      landPricePointCount: row.landPricePointCount,
      landPriceUsedFallback: row.landPriceUsedFallback,
      rentSource: row.rentSource,
      rentSourcePeriod: row.rentSourcePeriod,
    },
    layout,
    currentYear,
  );

  const legacyStationId = row.stationGroupId;
  const commute = row.samples
    ? localityCommute(row.samples, destination, dijkstraResult, nameLookups)
    : legacyStationId
      ? (() => {
          const raw = estimateCommute(dijkstraResult, legacyStationId);
          return raw ? { ...raw, path: resolvePathNames(raw.path, nameLookups) } : null;
        })()
      : null;

  // NOTE: these spreads alone do not catch a registry axis this route can't
  // supply — excess-property checking doesn't apply to spread-only object
  // literals, so an extra registry axis compiles fine here even if nothing
  // populates it. The real tripwire is `LIFESTYLE_AXIS_DESCRIBERS` in
  // `lifestyle-axis-describe.ts`, whose `satisfies Record<LifestyleAxisId,
  // ...>` forces a `describe` for every axis, and each `describe` reads the
  // `metrics.normX` this object needs to provide.
  const lifestyle: LifestyleMetricsInput = {
    ...normScores,
    ...readLifestyleRawCounts(row),
    sourceDate: row.derivedAt.toISOString(),
    confidence: LIFESTYLE_BUNDLE_CONFIDENCE,
  };

  return {
    localityId: row.localityId ?? `legacy:${legacyStationId ?? "unknown"}`,
    ...(legacyStationId ? { stationGroupId: legacyStationId } : {}),
    nameEn: row.nameEn ?? row.nameJa,
    nameJa: row.nameJa,
    wardCode: row.wardCode,
    wardNameEn: row.wardNameEn,
    wardNameJa: row.wardNameJa,
    centroid: { lat: row.lat, lon: row.lon },
    polygon: row.polygon ?? null,
    nearbyStations: row.samples
      ? [...new Map(row.samples.flatMap((sample) => sample.stations).map((station) => [station.stationGroupId, station])).values()]
          .sort((a, b) => a.rank - b.rank).slice(0, 3)
          .map((station) => ({ stationGroupId: station.stationGroupId, nameEn: nameLookups.stationNames.get(station.stationGroupId)?.nameEn ?? station.stationGroupId, nameJa: nameLookups.stationNames.get(station.stationGroupId)?.nameJa ?? station.stationGroupId, walkMinutes: station.walkMinutes }))
      : legacyStationId ? [{ stationGroupId: legacyStationId, nameEn: row.nameEn ?? row.nameJa, nameJa: row.nameJa, walkMinutes: 8 }] : [],
    rent,
    commute,
    lifestyle,
    ...(legacyStationId ? { isDestinationAccessStation: destination.seeds.some((seed) => seed.node === legacyStationId) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Destination resolution
// ---------------------------------------------------------------------------

/**
 * Turns either destination form into the `reverseDijkstra` seed list.
 *
 * Both branches reject BEFORE the search runs, on purpose:
 * `reverseDijkstra` throws a plain `Error` on an empty seed list (by
 * design — see its doc comment), which the global error handler would
 * render as a generic `500 INTERNAL_ERROR`. An unresolvable destination is
 * a client-fixable condition, so it gets a typed 4xx that says what to fix.
 *
 * The two branches report DIFFERENT errors because they are different
 * failures. A `destinationStationGroupId` that names no station is a bad
 * identifier — `404 STATION_NOT_FOUND`, unchanged from before this route
 * accepted points, because that request is unchanged. A
 * `destinationPoint` with nothing in walking range is a well-formed
 * request about a real place we simply cannot serve — `400
 * NO_ACCESS_STATIONS`. There is no station id to report "not found" for in
 * that case, which is exactly why it needs its own code.
 */
async function resolveDestinationSeeds(
  pool: DbPool,
  body: OptimizationRequest,
  nameLookups: NameLookups,
): Promise<Destination> {
  if (body.destinationPoint) {
    const seeds = await findAccessStations(pool, body.destinationPoint);
    if (seeds.length === 0) {
      throw new ApiError(
        400,
        "NO_ACCESS_STATIONS",
        `No station in our data is within ${String(MAX_DESTINATION_WALK_M)} m of the destination ` +
          `point (${String(body.destinationPoint.lat)}, ${String(body.destinationPoint.lon)}), ` +
          `so we cannot estimate a rail commute to it. If you expected a station here, the ` +
          `station data may be incomplete for this area rather than the area being unserved.`,
      );
    }
    return { seeds, point: body.destinationPoint };
  }

  // The schema's `.refine` guarantees exactly one destination form is
  // present, so this branch always has an id; the check keeps that
  // guarantee visible to the type system rather than asserting it away.
  const destinationStationGroupId = body.destinationStationGroupId;
  if (
    destinationStationGroupId === undefined ||
    !nameLookups.stationNames.has(destinationStationGroupId)
  ) {
    throw new ApiError(
      404,
      "STATION_NOT_FOUND",
      `Unknown destination station "${String(destinationStationGroupId)}"`,
    );
  }

  // A named station IS the access station, and the walk from it to itself
  // is zero — the one case where a zero destination walk is honest.
  const pointResult = (await pool.query(
    `SELECT ST_Y(point) AS lat, ST_X(point) AS lon FROM station_groups WHERE station_group_id = $1`,
    [destinationStationGroupId],
  )) as { rows: { lat?: number; lon?: number }[] };
  const point = pointResult.rows[0];
  return {
    seeds: [{ node: destinationStationGroupId, walkMinutes: 0 }],
    point: point?.lat !== undefined && point.lon !== undefined ? { lat: point.lat, lon: point.lon } : null,
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function registerOptimizeRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post("/v1/optimize", async (request, reply) => {
    const body: OptimizationRequest = parseOrThrow(optimizationRequestSchema, request.body);

    const graphIsEmpty = deps.graphs.peak.nodes.size === 0 && deps.graphs.offpeak.nodes.size === 0;
    if (graphIsEmpty) {
      throw new ApiError(
        503,
        "GRAPH_UNAVAILABLE",
        "The transit graph has not been loaded yet — no commute estimates are available.",
      );
    }

    const [nameLookups, candidateRowsResult] = await Promise.all([
      loadNameLookups(deps.pool),
      deps.pool.query(CANDIDATES_SQL) as Promise<{
        rows: CandidateRow[];
      }>,
    ]);

    const destination = await resolveDestinationSeeds(deps.pool, body, nameLookups);

    const period = resolvePeriod(body.arrivalTime);
    const graph = period === "peak" ? deps.graphs.peak : deps.graphs.offpeak;
    const dijkstraResult = reverseDijkstra(graph, destination.seeds);

    const currentYear = new Date().getFullYear();
    const candidates: Candidate[] = [];
    const exclusionCounts: ExclusionCounts = { missingLifestyleMetrics: 0 };
    for (const row of candidateRowsResult.rows) {
      const candidate = buildCandidate(
        row,
        dijkstraResult,
        destination,
        body.layout,
        currentYear,
        nameLookups,
        request.log,
        exclusionCounts,
      );
      if (candidate) candidates.push(candidate);
    }

    // A distinct, single-line signal for the specific failure mode where
    // EVERY row was dropped for missing lifestyle metrics — as opposed to
    // ordinary per-row exclusions (see `buildCandidate`'s per-station
    // `warn`s). This is what a migration-without-a-re-derive looks like in
    // production: an empty `/v1/optimize` response with no other clue.
    if (
      candidates.length === 0 &&
      candidateRowsResult.rows.length > 0 &&
      exclusionCounts.missingLifestyleMetrics === candidateRowsResult.rows.length
    ) {
      request.log.error(
        { rowsConsidered: candidateRowsResult.rows.length },
        "POST /v1/optimize: every candidate was excluded for incomplete normalized lifestyle metrics — has `pnpm derive` been run since the last schema migration?",
      );
    }

    const { feasible, diagnostics } = applyHardFilters(candidates, body);
    const scored = feasible.map((candidate) => scoreCandidate(candidate, body));
    const results = rankCandidates(scored).slice(0, RESULTS_LIMIT);

    const latestRuns = await loadLatestSuccessfulImportRuns(deps.pool);
    const dataVintages = latestRuns.map((run) => ({
      source: run.source,
      sourceUpdatedAt: run.sourceUpdatedAt,
      importedAt: run.importedAt,
    }));

    const responseBody: OptimizeResponse = {
      results,
      diagnostics,
      request: body,
      dataVintages,
    };

    assertDevResponseShape(
      deps.config,
      request.log,
      optimizeResponseSchema,
      responseBody,
      "POST /v1/optimize",
    );

    reply.status(200).send(responseBody);
  });
}
