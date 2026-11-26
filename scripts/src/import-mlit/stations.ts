import type { PoolClient } from "pg";

import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { pickProperty, pointGeometryToLonLat, slug } from "./geojson.js";
import type { MergedStationGroup } from "./station-merge.js";

export const MIN_STATIONS_ROWS = 1;

const STATION_ID_KEYS = ["station_id", "id", "N02_005c"];
const NAME_JA_KEYS = ["N02_005", "name_ja", "station_name"];
const NAME_EN_KEYS = ["N02_005e", "name_en"];
const OPERATOR_KEYS = ["N02_004", "operator"];
const LINE_NAME_KEYS = ["N02_003", "line_name"];

export interface ParsedStation {
  readonly sourceId: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly lon: number;
  readonly lat: number;
  readonly operator?: string;
  readonly lineNameJa?: string;
}

export function parseStationFeature(feature: GeoJSONFeature, index: number): ParsedStation {
  const context = `stations feature #${index}`;
  const properties = feature.properties ?? {};

  const nameJaRaw = pickProperty(properties, NAME_JA_KEYS);
  expectColumns({ name_ja: nameJaRaw }, ["name_ja"], context);
  const nameJa = String(nameJaRaw);

  const nameEnRaw = pickProperty(properties, NAME_EN_KEYS);
  const nameEn = nameEnRaw !== undefined ? String(nameEnRaw) : nameJa;

  const idRaw = pickProperty(properties, STATION_ID_KEYS);
  const sourceId = idRaw !== undefined ? String(idRaw) : `mlit-station-${index}`;

  const [lon, lat] = pointGeometryToLonLat(feature.geometry, context);

  const operator = pickProperty(properties, OPERATOR_KEYS);
  const lineNameJa = pickProperty(properties, LINE_NAME_KEYS);

  return {
    sourceId,
    nameJa,
    nameEn,
    lon,
    lat,
    ...(operator !== undefined && { operator: String(operator) }),
    ...(lineNameJa !== undefined && { lineNameJa: String(lineNameJa) }),
  };
}

export function parseStations(features: readonly GeoJSONFeature[]): ParsedStation[] {
  return features.map((feature, index) => parseStationFeature(feature, index));
}

// Same id rule as parseRailLineFeature in rail-lines.ts.
function railLineIdOf(station: ParsedStation): string | null {
  if (station.operator === undefined || station.lineNameJa === undefined) return null;
  return `mlit-${slug(station.operator)}-${slug(station.lineNameJa)}`;
}

/**
 * Rebuilds station_line_members from the merged groups. Lines that were not
 * imported into rail_lines (Shinkansen, lines outside Tokyo) are skipped.
 */
export async function replaceStationLineMembers(
  client: PoolClient,
  groups: readonly MergedStationGroup[],
): Promise<number> {
  const pairs = new Map<string, [string, string]>();
  for (const group of groups) {
    for (const member of group.members) {
      const railLineId = railLineIdOf(member);
      if (railLineId === null) continue;
      pairs.set(`${group.stationGroupId}\u0000${railLineId}`, [group.stationGroupId, railLineId]);
    }
  }
  const stationGroupIds = [...pairs.values()].map(([stationGroupId]) => stationGroupId);
  const railLineIds = [...pairs.values()].map(([, railLineId]) => railLineId);

  await client.query(`DELETE FROM station_line_members`);
  const { rowCount } = await client.query(
    `INSERT INTO station_line_members (station_group_id, rail_line_id)
     SELECT m.station_group_id, m.rail_line_id
     FROM unnest($1::text[], $2::text[]) AS m(station_group_id, rail_line_id)
     WHERE EXISTS (SELECT 1 FROM rail_lines rl WHERE rl.rail_line_id = m.rail_line_id)`,
    [stationGroupIds, railLineIds],
  );
  return rowCount ?? 0;
}
