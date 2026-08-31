/**
 * Stations dataset — MLIT's National Land Numerical Information railway
 * data (dataset code N02), station points.
 *
 * ASSUMED property names (verify against a real download): `N02_005` (Japanese
 * station name) is the one field N02 reliably carries; this module also
 * accepts a friendlier `name_ja` / `station_name`. N02 has no stable
 * feature id and no English name field, so both `station_id` and
 * `name_en` fall back — id to a per-file positional id, name to the
 * Japanese name — when the source doesn't supply one. Every raw feature
 * is kept (not deduplicated) here; `station-merge.ts` collapses the ones
 * that represent the same physical station complex.
 */

import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { pickProperty, pointGeometryToLonLat } from "./geojson.js";

export const MIN_STATIONS_ROWS = 1;

const STATION_ID_KEYS = ["station_id", "id", "N02_005c"];
const NAME_JA_KEYS = ["N02_005", "name_ja", "station_name"];
const NAME_EN_KEYS = ["N02_005e", "name_en"];

export interface ParsedStation {
  readonly sourceId: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly lon: number;
  readonly lat: number;
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

  return { sourceId, nameJa, nameEn, lon, lat };
}

export function parseStations(features: readonly GeoJSONFeature[]): ParsedStation[] {
  return features.map((feature, index) => parseStationFeature(feature, index));
}
