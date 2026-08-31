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

export function resolvePathNames(
  path: readonly CommutePathHop[],
  lookups: NameLookups,
): CommutePathHop[] {
  return path.map((hop) => {
    const station = lookups.stationNames.get(hop.stationGroupId);

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
