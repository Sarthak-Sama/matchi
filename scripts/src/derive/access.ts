import type { Pool, PoolClient } from "pg";

import {
  ACCESS_HUBS,
  buildGraph,
  DIRECT_REACH_MINUTES,
  reverseDijkstra,
  TRANSFER_PENALTY_MINUTES,
} from "@tokyo/shared";
import type { Confidence, RailEdgeRow, TransitGraph, TransitPeriod } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import type { StepResult } from "./types.js";

const PERIODS: readonly TransitPeriod[] = ["peak", "offpeak"];
const INSERT_CHUNK = 20_000;

export interface TravelTimeRow {
  readonly from: string;
  readonly to: string;
  readonly period: TransitPeriod;
  readonly minutes: number;
  readonly transfers: number;
  readonly confidence: Confidence;
}

// One reverse search per destination yields the time from every origin to
// it, so N searches per period fill the N x N matrix. Self pairs are 0.
export function computeTravelTimes(
  graph: TransitGraph,
  transferPenaltyMinutes: number = TRANSFER_PENALTY_MINUTES,
): TravelTimeRow[] {
  const rows: TravelTimeRow[] = [];
  for (const destination of [...graph.nodes].sort()) {
    const result = reverseDijkstra(
      graph,
      [{ node: destination, walkMinutes: 0 }],
      transferPenaltyMinutes,
    );
    for (const origin of graph.nodes) {
      const state = result.get(origin);
      if (!state) continue;
      rows.push({
        from: origin,
        to: destination,
        period: graph.period,
        minutes: Math.round(state.totalMinutes * 10) / 10,
        transfers: state.transferCount,
        confidence: state.confidence,
      });
    }
  }
  return rows;
}

export interface StationAccessRow {
  readonly stationGroupId: string;
  readonly lineCount: number;
  readonly directReachStations: number;
  readonly stationsWithin30Min: number;
}

// Stations reachable by staying on one line, counting ride minutes only (no
// wait), within `limitMinutes`.
function directReach(edges: readonly RailEdgeRow[], limitMinutes: number): Map<string, number> {
  const byLine = new Map<string, Map<string, { to: string; minutes: number }[]>>();
  for (const e of edges) {
    if (e.edgeType !== "ride" || e.railLineId === null) continue;
    const adjacency = byLine.get(e.railLineId) ?? new Map();
    byLine.set(e.railLineId, adjacency);
    const out = adjacency.get(e.fromStationGroupId) ?? [];
    out.push({ to: e.toStationGroupId, minutes: e.peakTravelMinutes });
    adjacency.set(e.fromStationGroupId, out);
  }

  const reached = new Map<string, Set<string>>();
  for (const adjacency of byLine.values()) {
    for (const start of adjacency.keys()) {
      const best = new Map<string, number>([[start, 0]]);
      const frontier: string[] = [start];
      while (frontier.length > 0) {
        frontier.sort((a, b) => (best.get(b) ?? 0) - (best.get(a) ?? 0));
        const node = frontier.pop();
        if (node === undefined) break;
        const base = best.get(node) ?? 0;
        for (const next of adjacency.get(node) ?? []) {
          const minutes = base + next.minutes;
          if (minutes > limitMinutes) continue;
          const known = best.get(next.to);
          if (known !== undefined && known <= minutes) continue;
          best.set(next.to, minutes);
          frontier.push(next.to);
        }
      }
      const set = reached.get(start) ?? new Set<string>();
      for (const node of best.keys()) if (node !== start) set.add(node);
      reached.set(start, set);
    }
  }
  return new Map([...reached].map(([station, set]) => [station, set.size]));
}

export function computeStationAccess(
  edges: readonly RailEdgeRow[],
  peakTimes: readonly TravelTimeRow[],
  limitMinutes = DIRECT_REACH_MINUTES,
): StationAccessRow[] {
  const lines = new Map<string, Set<string>>();
  const addLine = (station: string, line: string): void => {
    const set = lines.get(station) ?? new Set<string>();
    set.add(line);
    lines.set(station, set);
  };
  const stations = new Set<string>();
  for (const e of edges) {
    stations.add(e.fromStationGroupId);
    stations.add(e.toStationGroupId);
    if (e.edgeType === "ride" && e.railLineId !== null) {
      addLine(e.fromStationGroupId, e.railLineId);
      addLine(e.toStationGroupId, e.railLineId);
    }
  }

  const within = new Map<string, number>();
  for (const row of peakTimes) {
    if (row.period !== "peak" || row.from === row.to || row.minutes > limitMinutes) continue;
    within.set(row.from, (within.get(row.from) ?? 0) + 1);
  }

  const direct = directReach(edges, limitMinutes);
  return [...stations].sort().map((id) => ({
    stationGroupId: id,
    lineCount: lines.get(id)?.size ?? 0,
    directReachStations: direct.get(id) ?? 0,
    stationsWithin30Min: within.get(id) ?? 0,
  }));
}

async function loadEdges(client: PoolClient): Promise<RailEdgeRow[]> {
  const { rows } = await client.query<RailEdgeRow>(`
    SELECT re.from_station_group_id AS "fromStationGroupId",
      re.to_station_group_id AS "toStationGroupId",
      re.rail_line_id AS "railLineId",
      rl.name_en AS "railLineName",
      re.edge_type AS "edgeType",
      re.peak_travel_minutes AS "peakTravelMinutes",
      re.offpeak_travel_minutes AS "offpeakTravelMinutes",
      re.peak_wait_minutes AS "peakWaitMinutes",
      re.offpeak_wait_minutes AS "offpeakWaitMinutes",
      re.confidence AS "confidence"
    FROM rail_edges re
    LEFT JOIN rail_lines rl ON rl.rail_line_id = re.rail_line_id`);
  return rows;
}

// The fitted penalty from calibrate:transit, when it has been run.
async function loadTransferPenalty(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ value: number }>(
    `SELECT value FROM transit_params WHERE key = 'transfer_penalty_minutes'`,
  );
  return rows[0]?.value ?? TRANSFER_PENALTY_MINUTES;
}

async function insertTravelTimes(
  client: PoolClient,
  rows: readonly TravelTimeRow[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await client.query(
      `INSERT INTO station_travel_times
         (from_station_group_id, to_station_group_id, period, minutes, transfers, confidence)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::int2[], $6::text[])`,
      [
        chunk.map((r) => r.from),
        chunk.map((r) => r.to),
        chunk.map((r) => r.period),
        chunk.map((r) => r.minutes),
        chunk.map((r) => r.transfers),
        chunk.map((r) => r.confidence),
      ],
    );
  }
}

const LOCALITY_ACCESS_SQL = `
  WITH hubs AS (
    SELECT h.key, sg.station_group_id
    FROM unnest($1::text[], $2::text[]) AS h(key, name_ja)
    JOIN station_groups sg ON sg.name_ja = h.name_ja
  ), sample_hub AS (
    SELECT DISTINCT ON (lss.locality_id, lss.sample_number, hubs.key)
      lss.locality_id, lss.sample_number, hubs.key,
      lss.walk_minutes + stt.minutes AS minutes, stt.confidence
    FROM locality_sample_stations lss
    JOIN station_travel_times stt
      ON stt.from_station_group_id = lss.station_group_id AND stt.period = 'peak'
    JOIN hubs ON hubs.station_group_id = stt.to_station_group_id
    ORDER BY lss.locality_id, lss.sample_number, hubs.key, lss.walk_minutes + stt.minutes
  ), locality_hub AS (
    SELECT locality_id, key,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS minutes,
      min(CASE confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END) AS confidence_rank
    FROM sample_hub GROUP BY locality_id, key
  ), hub_summary AS (
    SELECT locality_id,
      jsonb_object_agg(key, round(minutes::numeric, 1)) AS hub_minutes,
      avg(minutes) AS centrality_minutes,
      min(confidence_rank) AS confidence_rank
    FROM locality_hub GROUP BY locality_id
  ), station_lines AS (
    SELECT DISTINCT station_group_id, rail_line_id FROM (
      SELECT from_station_group_id AS station_group_id, rail_line_id FROM rail_edges WHERE edge_type = 'ride'
      UNION ALL
      SELECT to_station_group_id, rail_line_id FROM rail_edges WHERE edge_type = 'ride'
    ) x
  ), sample_stats AS (
    SELECT lss.locality_id, lss.sample_number,
      (SELECT count(DISTINCT sl.rail_line_id) FROM locality_sample_stations s2
         JOIN station_lines sl ON sl.station_group_id = s2.station_group_id
         WHERE s2.locality_id = lss.locality_id AND s2.sample_number = lss.sample_number) AS line_count,
      max(sa.direct_reach_stations) AS direct_reach_stations,
      max(sa.stations_within_30_min) AS stations_within_30_min,
      min(lss.walk_minutes) AS nearest_walk
    FROM locality_sample_stations lss
    JOIN station_access sa ON sa.station_group_id = lss.station_group_id
    GROUP BY lss.locality_id, lss.sample_number
  ), sample_summary AS (
    SELECT locality_id,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY line_count) AS line_count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY direct_reach_stations) AS direct_reach_stations,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY stations_within_30_min) AS stations_within_30_min,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY nearest_walk) AS nearest_walk
    FROM sample_stats GROUP BY locality_id
  )
  INSERT INTO locality_access (locality_id, hub_minutes, centrality_minutes, line_count,
    direct_reach_stations, stations_within_30_min, nearest_station_walk_min, confidence)
  SELECT l.locality_id, COALESCE(h.hub_minutes, '{}'::jsonb), h.centrality_minutes, s.line_count,
    s.direct_reach_stations, s.stations_within_30_min, s.nearest_walk,
    -- Walks beyond the normal station radius come from the 2,500 m fallback pass (D6).
    CASE WHEN s.nearest_walk > 25 THEN 'low'
      ELSE CASE h.confidence_rank WHEN 0 THEN 'low' WHEN 1 THEN 'medium' WHEN 2 THEN 'high' END
    END
  FROM localities l
  LEFT JOIN hub_summary h ON h.locality_id = l.locality_id
  LEFT JOIN sample_summary s ON s.locality_id = l.locality_id`;

export async function runAccessStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  const rowsWritten = await withTransaction(pool, async (client) => {
    const edges = await loadEdges(client);
    if (edges.length === 0) {
      throw new Error("derive/access: rail_edges is empty. Run `pnpm import:transit` first.");
    }
    const transferPenalty = await loadTransferPenalty(client);
    const times = PERIODS.flatMap((period) =>
      computeTravelTimes(buildGraph(edges, period), transferPenalty),
    );
    const access = computeStationAccess(edges, times);

    await client.query("DELETE FROM locality_access");
    await client.query("DELETE FROM station_access");
    await client.query("DELETE FROM station_travel_times");
    await insertTravelTimes(client, times);
    await client.query(
      `INSERT INTO station_access
         (station_group_id, line_count, direct_reach_stations, stations_within_30_min)
       SELECT * FROM unnest($1::text[], $2::int[], $3::int[], $4::int[])`,
      [
        access.map((a) => a.stationGroupId),
        access.map((a) => a.lineCount),
        access.map((a) => a.directReachStations),
        access.map((a) => a.stationsWithin30Min),
      ],
    );
    const { rowCount } = await client.query(LOCALITY_ACCESS_SQL, [
      ACCESS_HUBS.map((h) => h.key),
      ACCESS_HUBS.map((h) => h.nameJa),
    ]);
    return times.length + access.length + (rowCount ?? 0);
  });
  return { name: "access", rowsWritten, durationMs: Date.now() - start };
}
