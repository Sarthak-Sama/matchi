/**
 * Combines route->line mapping, stop matching, and the travel-time/headway
 * statistics into the final list of `ride` `rail_edges` rows GTFS mode
 * writes. Pure — no I/O, no database — so the whole GTFS pipeline (short
 * of the actual DB write and the transfer-edge/validation steps that need
 * a live `station_groups` table) is unit-testable against the committed
 * fixture with no `DATABASE_URL`.
 */

import type { Confidence } from "@tokyo/shared";
import { OFFPEAK_WAIT_MINUTES, PEAK_WAIT_MINUTES } from "@tokyo/shared";

import type { GtfsRoute, GtfsTrip } from "./gtfs-static.js";
import type { GtfsStop } from "./gtfs-static.js";
import type { StopTimeRow } from "./gtfs-stop-times.js";
import type { RailLineCandidate } from "./route-line-mapping.js";
import { mapRoutesToLines } from "./route-line-mapping.js";
import type { CandidateStationGroup, ExistingGtfsRef, NewGtfsRef } from "./stop-matching.js";
import { matchStops } from "./stop-matching.js";
import { computeAdjacentPairStats, computeHeadways, directionKey } from "./travel-stats.js";

export interface NewRideEdge {
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

export interface GtfsPlanInput {
  readonly stops: readonly GtfsStop[];
  readonly routes: readonly GtfsRoute[];
  readonly trips: readonly GtfsTrip[];
  readonly stopTimesByTrip: ReadonlyMap<string, readonly StopTimeRow[]>;
  readonly existingRefs: readonly ExistingGtfsRef[];
  readonly candidateGroups: readonly CandidateStationGroup[];
  readonly railLines: readonly RailLineCandidate[];
}

export interface GtfsPlan {
  readonly edges: readonly NewRideEdge[];
  readonly newRefs: readonly NewGtfsRef[];
  readonly warnings: readonly string[];
  readonly unmatchedRefKeys: readonly string[];
  readonly totalRefKeys: number;
  readonly unmappedRouteIds: readonly string[];
}

export function buildGtfsPlan(input: GtfsPlanInput): GtfsPlan {
  const { stops, routes, trips, stopTimesByTrip, existingRefs, candidateGroups, railLines } = input;

  const matchResult = matchStops(stops, existingRefs, candidateGroups);
  const routeMapping = mapRoutesToLines(routes, railLines);
  const pairStats = computeAdjacentPairStats(trips, stopTimesByTrip);
  const headwayStats = computeHeadways(trips, stopTimesByTrip);
  const headwayByKey = new Map(
    headwayStats.map((h) => [directionKey(h.routeId, h.firstStopId), h]),
  );

  const warnings: string[] = [];
  const warnedMissingHeadway = new Set<string>();

  if (routeMapping.unmapped.length > 0) {
    warnings.push(
      `${String(routeMapping.unmapped.length)} GTFS route(s) could not be mapped to an existing ` +
        `rail_lines row and were skipped entirely (no ride edges written for them): ` +
        `${routeMapping.unmapped.join(", ")}`,
    );
  }

  const edges: NewRideEdge[] = [];
  let skippedUnmatchedStopEdges = 0;
  let skippedSelfLoopEdges = 0;

  for (const pair of pairStats) {
    const railLineId = routeMapping.mapped.get(pair.routeId);
    if (railLineId === undefined) continue; // Already warned above, at the route level.

    const fromGroup = matchResult.matchedStopToGroup.get(pair.fromStopId);
    const toGroup = matchResult.matchedStopToGroup.get(pair.toStopId);
    if (fromGroup === undefined || toGroup === undefined) {
      skippedUnmatchedStopEdges++;
      continue;
    }
    if (fromGroup === toGroup) {
      // Two GTFS stop_ids (e.g. platform-level children) collapsed to the
      // same station_group — no meaningful ride edge to write.
      skippedSelfLoopEdges++;
      continue;
    }

    let peakMinutes = pair.peakMinutes;
    let offpeakMinutes = pair.offpeakMinutes;
    if (peakMinutes === undefined && offpeakMinutes !== undefined) {
      peakMinutes = offpeakMinutes;
      warnings.push(
        `route ${pair.routeId} ${pair.fromStopId}->${pair.toStopId}: no peak-window samples; ` +
          `using the off-peak median (${String(offpeakMinutes)} min) for both periods.`,
      );
    } else if (offpeakMinutes === undefined && peakMinutes !== undefined) {
      offpeakMinutes = peakMinutes;
      warnings.push(
        `route ${pair.routeId} ${pair.fromStopId}->${pair.toStopId}: no off-peak samples; ` +
          `using the peak median (${String(peakMinutes)} min) for both periods.`,
      );
    }
    if (peakMinutes === undefined || offpeakMinutes === undefined) {
      // Unreachable in practice (a pair only exists with >= 1 sample in
      // some period), but keeps this function total rather than writing
      // a NaN into the database if it ever were.
      continue;
    }

    const dirKey = directionKey(pair.routeId, pair.firstStopId);
    const headway = headwayByKey.get(dirKey);
    let peakWaitMinutes = headway?.peakWaitMinutes;
    let offpeakWaitMinutes = headway?.offpeakWaitMinutes;
    if (
      (peakWaitMinutes === undefined || offpeakWaitMinutes === undefined) &&
      !warnedMissingHeadway.has(dirKey)
    ) {
      warnedMissingHeadway.add(dirKey);
      warnings.push(
        `route ${pair.routeId} direction starting at stop ${pair.firstStopId}: not enough ` +
          `departures to compute a headway for one or both periods; falling back to the global ` +
          `PEAK_WAIT_MINUTES/OFFPEAK_WAIT_MINUTES constants for that period.`,
      );
    }
    peakWaitMinutes ??= PEAK_WAIT_MINUTES;
    offpeakWaitMinutes ??= OFFPEAK_WAIT_MINUTES;

    edges.push({
      fromStationGroupId: fromGroup,
      toStationGroupId: toGroup,
      railLineId,
      edgeType: "ride",
      peakTravelMinutes: peakMinutes,
      offpeakTravelMinutes: offpeakMinutes,
      peakWaitMinutes,
      offpeakWaitMinutes,
      confidence: "high",
    });
  }

  if (skippedUnmatchedStopEdges > 0) {
    warnings.push(
      `${String(skippedUnmatchedStopEdges)} adjacent-stop-pair edge(s) skipped because one or ` +
        `both stops did not match a station_group.`,
    );
  }
  if (skippedSelfLoopEdges > 0) {
    warnings.push(
      `${String(skippedSelfLoopEdges)} adjacent-stop-pair edge(s) skipped because both stops ` +
        `matched the same station_group (e.g. two platforms of one merged station).`,
    );
  }

  return {
    edges,
    newRefs: matchResult.newRefs,
    warnings,
    unmatchedRefKeys: matchResult.unmatchedRefKeys,
    totalRefKeys: matchResult.totalRefKeys,
    unmappedRouteIds: routeMapping.unmapped,
  };
}
