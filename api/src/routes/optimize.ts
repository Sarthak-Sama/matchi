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

export function registerOptimizeRoute(app: FastifyInstance, deps: AppDeps): void {
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
