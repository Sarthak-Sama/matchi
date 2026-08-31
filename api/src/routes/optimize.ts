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

import type { Candidate } from "../domain/scoring.js";
import { applyHardFilters, rankCandidates, scoreCandidate } from "../domain/scoring.js";
import type { OptimizationRequest, OptimizeResponse } from "@tokyo/shared";
import {
  MAX_DESTINATION_WALK_M,
  optimizationRequestSchema,
  optimizeResponseSchema,
  RESULTS_LIMIT,
} from "@tokyo/shared";
import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../app.js";
import { ApiError, RATE_LIMIT_WINDOW } from "../app.js";
import type { DbPool } from "../db.js";
import { reverseDijkstra } from "../domain/transit/dijkstra.js";
import { resolvePeriod } from "../domain/transit/period.js";
import { findAccessStations } from "./lib/access-stations.js";
import type { CandidateRow, Destination, ExclusionCounts } from "./lib/candidates.js";
import { buildCandidate, CANDIDATES_SQL } from "./lib/candidates.js";
import { loadLatestSuccessfulImportRuns } from "./lib/data-vintages.js";
import { assertDevResponseShape } from "./lib/dev-response-check.js";
import type { NameLookups } from "./lib/station-names.js";
import { loadNameLookups } from "./lib/station-names.js";
import { parseOrThrow } from "./lib/validation.js";

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
    point:
      point?.lat !== undefined && point.lon !== undefined
        ? { lat: point.lat, lon: point.lon }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function registerOptimizeRoute(app: FastifyInstance, deps: AppDeps): void {
  // A full candidate scan plus a Dijkstra pass per request — by far the most
  // expensive endpoint, so it gets a tighter budget than the global one.
  const routeOptions = {
    config: {
      rateLimit: {
        max: deps.config.RATE_LIMIT_OPTIMIZE_MAX,
        timeWindow: RATE_LIMIT_WINDOW,
      },
    },
  };

  app.post("/v1/optimize", routeOptions, async (request, reply) => {
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
