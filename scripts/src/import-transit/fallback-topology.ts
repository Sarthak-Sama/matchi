import { readFile } from "node:fs/promises";

import type { Confidence } from "@tokyo/shared";
import {
  DWELL_SECONDS_PER_INTERMEDIATE_STATION,
  FALLBACK_SPEEDS_KMH,
  haversineMeters,
  OFFPEAK_WAIT_MINUTES,
  PEAK_WAIT_MINUTES,
} from "@tokyo/shared";
import type { PoolClient } from "pg";

export interface NewFallbackEdge {
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

type Mode = keyof typeof FALLBACK_SPEEDS_KMH;
type SpeedsKmh = Record<Mode, number>;

export interface TopologyStation {
  readonly stationGroupId: string;
  readonly nameJa: string;
  readonly lat: number;
  readonly lon: number;
}

export interface TopologyOverrides {
  /** Lines whose chain is closed into a ring. */
  readonly loops: readonly string[];
  /** Lines whose stations are chained in the given order (group ids or names) instead of by MST. */
  readonly ordered: Readonly<Record<string, readonly string[]>>;
}

export interface LineLink {
  readonly fromId: string;
  readonly toId: string;
  readonly distanceM: number;
}

export interface FallbackTopologyResult {
  readonly edges: readonly NewFallbackEdge[];
  readonly warnings: readonly string[];
}

const OVERRIDES_PATH = "data/rail-topology-overrides.json";
const GTFS_SOURCE = "gtfs";

// Track is longer than the straight line between stations.
const RAIL_DETOUR_FACTOR = 1.15;
const LONG_EDGE_WARNING_M = 3000;
const BRANCH_DEGREE = 3;

function distanceM(a: TopologyStation, b: TopologyStation): number {
  return haversineMeters(a.lat, a.lon, b.lat, b.lon);
}

function link(a: TopologyStation, b: TopologyStation): LineLink {
  return { fromId: a.stationGroupId, toId: b.stationGroupId, distanceM: distanceM(a, b) };
}

/** Prim's minimum spanning tree over the stations, weighted by straight-line distance. */
function minimumSpanningTree(stations: readonly TopologyStation[]): LineLink[] {
  const [first, ...rest] = stations;
  if (first === undefined) return [];

  const links: LineLink[] = [];
  const unvisited = new Map(rest.map((s) => [s.stationGroupId, s]));
  const visited = [first];
  while (unvisited.size > 0) {
    let best: { from: TopologyStation; to: TopologyStation; distance: number } | undefined;
    for (const from of visited) {
      for (const to of unvisited.values()) {
        const distance = distanceM(from, to);
        if (best === undefined || distance < best.distance) best = { from, to, distance };
      }
    }
    if (best === undefined) break;
    links.push(link(best.from, best.to));
    visited.push(best.to);
    unvisited.delete(best.to.stationGroupId);
  }
  return links;
}

/** A reference is a station_group_id or a name_ja; members win over other stations on a name clash. */
function resolveStation(
  ref: string,
  members: readonly TopologyStation[],
  allStations: readonly TopologyStation[],
  railLineId: string,
): TopologyStation {
  for (const pool of [members, allStations]) {
    const byId = pool.find((s) => s.stationGroupId === ref);
    if (byId !== undefined) return byId;
    const byName = pool.filter((s) => s.nameJa === ref);
    if (byName.length === 1 && byName[0] !== undefined) return byName[0];
    if (byName.length > 1) {
      throw new Error(
        `${railLineId}: override station "${ref}" matches ${String(byName.length)} stations; use its station_group_id`,
      );
    }
  }
  throw new Error(`${railLineId}: override station "${ref}" not found`);
}

function chainInOrder(stations: readonly TopologyStation[]): LineLink[] {
  const links: LineLink[] = [];
  stations.forEach((station, i) => {
    const next = stations[i + 1];
    if (next !== undefined && next.stationGroupId !== station.stationGroupId) {
      links.push(link(station, next));
    }
  });
  return links;
}

function degrees(links: readonly LineLink[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const { fromId, toId } of links) {
    result.set(fromId, (result.get(fromId) ?? 0) + 1);
    result.set(toId, (result.get(toId) ?? 0) + 1);
  }
  return result;
}

function closeRing(
  links: readonly LineLink[],
  stations: readonly TopologyStation[],
  railLineId: string,
): LineLink[] {
  const ends = stations.filter((s) => degrees(links).get(s.stationGroupId) === 1);
  const [a, b] = ends;
  if (ends.length !== 2 || a === undefined || b === undefined) {
    throw new Error(
      `${railLineId}: a loop needs a chain with exactly 2 ends, found ${String(ends.length)}`,
    );
  }
  return [...links, link(a, b)];
}

/**
 * The undirected links of one line: a chain in the overridden order if there is one, otherwise the
 * minimum spanning tree of its member stations, closed into a ring if the line is a loop.
 */
export function planLineLinks(
  railLineId: string,
  members: readonly TopologyStation[],
  allStations: readonly TopologyStation[],
  overrides: TopologyOverrides,
): LineLink[] {
  const order = overrides.ordered[railLineId];
  const chainStations =
    order?.map((ref) => resolveStation(ref, members, allStations, railLineId)) ?? members;
  const links = order === undefined ? minimumSpanningTree(members) : chainInOrder(chainStations);
  return overrides.loops.includes(railLineId) ? closeRing(links, chainStations, railLineId) : links;
}

function minutesForLink(distance: number, speedKmh: number): number {
  const travelMinutes = ((distance * RAIL_DETOUR_FACTOR) / 1000 / speedKmh) * 60;
  return travelMinutes + DWELL_SECONDS_PER_INTERMEDIATE_STATION / 60;
}

function lineWarnings(
  railLineId: string,
  links: readonly LineLink[],
  overrides: TopologyOverrides,
): string[] {
  const warnings = links
    .filter((l) => l.distanceM > LONG_EDGE_WARNING_M)
    .map(
      (l) =>
        `rail_line "${railLineId}": edge ${l.fromId} - ${l.toId} is ` +
        `${(l.distanceM / 1000).toFixed(1)} km, over ${String(LONG_EDGE_WARNING_M / 1000)} km.`,
    );
  if (railLineId in overrides.ordered) return warnings;
  for (const [stationGroupId, degree] of degrees(links)) {
    if (degree >= BRANCH_DEGREE) {
      warnings.push(
        `rail_line "${railLineId}": station ${stationGroupId} has ${String(degree)} neighbours and ` +
          `is not covered by data/rail-topology-overrides.json.`,
      );
    }
  }
  return warnings;
}

async function loadOverrides(): Promise<TopologyOverrides> {
  const parsed = JSON.parse(await readFile(OVERRIDES_PATH, "utf8")) as Partial<TopologyOverrides>;
  return { loops: parsed.loops ?? [], ordered: parsed.ordered ?? {} };
}

/** Fitted speeds from transit_params when the table exists and has them, else the defaults. */
async function loadSpeeds(client: PoolClient): Promise<SpeedsKmh> {
  const speeds: SpeedsKmh = { ...FALLBACK_SPEEDS_KMH };
  const { rows: exists } = await client.query<{ present: boolean }>(
    `SELECT to_regclass('transit_params') IS NOT NULL AS present`,
  );
  if (exists[0]?.present !== true) return speeds;

  const { rows } = await client.query<{ key: string; value: number }>(
    `SELECT key, value FROM transit_params WHERE key LIKE 'speed_kmh.%'`,
  );
  for (const { key, value } of rows) {
    const mode = key.slice("speed_kmh.".length);
    if (mode in speeds && value > 0) speeds[mode as Mode] = value;
  }
  return speeds;
}

interface MemberRow {
  readonly rail_line_id: string;
  readonly mode: Mode;
  readonly station_group_id: string;
  readonly name_ja: string;
  readonly lat: number;
  readonly lon: number;
}

export async function computeFallbackEdges(client: PoolClient): Promise<FallbackTopologyResult> {
  const overrides = await loadOverrides();
  const speeds = await loadSpeeds(client);

  const { rows: lines } = await client.query<{ rail_line_id: string; mode: Mode }>(
    `SELECT rail_line_id, mode FROM rail_lines`,
  );
  const { rows: memberRows } = await client.query<MemberRow>(
    `SELECT m.rail_line_id, m.station_group_id, sg.name_ja,
            ST_Y(sg.point) AS lat, ST_X(sg.point) AS lon
     FROM station_line_members m
     JOIN station_groups sg USING (station_group_id)`,
  );
  const { rows: gtfsLines } = await client.query<{ rail_line_id: string }>(
    `SELECT DISTINCT rail_line_id FROM rail_edges
     WHERE source = $1 AND edge_type = 'ride' AND rail_line_id IS NOT NULL`,
    [GTFS_SOURCE],
  );
  const { rows: allRows } = await client.query<Omit<MemberRow, "rail_line_id" | "mode">>(
    `SELECT station_group_id, name_ja, ST_Y(point) AS lat, ST_X(point) AS lon FROM station_groups`,
  );

  const toStation = (r: Omit<MemberRow, "rail_line_id" | "mode">): TopologyStation => ({
    stationGroupId: r.station_group_id,
    nameJa: r.name_ja,
    lat: r.lat,
    lon: r.lon,
  });
  const allStations = allRows.map(toStation);
  const membersByLine = new Map<string, TopologyStation[]>();
  for (const row of memberRows) {
    const members = membersByLine.get(row.rail_line_id) ?? [];
    members.push(toStation(row));
    membersByLine.set(row.rail_line_id, members);
  }
  const gtfsLineIds = new Set(gtfsLines.map((l) => l.rail_line_id));

  const warnings: string[] = [];
  const edges: NewFallbackEdge[] = [];

  for (const line of lines) {
    if (gtfsLineIds.has(line.rail_line_id)) continue;

    const members = membersByLine.get(line.rail_line_id) ?? [];
    if (members.length < 2) {
      warnings.push(
        `rail_line "${line.rail_line_id}": fewer than 2 member stations in station_line_members — ` +
          `no edges derived for this line (run import:mlit first).`,
      );
      continue;
    }

    const links = planLineLinks(line.rail_line_id, members, allStations, overrides);
    warnings.push(...lineWarnings(line.rail_line_id, links, overrides));

    for (const { fromId, toId, distanceM: distance } of links) {
      const minutes = minutesForLink(distance, speeds[line.mode]);
      const commonFields = {
        railLineId: line.rail_line_id,
        edgeType: "ride" as const,
        peakTravelMinutes: minutes,
        offpeakTravelMinutes: minutes,
        peakWaitMinutes: PEAK_WAIT_MINUTES,
        offpeakWaitMinutes: OFFPEAK_WAIT_MINUTES,
        confidence: "low" as const,
      };
      edges.push({ ...commonFields, fromStationGroupId: fromId, toStationGroupId: toId });
      edges.push({ ...commonFields, fromStationGroupId: toId, toStationGroupId: fromId });
    }
  }

  return { edges, warnings };
}
