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
 * the raw `railLineId` in `lineName` as placeholders — the caller (which
 * does have `station_groups` / `rail_lines` in hand) MUST replace them with
 * real names before a response reaches a client.
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
  readonly mode?: "walk" | "transit";
  readonly totalMinutes: number;
  readonly rangeMinutes?: { readonly min: number; readonly max: number };
  /** The ORIGIN-side walk: neighbourhood to its own station. */
  readonly accessWalkMinutes: number;
  readonly railMinutes: number;
  readonly waitMinutes: number;
  readonly transferCount: number;
  readonly transferPenaltyMinutes: number;
  /**
   * The DESTINATION-side walk: the access station this route ends at to
   * the destination point itself. Already inside `totalMinutes` (it is
   * part of the Dijkstra state's own total) — reported separately so the
   * UI can break the journey down end to end.
   */
  readonly destinationWalkMinutes: number;
  readonly confidence: Confidence;
  readonly label: typeof COMMUTE_LABEL;
  readonly path: readonly CommutePathHop[];
}

/**
 * `totalMinutes = dijkstraState.totalMinutes + ACCESS_WALK_MINUTES` — the
 * fixed neighborhood-to-station walk is added exactly once here, never
 * inside the Dijkstra search itself. The DESTINATION-side walk is the
 * mirror image: it varies per access station, so the search must know it
 * to choose between them, and it is therefore already inside
 * `dijkstraState.totalMinutes` — do not add it again here. Returns `null` when
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
