/**
 * The transit graph itself: pure data + a builder, no Dijkstra logic here
 * (see `dijkstra.ts`) and no database access here (see `loader.ts`).
 *
 * A `TransitGraph` is built once per period at startup (`buildGraphs`,
 * called with the rows from `loadRailEdges`) and handed to
 * `reverseDijkstra` on every request. It carries BOTH a forward adjacency
 * (node -> edges leaving it) and a reverse adjacency (node -> edges
 * arriving at it), so the reverse search never has to re-derive the
 * reverse index per request.
 */

import type { Confidence } from "@tokyo/shared";
import { OFFPEAK_WAIT_MINUTES, PEAK_WAIT_MINUTES } from "@tokyo/shared";

import type { Period } from "./period.js";

/** A station_group id. */
export type GraphNode = string;

export type EdgeType = "ride" | "transfer";

export interface GraphEdge {
  readonly from: GraphNode;
  readonly to: GraphNode;
  /** Null only for `transfer` edges. */
  readonly railLineId: string | null;
  readonly edgeType: EdgeType;
  /** Minutes for this specific edge, already resolved to the graph's period. */
  readonly travelMinutes: number;
  /**
   * The boarding wait associated with this edge's line, already resolved
   * to the graph's period. Whether it is actually CHARGED for a given
   * traversal depends on search state (see `dijkstra.ts`'s per-boarding
   * logic) — it is not simply added per edge.
   */
  readonly waitMinutes: number;
  readonly confidence: Confidence;
}

/**
 * One `rail_edges` row (joined to `rail_lines` for the line name), as
 * returned by `loadRailEdges`. Field names are camelCase versions of the
 * `rail_edges` / `rail_lines` columns (see `db/migrations/0001_init.sql`).
 *
 * `railLineName` is carried through from the `rail_lines` join per the
 * task brief, but `buildGraph` does not use it — `GraphEdge` only needs
 * `railLineId` for cost/transfer logic. It is reserved for a later task's
 * response assembly (mapping a path's line ids to display names).
 */
export interface RailEdgeRow {
  readonly fromStationGroupId: string;
  readonly toStationGroupId: string;
  readonly railLineId: string | null;
  readonly railLineName: string | null;
  readonly edgeType: EdgeType;
  readonly peakTravelMinutes: number;
  readonly offpeakTravelMinutes: number;
  readonly peakWaitMinutes: number;
  readonly offpeakWaitMinutes: number;
  readonly confidence: Confidence;
}

export interface TransitGraph {
  readonly period: Period;
  /** node -> edges leaving that node, in the original (forward) direction. */
  readonly forward: ReadonlyMap<GraphNode, readonly GraphEdge[]>;
  /** node -> edges arriving at that node — i.e. the reversed graph. */
  readonly reverse: ReadonlyMap<GraphNode, readonly GraphEdge[]>;
  readonly nodes: ReadonlySet<GraphNode>;
}

export interface TransitGraphs {
  readonly peak: TransitGraph;
  readonly offpeak: TransitGraph;
}

/**
 * `waitMinutes` comes from the row's own `peak_wait_minutes` /
 * `offpeak_wait_minutes` column when it's set (i.e. > 0 — the column is
 * `NOT NULL DEFAULT 0`, so "unset" reads back as exactly `0`), else falls
 * back to the global `PEAK_WAIT_MINUTES` / `OFFPEAK_WAIT_MINUTES` constant
 * for the period.
 */
function resolveWaitMinutes(row: RailEdgeRow, period: Period): number {
  const raw = period === "peak" ? row.peakWaitMinutes : row.offpeakWaitMinutes;
  if (raw > 0) return raw;
  return period === "peak" ? PEAK_WAIT_MINUTES : OFFPEAK_WAIT_MINUTES;
}

function pushEdge(index: Map<GraphNode, GraphEdge[]>, key: GraphNode, edge: GraphEdge): void {
  const existing = index.get(key);
  if (existing) {
    existing.push(edge);
  } else {
    index.set(key, [edge]);
  }
}

/** Builds one directed `TransitGraph` for `period` from raw `rail_edges` rows. */
export function buildGraph(edges: readonly RailEdgeRow[], period: Period): TransitGraph {
  const forward = new Map<GraphNode, GraphEdge[]>();
  const reverse = new Map<GraphNode, GraphEdge[]>();
  const nodes = new Set<GraphNode>();

  for (const row of edges) {
    // `rail_line_id` is nullable in the schema with no CHECK tying it to
    // `edge_type` (see db/migrations/0001_init.sql), so a `ride` row with
    // a null line is representable even though it violates the model: a
    // null-line ride would silently be treated as "same line" as any
    // other null-line ride (never charging a wait, never registering an
    // implicit transfer against a real line). Fail loudly instead of
    // producing a plausible-looking wrong commute time.
    if (row.edgeType === "ride" && row.railLineId === null) {
      throw new Error(
        `buildGraph: ride edge from "${row.fromStationGroupId}" to ` +
          `"${row.toStationGroupId}" has a null railLineId — only transfer ` +
          `edges may omit a line.`,
      );
    }

    const edge: GraphEdge = {
      from: row.fromStationGroupId,
      to: row.toStationGroupId,
      railLineId: row.railLineId,
      edgeType: row.edgeType,
      travelMinutes: period === "peak" ? row.peakTravelMinutes : row.offpeakTravelMinutes,
      waitMinutes: resolveWaitMinutes(row, period),
      confidence: row.confidence,
    };

    nodes.add(edge.from);
    nodes.add(edge.to);
    pushEdge(forward, edge.from, edge);
    pushEdge(reverse, edge.to, edge);
  }

  return { period, forward, reverse, nodes };
}

/** Builds both the peak and off-peak graphs once, from the same edge rows. */
export function buildGraphs(edges: readonly RailEdgeRow[]): TransitGraphs {
  return {
    peak: buildGraph(edges, "peak"),
    offpeak: buildGraph(edges, "offpeak"),
  };
}
