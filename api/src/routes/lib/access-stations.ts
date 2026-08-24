/**
 * Resolves a destination POINT (an office, not a station) into the access
 * stations a commuter could plausibly walk to it from, each with its own
 * walk in minutes — i.e. into the seed list `reverseDijkstra` takes.
 *
 * This is the first `ST_DWithin` in the API. Until now every PostGIS
 * predicate lived in `scripts/derive/*`, which runs offline; this one runs
 * inside a request, which is why `db/migrations/0004_lifestyle_metrics.sql`
 * added `CREATE INDEX ... ON station_groups USING gist ((point::geography))`
 * — a GiST index on the plain `point` column is NOT matched by the planner
 * against a `point::geography` predicate (see
 * `db/migrations/0002_geography_indexes.sql` for the empirical write-up).
 * The predicate below is written as `sg.point::geography` precisely so it
 * is structurally identical to that indexed expression. Changing the cast
 * silently costs a sequential scan on every optimize request.
 *
 * Why several seeds and not just the nearest station: an office between
 * Shibuya and Ebisu is better reached via Ebisu from some origins and via
 * Shibuya from others, and picking one up front bakes in the wrong answer
 * for half the map. Handing the search all of them, each priced with its
 * own walk, lets it decide per origin.
 */

import type { DbPool } from "../../db.js";
import type { DijkstraSeed } from "../../domain/transit/dijkstra.js";
import type { DestinationPoint } from "@tokyo/shared";
import {
  MAX_DESTINATION_WALK_M,
  WALK_DETOUR_FACTOR,
  WALK_SPEED_M_PER_MIN,
} from "@tokyo/shared";

/**
 * Straight-line metres -> walking minutes.
 *
 * `ST_Distance` on a `geography` gives the great-circle distance, which
 * nobody can actually walk, so it is inflated by `WALK_DETOUR_FACTOR`
 * before being divided by `WALK_SPEED_M_PER_MIN`. The result is rounded UP
 * to a whole minute: that is what 徒歩○分 means on a Japanese listing
 * (the convention rounds up, never down), and it keeps the estimate on the
 * conservative side of the truth.
 */
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

/**
 * Every `station_groups` row within `MAX_DESTINATION_WALK_M` straight-line
 * metres of `point`, nearest first, as `reverseDijkstra` seeds.
 *
 * Returns an EMPTY array when nothing is in range — it does not throw. The
 * caller decides what an unresolvable destination means to it (`/v1/optimize`
 * turns it into a `400 NO_ACCESS_STATIONS`), because `reverseDijkstra`
 * throws a plain `Error` on an empty seed list and that would surface as an
 * opaque 500 rather than a typed, actionable response.
 */
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
