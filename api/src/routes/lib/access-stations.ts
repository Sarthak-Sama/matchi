import type { DbPool } from "../../db.js";
import type { DijkstraSeed } from "../../domain/transit/dijkstra.js";
import type { DestinationPoint } from "@tokyo/shared";
import { MAX_DESTINATION_WALK_M, WALK_DETOUR_FACTOR, WALK_SPEED_M_PER_MIN } from "@tokyo/shared";

export function walkMinutesForMetres(metres: number): number {
  return Math.ceil((metres * WALK_DETOUR_FACTOR) / WALK_SPEED_M_PER_MIN);
}

const ACCESS_STATIONS_SQL = `
  SELECT
    sg.station_group_id AS "stationGroupId",
    ST_Distance(sg.point::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceM"
  FROM station_groups sg
  WHERE ST_DWithin(
    sg.point::geography,
    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
    $3
  )
  ORDER BY "distanceM" ASC
`;

interface AccessStationRow {
  readonly stationGroupId: string;
  readonly distanceM: number;
}

export async function findAccessStations(
  pool: DbPool,
  point: DestinationPoint,
): Promise<DijkstraSeed[]> {
  const result = (await pool.query(ACCESS_STATIONS_SQL, [
    point.lon,
    point.lat,
    MAX_DESTINATION_WALK_M,
  ])) as { rows: AccessStationRow[] };

  return result.rows.map((row) => ({
    node: row.stationGroupId,
    walkMinutes: walkMinutesForMetres(row.distanceM),
  }));
}
