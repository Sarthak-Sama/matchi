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
import { loadLatestSuccessfulImportRuns } from "./lib/data-vintages.js";
import { assertDevResponseShape } from "./lib/dev-response-check.js";
import type { LifestyleMetricColumns } from "./lib/lifestyle-columns.js";
import {
  LIFESTYLE_SELECT_SQL,
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
 * imported source data (OSM POIs, flood/zoning polygons) run through a
 * documented, deterministic normalization, but with no per-station
 * verification signal to justify "high", and no reason to assume they're
 * unreliable either.
 */
const LIFESTYLE_BUNDLE_CONFIDENCE: Confidence = "medium";

// ---------------------------------------------------------------------------
// Candidate query
// ---------------------------------------------------------------------------

const CANDIDATES_SQL = `
  SELECT
    nm.station_group_id AS "stationGroupId",
    sg.name_en AS "nameEn",
    sg.name_ja AS "nameJa",
    nm.ward_code AS "wardCode",
    w.name_en AS "wardNameEn",
    w.name_ja AS "wardNameJa",
    ST_Y(sg.point) AS lat,
    ST_X(sg.point) AS lon,
    nm.rent_per_sqm_yen AS "rentPerSqmYen",
    nm.management_fee_yen AS "managementFeeYen",
    nm.land_price_multiplier AS "landPriceMultiplier",
    nm.land_price_point_count AS "landPricePointCount",
    nm.land_price_used_fallback AS "landPriceUsedFallback",
    nm.rent_source AS "rentSource",
    nm.rent_source_period AS "rentSourcePeriod",
    ${LIFESTYLE_SELECT_SQL},
    nm.derived_at AS "derivedAt"
  FROM neighborhood_metrics nm
  JOIN station_groups sg ON sg.station_group_id = nm.station_group_id
  LEFT JOIN wards w ON w.ward_code = nm.ward_code
`;
// NO destination filter here, deliberately: the destination's own area is a
// candidate like any other. The old `WHERE nm.station_group_id != $1`
// existed only because a station's commute to itself was a degenerate 0
// minutes; now that the destination carries a real walk, "live at Hatagaya,
// walk 11 minutes to the office" is a legitimate — and often the BEST —
// answer, which the model merely overstates slightly (8 min home->station +
// 0 rail + the walk). Do not restore the filter: deleting the prime
// neighbourhoods outright is by far the larger error.

interface CandidateRow extends LifestyleMetricColumns {
  readonly stationGroupId: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly wardCode: string | null;
  readonly wardNameEn: string | null;
  readonly wardNameJa: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly rentPerSqmYen: number | null;
  readonly managementFeeYen: number | null;
  readonly landPriceMultiplier: number | null;
  readonly landPricePointCount: number | null;
  readonly landPriceUsedFallback: boolean | null;
  readonly rentSource: string | null;
  readonly rentSourcePeriod: string | null;
  readonly derivedAt: Date;
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
  seedNodes: ReadonlySet<string>,
  layout: LayoutId,
  currentYear: number,
  nameLookups: NameLookups,
  log: FastifyBaseLogger,
): Candidate | null {
  if (row.wardCode === null || row.wardNameEn === null || row.wardNameJa === null) {
    log.warn(
      { stationGroupId: row.stationGroupId },
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
      { stationGroupId: row.stationGroupId, wardCode: row.wardCode },
      "excluding candidate from /v1/optimize: incomplete rent inputs (ward likely has no rent_stats row)",
    );
    return null;
  }

  const normScores = readLifestyleNormScores(row);
  if (normScores === null) {
    log.warn(
      { stationGroupId: row.stationGroupId },
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

  const rawCommute = estimateCommute(dijkstraResult, row.stationGroupId);
  const commute = rawCommute
    ? { ...rawCommute, path: resolvePathNames(rawCommute.path, nameLookups) }
    : null;

  // The spreads are the drift tripwire: this is a real type-checked
  // assignment into `LifestyleMetricsInput`, so a registry axis whose
  // metric this module cannot supply fails to compile.
  const lifestyle: LifestyleMetricsInput = {
    ...normScores,
    ...readLifestyleRawCounts(row),
    sourceDate: row.derivedAt.toISOString(),
    confidence: LIFESTYLE_BUNDLE_CONFIDENCE,
  };

  return {
    stationGroupId: row.stationGroupId,
    nameEn: row.nameEn,
    nameJa: row.nameJa,
    wardCode: row.wardCode,
    wardNameEn: row.wardNameEn,
    wardNameJa: row.wardNameJa,
    centroid: { lat: row.lat, lon: row.lon },
    rent,
    commute,
    lifestyle,
    isDestinationAccessStation: seedNodes.has(row.stationGroupId),
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
): Promise<DijkstraSeed[]> {
  if (body.destinationPoint) {
    const seeds = await findAccessStations(pool, body.destinationPoint);
    if (seeds.length === 0) {
      throw new ApiError(
        400,
        "NO_ACCESS_STATIONS",
        `No station is within ${String(MAX_DESTINATION_WALK_M)} m of the destination point ` +
          `(${String(body.destinationPoint.lat)}, ${String(body.destinationPoint.lon)}) — ` +
          `there is no way to commute to it by rail.`,
      );
    }
    return seeds;
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
  return [{ node: destinationStationGroupId, walkMinutes: 0 }];
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

    const seeds = await resolveDestinationSeeds(deps.pool, body, nameLookups);
    const seedNodes = new Set(seeds.map((seed) => seed.node));

    const period = resolvePeriod(body.arrivalTime);
    const graph = period === "peak" ? deps.graphs.peak : deps.graphs.offpeak;
    const dijkstraResult = reverseDijkstra(graph, seeds);

    const currentYear = new Date().getFullYear();
    const candidates: Candidate[] = [];
    for (const row of candidateRowsResult.rows) {
      const candidate = buildCandidate(
        row,
        dijkstraResult,
        seedNodes,
        body.layout,
        currentYear,
        nameLookups,
        request.log,
      );
      if (candidate) candidates.push(candidate);
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
