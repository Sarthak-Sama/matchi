import type { Confidence } from "@tokyo/shared";
import { TRANSFER_PENALTY_MINUTES } from "@tokyo/shared";

import type { EdgeType, GraphEdge, GraphNode, TransitGraph } from "./graph.js";

export interface DijkstraPrevious {
  readonly node: GraphNode;

  readonly railLineId: string | null;

  readonly previousLineId: string | null;
  readonly edgeType: EdgeType;
}

export interface DijkstraState {
  readonly totalMinutes: number;
  readonly railMinutes: number;
  readonly waitMinutes: number;
  readonly transferCount: number;
  readonly transferPenaltyMinutes: number;

  readonly destinationWalkMinutes: number;

  readonly confidence: Confidence;

  readonly previous: DijkstraPrevious | null;
}

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

  getState(key: string): SearchState | undefined {
    return this.byState.get(key);
  }
}

interface HeapEntry<T> {
  readonly priority: number;
  readonly value: T;
}

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

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

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

export interface DijkstraSeed {
  readonly node: GraphNode;

  readonly walkMinutes: number;
}

const KEY_SEPARATOR = "\u0001";
const NO_LINE = "\u0000";

function stateKey(node: GraphNode, lineId: string | null): string {
  return `${node}${KEY_SEPARATOR}${lineId ?? NO_LINE}`;
}

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

      destinationWalkMinutes: current.destinationWalkMinutes,
      confidence: minConfidence(current.confidence, edge.confidence),
      previous,
    };
  }

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

  const byState = new Map<string, SearchState>();
  const settled = new Set<string>();

  const bestSeen = new Map<string, number>();
  const heap = new MinHeap<SearchState>();

  const offer = (state: SearchState): void => {
    const key = stateKey(state.node, state.currentLineId);
    if (settled.has(key)) return;
    const known = bestSeen.get(key);
    if (known !== undefined && state.totalMinutes >= known) return;
    bestSeen.set(key, state.totalMinutes);
    heap.push(state.totalMinutes, state);
  };

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

export interface PathHop {
  readonly stationGroupId: GraphNode;

  readonly railLineId: string | null;

  readonly edgeType: EdgeType | null;
}

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
