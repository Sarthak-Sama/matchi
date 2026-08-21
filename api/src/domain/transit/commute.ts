/**
 * Turns one node's `DijkstraState` (from a `reverseDijkstra` result) into
 * the `commuteEstimateSchema` shape the API response embeds.
 *
 * Placeholder names: `graph.ts` / `dijkstra.ts` only ever see
 * `station_group` ids and `rail_line` ids — no display names, by design
 * (the graph and search are pure logic, tested without a database; see
 * `loader.ts`'s doc comment on why `railLineName` doesn't reach
 * `GraphEdge`). `estimateCommute`'s only inputs are the Dijkstra result and
 * an origin id, so it has no display names to work with either. `path`
 * entries here carry the station_group id itself in `nameEn`/`nameJa` and
 * the raw `railLineId` in `lineName` as placeholders — the caller (Task 9
 * or Task 10, which do have `station_groups` / `rail_lines` in hand) MUST
 * replace them with real names before a response reaches a client.
 */

import type { Confidence } from "@tokyo/shared";
import { ACCESS_WALK_MINUTES, COMMUTE_LABEL } from "@tokyo/shared";

import type { DijkstraResult } from "./dijkstra.js";
import { reconstructPath } from "./dijkstra.js";
import type { GraphNode } from "./graph.js";

export interface CommutePathHop {
  readonly stationGroupId: string;
  /** Placeholder — see module doc comment. */
  readonly nameEn: string;
  /** Placeholder — see module doc comment. */
  readonly nameJa: string;
  /** Placeholder (raw `railLineId`, or `null`) — see module doc comment. */
  readonly lineName: string | null;
}

export interface CommuteEstimateResult {
  readonly totalMinutes: number;
  readonly accessWalkMinutes: number;
  readonly railMinutes: number;
  readonly waitMinutes: number;
  readonly transferCount: number;
  readonly transferPenaltyMinutes: number;
  readonly confidence: Confidence;
  readonly label: typeof COMMUTE_LABEL;
  readonly path: readonly CommutePathHop[];
}

/**
 * `totalMinutes = dijkstraState.totalMinutes + ACCESS_WALK_MINUTES` — the
 * fixed neighborhood-to-station walk is added exactly once here, never
 * inside the Dijkstra search itself. Returns `null` when
 * `originStationGroupId` is unreachable from the destination (absent from
 * `dijkstraResult`).
 */
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
    totalMinutes: state.totalMinutes + ACCESS_WALK_MINUTES,
    accessWalkMinutes: ACCESS_WALK_MINUTES,
    railMinutes: state.railMinutes,
    waitMinutes: state.waitMinutes,
    transferCount: state.transferCount,
    transferPenaltyMinutes: state.transferPenaltyMinutes,
    confidence: state.confidence,
    label: COMMUTE_LABEL,
    path,
  };
}
