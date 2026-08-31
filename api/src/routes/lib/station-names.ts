/**
 * Loads the display-name lookups `POST /v1/optimize` needs to overwrite a
 * commute path's placeholder hop names before the response leaves the API.
 *
 * `estimateCommute` (`api/src/domain/transit/commute.ts`) only ever sees
 * `station_group_id`/`rail_line_id` values — by design, the graph and
 * search layers are pure logic with no database access (see
 * `loader.ts`'s doc comment) — so every `path` hop it returns carries the
 * raw id itself in `nameEn`/`nameJa`/`lineName` as a PLACEHOLDER. This
 * module loads the full `station_groups`/`rail_lines` name tables (small:
 * a few dozen rows even at real-data scale) so the route can replace every
 * placeholder with a real display name, however many distinct stations or
 * lines a given commute path happens to pass through.
 */

import type { DbPool } from "../../db.js";
import type { CommutePathHop } from "../../domain/transit/commute.js";

interface StationNameRow {
  readonly stationGroupId: string;
  readonly nameEn: string;
  readonly nameJa: string;
}

interface RailLineNameRow {
  readonly railLineId: string;
  readonly nameEn: string | null;
}

export interface StationName {
  readonly nameEn: string;
  readonly nameJa: string;
}

export interface NameLookups {
  readonly stationNames: ReadonlyMap<string, StationName>;
  readonly lineNames: ReadonlyMap<string, string>;
}

/** Loads every `station_groups` id -> {nameEn, nameJa} and `rail_lines` id -> nameEn. */
export async function loadNameLookups(pool: DbPool): Promise<NameLookups> {
  const [stationsResult, linesResult] = await Promise.all([
    pool.query(
      `SELECT station_group_id AS "stationGroupId", name_en AS "nameEn", name_ja AS "nameJa" FROM station_groups`,
    ) as Promise<{ rows: StationNameRow[] }>,
    pool.query(
      `SELECT rail_line_id AS "railLineId", name_en AS "nameEn" FROM rail_lines`,
    ) as Promise<{ rows: RailLineNameRow[] }>,
  ]);

  const stationNames = new Map<string, StationName>(
    stationsResult.rows.map((row) => [
      row.stationGroupId,
      { nameEn: row.nameEn, nameJa: row.nameJa },
    ]),
  );
  const lineNames = new Map<string, string>(
    linesResult.rows
      .filter((row): row is RailLineNameRow & { nameEn: string } => row.nameEn !== null)
      .map((row) => [row.railLineId, row.nameEn]),
  );

  return { stationNames, lineNames };
}

/**
 * Replaces every placeholder hop's `nameEn`/`nameJa`/`lineName` with a real
 * display name from `lookups`. Falls back to the raw id (never `undefined`
 * or an empty string) if a lookup somehow misses — a defensive fallback
 * that should never trigger against a consistent database, but a raw id
 * slipping through is still strictly better than a request-crashing
 * `undefined`.
 */
export function resolvePathNames(
  path: readonly CommutePathHop[],
  lookups: NameLookups,
): CommutePathHop[] {
  return path.map((hop) => {
    const station = lookups.stationNames.get(hop.stationGroupId);
    // `hop.lineName` currently HOLDS the raw `railLineId` placeholder (or
    // `null`) — see `commute.ts`'s doc comment — so it is the lookup key
    // here, not already a display name.
    const lineName =
      hop.lineName === null ? null : (lookups.lineNames.get(hop.lineName) ?? hop.lineName);

    return {
      stationGroupId: hop.stationGroupId,
      nameEn: station?.nameEn ?? hop.stationGroupId,
      nameJa: station?.nameJa ?? hop.stationGroupId,
      lineName,
    };
  });
}
