import type { Confidence } from "@tokyo/shared";
import { ACCESS_WALK_MINUTES, COMMUTE_LABEL } from "@tokyo/shared";

import type { DijkstraResult } from "./dijkstra.js";
import { reconstructPath } from "./dijkstra.js";
import type { GraphNode } from "./graph.js";

export interface CommutePathHop {
  readonly stationGroupId: string;

  readonly nameEn: string;

  readonly nameJa: string;

  readonly lineName: string | null;
}

export interface CommuteEstimateResult {
  readonly mode?: "walk" | "transit";
  readonly totalMinutes: number;
  readonly rangeMinutes?: { readonly min: number; readonly max: number };

  readonly accessWalkMinutes: number;
  readonly railMinutes: number;
  readonly waitMinutes: number;
  readonly transferCount: number;
  readonly transferPenaltyMinutes: number;

  readonly destinationWalkMinutes: number;
  readonly confidence: Confidence;
  readonly label: typeof COMMUTE_LABEL;
  readonly path: readonly CommutePathHop[];
}

export function estimateCommute(
  dijkstraResult: DijkstraResult,
  originStationGroupId: GraphNode,
): CommuteEstimateResult | null {
  const state = dijkstraResult.get(originStationGroupId);
  if (!state) return null;

  const hops = reconstructPath(dijkstraResult, originStationGroupId) ?? [];
  const path: CommutePathHop[] = hops.map((hop) => ({
    stationGroupId: hop.stationGroupId,
    nameEn: hop.stationGroupId,
    nameJa: hop.stationGroupId,
    lineName: hop.railLineId,
  }));

  return {
    mode: "transit",
    totalMinutes: state.totalMinutes + ACCESS_WALK_MINUTES,
    rangeMinutes: {
      min: state.totalMinutes + ACCESS_WALK_MINUTES,
      max: state.totalMinutes + ACCESS_WALK_MINUTES,
    },
    accessWalkMinutes: ACCESS_WALK_MINUTES,
    railMinutes: state.railMinutes,
    waitMinutes: state.waitMinutes,
    transferCount: state.transferCount,
    transferPenaltyMinutes: state.transferPenaltyMinutes,
    destinationWalkMinutes: state.destinationWalkMinutes,
    confidence: state.confidence,
    label: COMMUTE_LABEL,
    path,
  };
}
