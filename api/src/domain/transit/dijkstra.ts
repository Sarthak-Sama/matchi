/**
 * The reverse Dijkstra commute search. Run ONCE per optimization request,
 * seeded at the destination's access stations, walking the graph's REVERSE
 * adjacency (i.e. simulating travel backwards in time from the destination
 * towards every candidate origin). The result is "cost to reach the
 * destination FROM node X" for every reachable X — not the other way
 * around, which matters once the graph is asymmetric (see the module doc
 * below for why reversal is safe here).
 *
 * ---------------------------------------------------------------------
 * Multi-source: the destination is a POINT, not a station
 * ---------------------------------------------------------------------
 * A real destination (an office) sits between stations, so the search is
 * seeded with SEVERAL access stations, each carrying its own
 * `walkMinutes` — the walk from that station to the destination point.
 * Each seed therefore enters the search at cost `walkMinutes` rather than
 * at cost 0, which is what lets the search itself decide which access
 * station wins for each candidate origin: an origin two stops from a
 * station with an 11-minute walk may still prefer a station five stops
 * away with a 2-minute walk, and only a search that pays the walk up
 * front can see that. Seeding every access station at 0 and adding the
 * walk afterwards optimizes the rail leg in isolation and picks the wrong
 * access station.
 *
 * This is exactly a single-source search from a virtual super-source
 * joined to each seed by an edge of weight `walkMinutes` — the super-source
 * is never materialized, its outgoing edges are simply pre-relaxed into
 * the heap before the first `pop()`. All those weights are non-negative
 * (enforced by `reverseDijkstra`), so the pop sequence stays monotonically
 * non-decreasing and Dijkstra's settle-once argument is untouched.
 *
 * That destination-side walk is carried verbatim on every state as
 * `destinationWalkMinutes` and is included in `totalMinutes`. It is
 * deliberately NOT folded into `waitMinutes`: the response reports the
 * components separately ("8 min walk + 24 rail + 6 wait + 11 min walk to
 * the office"), and a 6-minute wait must not be reported as an 18-minute
 * one.
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
  /**
   * `railMinutes + waitMinutes + transferPenaltyMinutes +
   * destinationWalkMinutes`. Excludes the ORIGIN-side access walk (the
   * neighbourhood-to-station walk, added once in `estimateCommute`).
   */
  readonly totalMinutes: number;
  readonly railMinutes: number;
  readonly waitMinutes: number;
  readonly transferCount: number;
  readonly transferPenaltyMinutes: number;
  /**
   * The walk from the access station this path ends at to the true
   * destination point — i.e. the `walkMinutes` of whichever seed the best
   * path reaches. Set once when the seed enters the search and carried
   * verbatim through every relaxation.
   */
  readonly destinationWalkMinutes: number;
  /** The minimum confidence among every edge on this node's best path. */
  readonly confidence: Confidence;
  /** `null` for a seed access station itself (the search's roots). */
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
  readonly destinationWalkMinutes: number;
  readonly confidence: Confidence;
  readonly previous: DijkstraPrevious | null;
}

/**
 * One access station for the true destination point, and the walk from
 * that station to it. See the module doc comment's "Multi-source" section.
 */
export interface DijkstraSeed {
  readonly node: GraphNode;
  /**
   * Minutes on foot from `node` to the destination point. Must be finite
   * and non-negative — `reverseDijkstra` throws otherwise.
   */
  readonly walkMinutes: number;
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
      // Carried verbatim: the destination-side walk belongs to the seed
      // this path ends at, and no rail edge can change it.
      destinationWalkMinutes: current.destinationWalkMinutes,
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
      destinationWalkMinutes: current.destinationWalkMinutes,
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
    destinationWalkMinutes: current.destinationWalkMinutes,
    confidence: minConfidence(current.confidence, edge.confidence),
    previous,
  };
}

/**
 * Collapses `seeds` to at most one entry per node, keeping the SMALLEST
 * `walkMinutes`, and rejects walks that would break the search.
 *
 * Keeping the MINIMUM walk is the only correct reading — if two walking
 * routes reach the same station you take the shorter one — and it is what
 * makes the seed phase order-independent by construction. Two seeds for
 * the same node share the same `(node, null)` state key, so without this
 * the result depends on `offer`'s min-guard alone to discard the worse
 * duplicate. That guard does hold today, which makes this the second of
 * two layers rather than the only one; it is here because dropping to a
 * single layer fails silently. A "last one wins" dedupe (the easy thing to
 * write) is worse than no dedupe at all: it reports the wrong walk and can
 * route origins through the wrong access station.
 *
 * The validation is here rather than at a schema boundary because this is
 * a pure-domain function with no schema in scope, and the failure it
 * prevents is a domain failure: `NaN` makes every `<` comparison false,
 * so the seed is silently never recorded as an improvement and the node
 * vanishes from the result instead of crashing. A negative walk breaks
 * settle-once outright (Dijkstra's proof needs non-negative weights).
 * Neither shows up as a crash or a type error — only as wrong numbers.
 */
function normalizeSeeds(seeds: readonly DijkstraSeed[]): DijkstraSeed[] {
  const bestWalkByNode = new Map<GraphNode, number>();
  for (const seed of seeds) {
    if (!Number.isFinite(seed.walkMinutes)) {
      throw new Error(
        `reverseDijkstra: seed "${seed.node}" has a non-finite walkMinutes ` +
          `(${String(seed.walkMinutes)}); walk minutes must be a finite number.`,
      );
    }
    if (seed.walkMinutes < 0) {
      throw new Error(
        `reverseDijkstra: seed "${seed.node}" has a negative walkMinutes ` +
          `(${String(seed.walkMinutes)}); walk minutes must be >= 0.`,
      );
    }
    const known = bestWalkByNode.get(seed.node);
    if (known === undefined || seed.walkMinutes < known) {
      bestWalkByNode.set(seed.node, seed.walkMinutes);
    }
  }
  return [...bestWalkByNode].map(([node, walkMinutes]) => ({ node, walkMinutes }));
}

/**
 * Runs one reverse Dijkstra from every seed access station over `graph`'s
 * reverse adjacency, returning the best-cost path to the destination
 * POINT from every reachable node — including each path's own
 * destination-side walk, so origins that are better served by a
 * further-but-closer-to-the-office station are ranked correctly. Nodes
 * with no path to any seed are absent from the returned map.
 *
 * Throws when `seeds` is empty, or when any seed's `walkMinutes` is
 * non-finite or negative.
 *
 * An empty seed list throws rather than returning an empty result on
 * purpose. An empty result is not a wrong answer in the abstract — a
 * search from no sources reaches nothing — but it is indistinguishable
 * from a genuinely disconnected graph, so the caller would render a
 * plausible-looking "no neighbourhood is reachable" response for what is
 * really a bug or an unresolvable destination. Callers must decide what
 * an unresolvable destination means BEFORE calling: the route validates
 * the destination and returns its own error code (Task 6), which makes
 * this throw an unreachable backstop in production rather than a
 * user-facing path.
 */
export function reverseDijkstra(
  graph: TransitGraph,
  seeds: readonly DijkstraSeed[],
): DijkstraResult {
  if (seeds.length === 0) {
    throw new Error(
      "reverseDijkstra: seeds must not be empty — a search with no access " +
        "stations reaches nothing, which is indistinguishable from a fully " +
        "disconnected graph. Reject an unresolvable destination before calling.",
    );
  }

  const byNode = new Map<GraphNode, DijkstraState>();
  /** Every settled `(node, line)` state, not just each node's winner — see `DijkstraResult`'s doc comment. */
  const byState = new Map<string, SearchState>();
  const settled = new Set<string>();
  /** Best known `totalMinutes` per `(node, line)` state seen so far, settled or not — guards duplicate heap entries. */
  const bestSeen = new Map<string, number>();
  const heap = new MinHeap<SearchState>();

  /**
   * The ONLY way a state enters the heap — seeds and relaxations alike.
   *
   * INVARIANT: a state's heap priority is ALWAYS its own `totalMinutes`.
   * `MinHeap.push` takes the priority as a separate argument that the type
   * system cannot relate to the value, so the two can silently drift; when
   * they do, states pop out of cost order and the search returns
   * wrong-but-plausible times with no crash, no type error, and no failing
   * "a number came back" test. Funnelling every push through here is what
   * makes that drift impossible to introduce at a call site.
   *
   * Sharing the `settled`/`bestSeen` min-guard with the seed phase is the
   * other half: a seed must be admitted under exactly this guard, never a
   * blind `bestSeen.set`, because seeds for the same node collide on one
   * `(node, null)` key and a blind write of a worse walk would both report
   * the worse cost and lock the better state out as "not an improvement".
   */
  const offer = (state: SearchState): void => {
    const key = stateKey(state.node, state.currentLineId);
    if (settled.has(key)) return;
    const known = bestSeen.get(key);
    if (known !== undefined && state.totalMinutes >= known) return;
    bestSeen.set(key, state.totalMinutes);
    heap.push(state.totalMinutes, state);
  };

  // Every seed must be in the heap BEFORE the first pop(): Dijkstra settles
  // a state permanently on pop, which is only sound while the pop sequence
  // is monotonically non-decreasing. A seed offered after the loop has
  // started could arrive cheaper than an already-settled state and would
  // simply be ignored.
  //
  // `currentLineId: null` (so the first boarding pays its wait and no
  // implicit-transfer penalty) and `confidence: "high"` (a walk crosses no
  // edge, and "high" is the identity of the `minConfidence` fold — the
  // value is a statement about EDGE data provenance) are both deliberate;
  // see the module doc comment.
  for (const seed of normalizeSeeds(seeds)) {
    offer({
      node: seed.node,
      currentLineId: null,
      totalMinutes: seed.walkMinutes,
      railMinutes: 0,
      waitMinutes: 0,
      transferCount: 0,
      transferPenaltyMinutes: 0,
      destinationWalkMinutes: seed.walkMinutes,
      confidence: "high",
      previous: null,
    });
  }

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
        destinationWalkMinutes: current.destinationWalkMinutes,
        confidence: current.confidence,
        previous: current.previous,
      });
    }

    const incoming = graph.reverse.get(current.node) ?? [];
    for (const edge of incoming) {
      offer(relax(current, edge));
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
