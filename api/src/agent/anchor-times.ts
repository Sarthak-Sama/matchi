import type { Anchor, AnchorTimes, AreaFeatures, ComputeAnchorTimes, RefusedAnchor } from "@tokyo/shared";
import { MAX_DESTINATION_WALK_M } from "@tokyo/shared";

import { ApiError } from "../application.js";
import type { DbPool } from "../db.js";
import type { DijkstraSeed } from "../domain/transit/dijkstra.js";
import { reverseDijkstra } from "../domain/transit/dijkstra.js";
import type { TransitGraphs } from "../domain/transit/graph.js";
import type { Destination, LocalitySample } from "../routes/lib/candidates.js";
import { localityCommute } from "../routes/lib/candidates.js";
import { findAccessStations } from "../routes/lib/access-stations.js";
import type { NameLookups } from "../routes/lib/station-names.js";

export interface AnchorTimesDeps {
  pool: DbPool;
  graphs: TransitGraphs;
}

// localityCommute only uses the lookups to label path hops, which we discard.
const NO_LOOKUPS: NameLookups = { stationNames: new Map(), lineNames: new Map() };

const SAMPLES_SQL = `
  SELECT
    ls.locality_id AS "localityId",
    ls.sample_number AS "sampleNumber",
    ST_Y(ls.point) AS lat,
    ST_X(ls.point) AS lon,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stationGroupId', lss.station_group_id,
        'walkMinutes', lss.walk_minutes,
        'rank', lss.station_rank) ORDER BY lss.station_rank)
      FROM public.locality_sample_stations lss
      WHERE lss.locality_id = ls.locality_id AND lss.sample_number = ls.sample_number
    ), '[]'::jsonb) AS stations
  FROM public.locality_samples ls
  ORDER BY ls.locality_id, ls.sample_number
`;

const STATION_POINT_SQL = `
  SELECT ST_Y(point) AS lat, ST_X(point) AS lon
  FROM public.station_groups WHERE station_group_id = $1
`;

// Rail reaches beyond the 23 wards, but we have no localities there: an anchor
// further out than this is refused even when trains get to it.
const MAX_DISTANCE_OUTSIDE_WARDS_M = 3000;

const OUTSIDE_WARDS_SQL = `
  SELECT NOT EXISTS (
    SELECT 1 FROM public.wards
    WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
  ) AS outside
`;

interface SampleRow extends LocalitySample {
  localityId: string;
}

async function loadSamples(pool: DbPool): Promise<Map<string, LocalitySample[]>> {
  const result = (await pool.query(SAMPLES_SQL)) as { rows: SampleRow[] };
  const byLocality = new Map<string, LocalitySample[]>();
  for (const row of result.rows) {
    const list = byLocality.get(row.localityId) ?? [];
    list.push({ sampleNumber: row.sampleNumber, lat: row.lat, lon: row.lon, stations: row.stations });
    byLocality.set(row.localityId, list);
  }
  return byLocality;
}

type Resolved = { ok: true; key: string; destination: Destination } | { ok: false; refused: RefusedAnchor };

async function isOutsideWards(pool: DbPool, point: { lat: number; lon: number }): Promise<boolean> {
  const result = (await pool.query(OUTSIDE_WARDS_SQL, [point.lon, point.lat, MAX_DISTANCE_OUTSIDE_WARDS_M])) as {
    rows: { outside: boolean }[];
  };
  return result.rows[0]?.outside === true;
}

async function resolveAnchor(pool: DbPool, anchor: Anchor): Promise<Resolved> {
  const refuse = (reason: RefusedAnchor["reason"], message: string): Resolved => ({
    ok: false,
    refused: { anchorId: anchor.id, reason, message },
  });

  // Station wins if both are given; the schema comment says exactly one is expected.
  if (anchor.stationId !== undefined) {
    const result = (await pool.query(STATION_POINT_SQL, [anchor.stationId])) as {
      rows: { lat: number | null; lon: number | null }[];
    };
    const row = result.rows[0];
    if (row === undefined) {
      return refuse("unknown_station", `Unknown station "${anchor.stationId}". Use a station id from lookup.`);
    }
    const point = row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : null;
    return {
      ok: true,
      key: `station:${anchor.stationId}`,
      destination: { seeds: [{ node: anchor.stationId, walkMinutes: 0 }], point },
    };
  }

  if (anchor.point !== undefined) {
    const seeds: DijkstraSeed[] = await findAccessStations(pool, anchor.point);
    if (seeds.length === 0) {
      return refuse(
        "no_station_within_1500m",
        `No station in the data is within ${String(MAX_DESTINATION_WALK_M)} m of (${String(anchor.point.lat)}, ${String(anchor.point.lon)}).`,
      );
    }
    return {
      ok: true,
      key: `point:${anchor.point.lat.toFixed(5)},${anchor.point.lon.toFixed(5)}`,
      destination: { seeds, point: anchor.point },
    };
  }

  return refuse("unknown_station", "Anchor has neither a stationId nor a point.");
}

/**
 * Per anchor, one-way door-to-door minutes to every area, in `areas` order.
 * Per area this is localityCommute (the /v1/optimize logic): the median over the
 * locality's sample points of the best of walk or rail+walk, on the peak or
 * offpeak graph according to anchor.period. NaN = no route from any sample point.
 *
 * Refusals: no stationId/point or unknown stationId -> unknown_station; a point
 * with no station within 1500 m -> no_station_within_1500m; an anchor more than
 * 3 km outside the ward union, or one that reaches no area at all -> outside_coverage.
 * Results are cached per (areas array, anchor target, period).
 */
export function createComputeAnchorTimes(deps: AnchorTimesDeps): ComputeAnchorTimes {
  let samplesPromise: Promise<Map<string, LocalitySample[]>> | null = null;
  const getSamples = (): Promise<Map<string, LocalitySample[]>> => {
    samplesPromise ??= loadSamples(deps.pool).catch((err: unknown) => {
      samplesPromise = null;
      throw err;
    });
    return samplesPromise;
  };
  const cache = new WeakMap<readonly AreaFeatures[], Map<string, Float64Array>>();

  return async (anchors, areas) => {
    const times: AnchorTimes = {};
    const refused: RefusedAnchor[] = [];
    if (anchors.length === 0) return { times, refused };

    const graphsEmpty = deps.graphs.peak.nodes.size === 0 && deps.graphs.offpeak.nodes.size === 0;
    if (graphsEmpty) {
      throw new ApiError(503, "GRAPH_UNAVAILABLE", "The transit graph has not been loaded yet.");
    }

    let areaCache = cache.get(areas);
    if (areaCache === undefined) {
      areaCache = new Map();
      cache.set(areas, areaCache);
    }

    for (const anchor of anchors) {
      const resolved = await resolveAnchor(deps.pool, anchor);
      if (!resolved.ok) {
        refused.push(resolved.refused);
        continue;
      }

      const point = resolved.destination.point;
      if (point !== null && (await isOutsideWards(deps.pool, point))) {
        refused.push({
          anchorId: anchor.id,
          reason: "outside_coverage",
          message: `This anchor is more than ${String(MAX_DISTANCE_OUTSIDE_WARDS_M / 1000)} km outside the 23 wards, which is all the data covers.`,
        });
        continue;
      }

      const cacheKey = `${anchor.period}|${resolved.key}`;
      let minutes = areaCache.get(cacheKey);
      if (minutes === undefined) {
        const samples = await getSamples();
        const graph = anchor.period === "peak" ? deps.graphs.peak : deps.graphs.offpeak;
        const dijkstra = reverseDijkstra(graph, resolved.destination.seeds);
        minutes = new Float64Array(areas.length);
        for (let i = 0; i < areas.length; i++) {
          const area = areas[i]!;
          const commute = localityCommute(
            samples.get(area.locality_id) ?? [],
            resolved.destination,
            dijkstra,
            NO_LOOKUPS,
          );
          minutes[i] = commute === null ? Number.NaN : commute.totalMinutes;
        }
        areaCache.set(cacheKey, minutes);
      }

      if (!minutes.some((m) => Number.isFinite(m))) {
        refused.push({
          anchorId: anchor.id,
          reason: "outside_coverage",
          message: "No area in the data can reach this anchor by rail or on foot.",
        });
        continue;
      }
      times[anchor.id] = minutes;
    }
    return { times, refused };
  };
}
