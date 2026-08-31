import type { Confidence } from "@tokyo/shared";
import { OFFPEAK_WAIT_MINUTES, PEAK_WAIT_MINUTES } from "@tokyo/shared";

import type { Period } from "./period.js";

export type GraphNode = string;

export type EdgeType = "ride" | "transfer";

export interface GraphEdge {
  readonly from: GraphNode;
  readonly to: GraphNode;

  readonly railLineId: string | null;
  readonly edgeType: EdgeType;

  readonly travelMinutes: number;

  readonly waitMinutes: number;
  readonly confidence: Confidence;
}

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

  readonly forward: ReadonlyMap<GraphNode, readonly GraphEdge[]>;

  readonly reverse: ReadonlyMap<GraphNode, readonly GraphEdge[]>;
  readonly nodes: ReadonlySet<GraphNode>;
}

export interface TransitGraphs {
  readonly peak: TransitGraph;
  readonly offpeak: TransitGraph;
}

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

export function buildGraph(edges: readonly RailEdgeRow[], period: Period): TransitGraph {
  const forward = new Map<GraphNode, GraphEdge[]>();
  const reverse = new Map<GraphNode, GraphEdge[]>();
  const nodes = new Set<GraphNode>();

  for (const row of edges) {
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

export function buildGraphs(edges: readonly RailEdgeRow[]): TransitGraphs {
  return {
    peak: buildGraph(edges, "peak"),
    offpeak: buildGraph(edges, "offpeak"),
  };
}
