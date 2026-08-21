/**
 * The reverse Dijkstra commute search. Run ONCE per optimization request,
 * seeded at the destination, walking the graph's REVERSE adjacency (i.e.
 * simulating travel backwards in time from the destination towards every
 * candidate origin). The result is "cost to reach the destination FROM
 * node X" for every reachable X — not the other way around, which matters
 * once the graph is asymmetric (see the module doc below for why reversal
 * is safe here).
 *
 * ---------------------------------------------------------------------
 * The cost model (see task-8-brief.md for the authoritative statement)
 * ---------------------------------------------------------------------
 * - `ride` edge: `travelMinutes` always. `waitMinutes` (the boarding wait)
 *   is added only when this edge starts a NEW run — i.e. the search state
 *   arrives at this edge either with no current line (journey start, or
 *   just after a transfer) or with a DIFFERENT current line (an implicit
 *   transfer, see below). Continuing the same line adds `travelMinutes`
 *   only.
 * - explicit `transfer` edge: `travelMinutes + TRANSFER_PENALTY_MINUTES`,
 *   `transferCount + 1`, and resets the current-line state to "none" (the
 *   next ride edge always pays a fresh boarding wait, and does NOT pay an
 *   extra implicit-transfer penalty — the transfer edge already paid one).
 * - implicit transfer: a ride edge whose line differs from the search
 *   state's current (non-null) line, with no explicit transfer edge
 *   between them (real station complexes often omit one). Costs
 *   `TRANSFER_PENALTY_MINUTES + travelMinutes + waitMinutes` and
 *   increments `transferCount`, exactly like hitting an explicit transfer
 *   edge immediately followed by a fresh boarding.
 *
 * Search state is therefore `(node, currentLineId)`, not just `node` — see
 * `SearchState` below — because whether the next ride edge owes a wait (and
 * whether it's an implicit transfer) depends on which line the search
 * arrived on.
 *
 * ---------------------------------------------------------------------
 * Why "charge on entry" during the reverse walk is correct
 * ---------------------------------------------------------------------
 * In FORWARD time, the boarding wait for a run of same-line ride edges
 * belongs to the run's FIRST edge (where you actually wait for the
 * train) — which, walking BACKWARDS from the destination, is the LAST
 * edge of that run to be processed. Rather than deferring the charge
 * until that (unknowable in advance, at the moment of relaxation) edge,
 * this implementation charges the wait on the run's FIRST-processed
 * backward edge instead (i.e. the edge nearest the destination end of the
 * run) — whenever the search state's current line changes (including
 * from "none"). This is the `!sameLine` branch below.
 *
 * This produces an IDENTICAL total to charging on the true forward
 * boarding edge, because addition is commutative: the sum of a run's
 * travelMinutes plus exactly one wait charge is the same regardless of
 * which edge in the run nominally carries the wait, AS LONG AS every ride
 * edge of a given line/period carries the same `waitMinutes` value — true
 * here because `buildGraph` derives `waitMinutes` from the line's period
 * wait column (or the global constant), not a value that varies edge to
 * edge within one line's run. Deferring the charge to the "true" boarding
 * edge instead would require revising an already-computed state's cost
 * downward as the search extends deeper into a run, which is incompatible
 * with Dijkstra's requirement that a popped/settled state's cost never
 * decreases afterwards. "Charge on entry" avoids that entirely while
 * producing the same totals. See task-8-report.md for a worked trace.
 */

import type { Confidence } from "@tokyo/shared";
import { TRANSFER_PENALTY_MINUTES } from "@tokyo/shared";

import type { EdgeType, GraphEdge, GraphNode, TransitGraph } from "./graph.js";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface DijkstraPrevious {
  /** The node this hop travels TO (i.e. one step closer to the destination). */
  readonly node: GraphNode;
  /** The line ridden (or `null` for a transfer) to get from this node to `node`. */
  readonly railLineId: string | null;
  readonly edgeType: EdgeType;
}

export interface DijkstraState {
  /** `railMinutes + waitMinutes + transferPenaltyMinutes`. Excludes the access walk. */
  readonly totalMinutes: number;
  readonly railMinutes: number;
  readonly waitMinutes: number;
  readonly transferCount: number;
  readonly transferPenaltyMinutes: number;
  /** The minimum confidence among every edge on this node's best path. */
  readonly confidence: Confidence;
  /** `null` for the destination itself (the search root). */
  readonly previous: DijkstraPrevious | null;
}

/** Per station_group id, the best (lowest `totalMinutes`) path to the destination. Unreachable nodes are absent. */
export type DijkstraResult = ReadonlyMap<GraphNode, DijkstraState>;

// ---------------------------------------------------------------------------
// Binary-heap priority queue
// ---------------------------------------------------------------------------

interface HeapEntry<T> {
  readonly priority: number;
  readonly value: T;
}

/** Small binary min-heap, written locally so this module has no new dependency. */
class MinHeap<T> {
  private readonly items: HeapEntry<T>[] = [];

  size(): number {
    return this.items.length;
  }

  push(priority: number, value: T): void {
    this.items.push({ priority, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentItem = this.items[parent];
      const item = this.items[i];
      if (!parentItem || !item || parentItem.priority <= item.priority) break;
      this.items[parent] = item;
      this.items[i] = parentItem;
      i = parent;
    }
  }

  pop(): T | undefined {
    const top = this.items[0];
    if (!top) return undefined;
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        const smallestItem = this.items[smallest];
        const leftItem = this.items[left];
        const rightItem = this.items[right];
        if (
          left < this.items.length &&
          leftItem &&
          smallestItem &&
          leftItem.priority < smallestItem.priority
        ) {
          smallest = left;
        }
        const currentSmallest = this.items[smallest];
        if (
          right < this.items.length &&
          rightItem &&
          currentSmallest &&
          rightItem.priority < currentSmallest.priority
        ) {
          smallest = right;
        }
        if (smallest === i) break;
        const tmp = this.items[i];
        const swap = this.items[smallest];
        if (!tmp || !swap) break;
        this.items[i] = swap;
        this.items[smallest] = tmp;
        i = smallest;
      }
    }
    return top.value;
  }
}

// ---------------------------------------------------------------------------
// reverseDijkstra
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

/** `(node, currentLineId)` — the actual unit of search state, per the cost model above. */
interface SearchState {
  readonly node: GraphNode;
  readonly currentLineId: string | null;
  readonly totalMinutes: number;
  readonly railMinutes: number;
  readonly waitMinutes: number;
  readonly transferCount: number;
  readonly transferPenaltyMinutes: number;
  readonly confidence: Confidence;
  readonly previous: DijkstraPrevious | null;
}

/**
 * `KEY_SEPARATOR` and `NO_LINE` are both single control characters that
 * cannot appear in a real Postgres `text` station_group_id or
 * rail_line_id, so this plain string concatenation can never collide
 * between two different `(node, line)` pairs (e.g. node "a" + line "bc"
 * vs. node "ab" + line "c" would collide under naive concatenation
 * without a separator).
 */
const KEY_SEPARATOR = "\u0001";
const NO_LINE = "\u0000";

function stateKey(node: GraphNode, lineId: string | null): string {
  return `${node}${KEY_SEPARATOR}${lineId ?? NO_LINE}`;
}

/** Builds the next search state produced by walking `edge` backward from `current`. */
function relax(current: SearchState, edge: GraphEdge): SearchState {
  const previous: DijkstraPrevious = {
    node: current.node,
    railLineId: edge.railLineId,
    edgeType: edge.edgeType,
  };

  if (edge.edgeType === "transfer") {
    return {
      node: edge.from,
      currentLineId: null,
      totalMinutes: current.totalMinutes + edge.travelMinutes + TRANSFER_PENALTY_MINUTES,
      railMinutes: current.railMinutes + edge.travelMinutes,
      waitMinutes: current.waitMinutes,
      transferCount: current.transferCount + 1,
      transferPenaltyMinutes: current.transferPenaltyMinutes + TRANSFER_PENALTY_MINUTES,
      confidence: minConfidence(current.confidence, edge.confidence),
      previous,
    };
  }

  // Ride edge.
  const sameLine = current.currentLineId === edge.railLineId;
  if (sameLine) {
    return {
      node: edge.from,
      currentLineId: edge.railLineId,
      totalMinutes: current.totalMinutes + edge.travelMinutes,
      railMinutes: current.railMinutes + edge.travelMinutes,
      waitMinutes: current.waitMinutes,
      transferCount: current.transferCount,
      transferPenaltyMinutes: current.transferPenaltyMinutes,
      confidence: minConfidence(current.confidence, edge.confidence),
      previous,
    };
  }

  // Different line: a fresh boarding. An IMPLICIT transfer only when the
  // prior state already had a real line (i.e. this isn't the journey
  // start and isn't right after an explicit transfer edge, both of which
  // leave `currentLineId` as `null`).
  const isImplicitTransfer = current.currentLineId !== null;
  const penalty = isImplicitTransfer ? TRANSFER_PENALTY_MINUTES : 0;
  return {
    node: edge.from,
    currentLineId: edge.railLineId,
    totalMinutes: current.totalMinutes + edge.travelMinutes + edge.waitMinutes + penalty,
    railMinutes: current.railMinutes + edge.travelMinutes,
    waitMinutes: current.waitMinutes + edge.waitMinutes,
    transferCount: current.transferCount + (isImplicitTransfer ? 1 : 0),
    transferPenaltyMinutes: current.transferPenaltyMinutes + penalty,
    confidence: minConfidence(current.confidence, edge.confidence),
    previous,
  };
}

/**
 * Runs one reverse Dijkstra from `destinationId` over `graph`'s reverse
 * adjacency, returning the best-cost path to the destination from every
 * reachable node. Nodes with no path to the destination are absent from
 * the returned map.
 */
export function reverseDijkstra(graph: TransitGraph, destinationId: GraphNode): DijkstraResult {
  const result = new Map<GraphNode, DijkstraState>();
  const settled = new Set<string>();
  /** Best known `totalMinutes` per `(node, line)` state seen so far, settled or not — guards duplicate heap entries. */
  const bestSeen = new Map<string, number>();
  const heap = new MinHeap<SearchState>();

  const start: SearchState = {
    node: destinationId,
    currentLineId: null,
    totalMinutes: 0,
    railMinutes: 0,
    waitMinutes: 0,
    transferCount: 0,
    transferPenaltyMinutes: 0,
    confidence: "high",
    previous: null,
  };
  bestSeen.set(stateKey(start.node, start.currentLineId), 0);
  heap.push(0, start);

  while (heap.size() > 0) {
    const current = heap.pop();
    if (!current) break;

    const key = stateKey(current.node, current.currentLineId);
    if (settled.has(key)) continue;
    settled.add(key);

    const existing = result.get(current.node);
    if (!existing || current.totalMinutes < existing.totalMinutes) {
      result.set(current.node, {
        totalMinutes: current.totalMinutes,
        railMinutes: current.railMinutes,
        waitMinutes: current.waitMinutes,
        transferCount: current.transferCount,
        transferPenaltyMinutes: current.transferPenaltyMinutes,
        confidence: current.confidence,
        previous: current.previous,
      });
    }

    const incoming = graph.reverse.get(current.node) ?? [];
    for (const edge of incoming) {
      const next = relax(current, edge);
      const nextKey = stateKey(next.node, next.currentLineId);
      if (settled.has(nextKey)) continue;

      const known = bestSeen.get(nextKey);
      if (known === undefined || next.totalMinutes < known) {
        bestSeen.set(nextKey, next.totalMinutes);
        heap.push(next.totalMinutes, next);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// reconstructPath
// ---------------------------------------------------------------------------

export interface PathHop {
  readonly stationGroupId: GraphNode;
  /** The line ridden departing this station towards the next hop; `null` for a transfer hop or the final (destination) hop. */
  readonly railLineId: string | null;
  /** `null` only for the final (destination) hop, which has no further departure. */
  readonly edgeType: EdgeType | null;
}

/**
 * Walks `result`'s `previous` chain from `fromStationGroupId` to the
 * destination, returning the ordered list of stations with the line used
 * to depart each one. Returns `null` when `fromStationGroupId` is
 * unreachable (absent from `result`).
 */
export function reconstructPath(
  result: DijkstraResult,
  fromStationGroupId: GraphNode,
): PathHop[] | null {
  if (!result.has(fromStationGroupId)) return null;

  const hops: PathHop[] = [];
  let currentNode: GraphNode | undefined = fromStationGroupId;

  while (currentNode !== undefined) {
    const state: DijkstraState | undefined = result.get(currentNode);
    if (!state) {
      throw new Error(
        `reconstructPath: missing state for node "${currentNode}" while walking the path ` +
          `from "${fromStationGroupId}" — the previous chain references an unsettled node.`,
      );
    }
    hops.push({
      stationGroupId: currentNode,
      railLineId: state.previous?.railLineId ?? null,
      edgeType: state.previous?.edgeType ?? null,
    });
    currentNode = state.previous?.node;
  }

  return hops;
}
