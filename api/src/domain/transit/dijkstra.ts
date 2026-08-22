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
 * Why "charge on entry" is not a workaround — it is the only correct
 * formulation for a REVERSE search
 * ---------------------------------------------------------------------
 * It's tempting to describe this as an approximation of "the true forward
 * boarding edge" — it isn't. In a reverse search, EVERY node visited is
 * itself a candidate origin whose reported cost must be final the moment
 * it's settled. A ride edge run doesn't belong to one single traveller
 * walking end to end; every intermediate node on that run is a distinct
 * possible origin, and each one needs its OWN boarding wait already
 * included in its own settled cost. If the charge were deferred to the
 * run's true forward-boarding edge (the LAST edge processed walking
 * backward), every node settled *before* that point — i.e. every
 * mid-run origin — would be settled with zero wait recorded, undercounting
 * exactly the origins this search exists to estimate for. Charging on
 * entry (the `!sameLine` branch below, whenever the search state's
 * current line changes, including from "none") is what makes every
 * settled state's cost already complete and correct as a real commute
 * estimate for that node as an origin, which a forward search (single
 * traveller, single origin, wait deferred until you know it precedes a
 * transfer) doesn't need to guarantee for its intermediate nodes.
 *
 * A useful cross-check, not the reason this is correct: it also happens
 * to produce the same TOTAL at the true origin as attributing the wait to
 * the true forward boarding edge would, because addition is commutative —
 * the sum of a run's travelMinutes plus exactly one wait charge doesn't
 * depend on which edge in the run nominally carries it. That equivalence
 * relies on every ride edge of a given line/period carrying the SAME
 * `waitMinutes` value. `buildGraph`/`resolveWaitMinutes` (`graph.ts`)
 * reads `peak_wait_minutes`/`offpeak_wait_minutes` per ROW, so nothing
 * stops two edges on the same line from carrying different values if a
 * future importer (e.g. Task 14's GTFS import) sets them inconsistently.
 * Should that happen, this search would charge whichever edge sits at the
 * destination-end of the run, not necessarily the smallest or most
 * "correct" one — harmless under the current uniform seed data, but worth
 * knowing about before trusting per-edge wait overrides at scale. Trying
 * to "fix" this by deferring to the forward boarding edge instead would
 * reintroduce the undercounting bug described above — don't.
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
  /**
   * The `currentLineId` of the EXACT predecessor state — `(node,
   * previousLineId)` — that this state was relaxed from. Needed because a
   * node can be settled at more than one `(node, line)` state (a
   * branching station), and that node's own independently-best state can
   * differ from the specific state a path passing through it actually
   * used. `reconstructPath` uses this to keep walking the same state
   * chain instead of falling back to `node`'s own best state, which could
   * silently substitute a costlier route next to a correct `totalMinutes`.
   */
  readonly previousLineId: string | null;
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

/**
 * Per station_group id, the best (lowest `totalMinutes`) path to the
 * destination — `get`/`has` behave exactly like the
 * `Map<stationGroupId, {...}>` described in the task brief. Unreachable
 * nodes are absent (`get` returns `undefined`, `has` returns `false`).
 *
 * Internally this also carries every settled `(node, line)` state (not
 * just the per-node winner), because `reconstructPath` needs to walk the
 * exact state chain a path used rather than re-looking-up each
 * intermediate node's own independently-best state — see
 * `DijkstraPrevious.previousLineId`'s doc comment. That index is
 * intentionally not part of the public `get`/`has` surface.
 */
export class DijkstraResult {
  private readonly byNode: ReadonlyMap<GraphNode, DijkstraState>;
  private readonly byState: ReadonlyMap<string, SearchState>;

  constructor(
    byNode: ReadonlyMap<GraphNode, DijkstraState>,
    byState: ReadonlyMap<string, SearchState>,
  ) {
    this.byNode = byNode;
    this.byState = byState;
  }

  get(node: GraphNode): DijkstraState | undefined {
    return this.byNode.get(node);
  }

  has(node: GraphNode): boolean {
    return this.byNode.has(node);
  }

  /** `reconstructPath`-only: the full settled state for a `(node, line)` key (see `stateKey`). */
  getState(key: string): SearchState | undefined {
    return this.byState.get(key);
  }
}

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
    previousLineId: current.currentLineId,
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
  const byNode = new Map<GraphNode, DijkstraState>();
  /** Every settled `(node, line)` state, not just each node's winner — see `DijkstraResult`'s doc comment. */
  const byState = new Map<string, SearchState>();
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
    byState.set(key, current);

    const existing = byNode.get(current.node);
    if (!existing || current.totalMinutes < existing.totalMinutes) {
      byNode.set(current.node, {
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

  return new DijkstraResult(byNode, byState);
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
 * Walks the EXACT `(node, line)` state chain that produced
 * `fromStationGroupId`'s best cost, returning the ordered list of
 * stations with the line used to depart each one. Returns `null` when
 * `fromStationGroupId` is unreachable (absent from `result`).
 *
 * This deliberately does NOT re-look-up each intermediate node's own
 * best state via `result.get(node)` — at a branching station, a node's
 * own independently-cheapest state can differ from the specific state
 * that a path passing through it actually used (e.g. arriving on a
 * different line than the one that node's own best path arrives on),
 * which would silently substitute a costlier route next to a correct
 * `totalMinutes`. Instead it follows `DijkstraPrevious.previousLineId`
 * through `result`'s internal per-`(node, line)` state index at every
 * step after the first.
 */
export function reconstructPath(
  result: DijkstraResult,
  fromStationGroupId: GraphNode,
): PathHop[] | null {
  const startState = result.get(fromStationGroupId);
  if (!startState) return null;

  const hops: PathHop[] = [];
  let node: GraphNode = fromStationGroupId;
  let previous: DijkstraPrevious | null = startState.previous;

  for (;;) {
    hops.push({
      stationGroupId: node,
      railLineId: previous?.railLineId ?? null,
      edgeType: previous?.edgeType ?? null,
    });

    if (!previous) return hops;

    const nextState = result.getState(stateKey(previous.node, previous.previousLineId));
    if (!nextState) {
      throw new Error(
        `reconstructPath: missing settled state for node "${previous.node}" ` +
          `(line ${previous.previousLineId ?? "none"}) while walking the path ` +
          `from "${fromStationGroupId}" — the previous chain references an ` +
          `unsettled state.`,
      );
    }
    node = previous.node;
    previous = nextState.previous;
  }
}
