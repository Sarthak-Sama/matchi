import type { Confidence } from "@tokyo/shared";
import {
  DWELL_SECONDS_PER_INTERMEDIATE_STATION,
  FALLBACK_SPEEDS_KMH,
  OFFPEAK_WAIT_MINUTES,
  PEAK_WAIT_MINUTES,
  STATION_MERGE_RADIUS_M,
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

interface RailLineRow {
  readonly rail_line_id: string;
  readonly mode: keyof typeof FALLBACK_SPEEDS_KMH;
}

interface AdjacentPairRow {
  readonly from_id: string;
  readonly to_id: string;
  readonly distance_m: number;
}

const ZERO_INTERMEDIATE_STATIONS = 0;

function minutesFromDistance(distanceM: number, mode: keyof typeof FALLBACK_SPEEDS_KMH): number {
  const speedKmh = FALLBACK_SPEEDS_KMH[mode];
  const travelMinutes = (distanceM / 1000 / speedKmh) * 60;
  const dwellMinutes = (ZERO_INTERMEDIATE_STATIONS * DWELL_SECONDS_PER_INTERMEDIATE_STATION) / 60;
  return travelMinutes + dwellMinutes;
}

export interface FallbackTopologyResult {
  readonly edges: readonly NewFallbackEdge[];
  readonly warnings: readonly string[];
}

export async function computeFallbackEdges(client: PoolClient): Promise<FallbackTopologyResult> {
  const { rows: allLines } = await client.query<{ rail_line_id: string }>(
    `SELECT rail_line_id FROM rail_lines`,
  );
  const { rows: linesWithGeom } = await client.query<RailLineRow>(
    `SELECT rail_line_id, mode FROM rail_lines WHERE geom IS NOT NULL`,
  );

  const warnings: string[] = [];
  const withGeomIds = new Set(linesWithGeom.map((l) => l.rail_line_id));
  const missingGeom = allLines.filter((l) => !withGeomIds.has(l.rail_line_id));
  if (missingGeom.length > 0) {
    warnings.push(
      `${String(missingGeom.length)} rail_lines row(s) have no geometry and were skipped in ` +
        `--from-topology mode: ${missingGeom.map((l) => l.rail_line_id).join(", ")}`,
    );
  }

  const edges: NewFallbackEdge[] = [];

  for (const line of linesWithGeom) {
    const { rows: pairs } = await client.query<AdjacentPairRow>(
      `WITH parts AS (
         -- COALESCE: ST_Dump returns an EMPTY path array when its input is
         -- already a single LineString, so d.path[1] is NULL there. A NULL
         -- part_index makes every part_index = part_index join below
         -- false, which silently drops edges for exactly the lines whose
         -- geometry is cleanest.
         SELECT d.geom AS geom, COALESCE(d.path[1], 1) AS part_index
         FROM rail_lines rl, LATERAL ST_Dump(ST_LineMerge(rl.geom)) d
         WHERE rl.rail_line_id = $1
       ),
       ordered AS (
         SELECT p.part_index,
                sg.station_group_id,
                ST_LineLocatePoint(p.geom, sg.point) AS frac,
                row_number() OVER (
                  PARTITION BY p.part_index
                  ORDER BY ST_LineLocatePoint(p.geom, sg.point)
                ) AS rn
         FROM parts p
         JOIN station_groups sg
           ON ST_DWithin(sg.point::geography, p.geom::geography, $2)
       )
       SELECT a.station_group_id AS from_id,
              b.station_group_id AS to_id,
              ST_Length(
                ST_LineSubstring(p.geom, LEAST(a.frac, b.frac), GREATEST(a.frac, b.frac))::geography
              ) AS distance_m
       FROM ordered a
       JOIN ordered b ON b.part_index = a.part_index AND b.rn = a.rn + 1
       JOIN parts p ON p.part_index = a.part_index`,
      [line.rail_line_id, STATION_MERGE_RADIUS_M],
    );

    if (pairs.length === 0) {
      warnings.push(
        `rail_line "${line.rail_line_id}": fewer than 2 station_groups found within ` +
          `${String(STATION_MERGE_RADIUS_M)}m of its geometry — no edges derived for this line.`,
      );
      continue;
    }

    for (const pair of pairs) {
      const minutes = minutesFromDistance(pair.distance_m, line.mode);
      const commonFields = {
        railLineId: line.rail_line_id,
        edgeType: "ride" as const,
        peakTravelMinutes: minutes,
        offpeakTravelMinutes: minutes,
        peakWaitMinutes: PEAK_WAIT_MINUTES,
        offpeakWaitMinutes: OFFPEAK_WAIT_MINUTES,
        confidence: "low" as const,
      };
      edges.push({
        ...commonFields,
        fromStationGroupId: pair.from_id,
        toStationGroupId: pair.to_id,
      });
      edges.push({
        ...commonFields,
        fromStationGroupId: pair.to_id,
        toStationGroupId: pair.from_id,
      });
    }
  }

  return { edges, warnings };
}
