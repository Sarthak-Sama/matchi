/**
 * Wards dataset — MLIT's National Land Numerical Information administrative
 * boundary data (dataset code N03), one polygon per municipality.
 *
 * ASSUMED property names (see task-11-report.md for the full list of
 * assumptions to verify against a real download): the MLIT field codes
 * `N03_007` (5-digit JIS administrative code) and `N03_004` (Japanese
 * name) are tried first; a friendlier `ward_code` / `name_ja` is accepted
 * as a fallback so hand-built or pre-renamed fixtures work too.
 *
 * N03 carries no English name field. Since `wards.name_en` is `NOT NULL`,
 * this module falls back to a static lookup for Tokyo's 23 special wards
 * (`TOKYO_WARD_NAME_EN`) when the source doesn't supply `name_en` itself,
 * and only errors when neither is available.
 */

import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { pickProperty, polygonGeometryToMultiPolygonWKT } from "./geojson.js";

export const MIN_WARDS_ROWS = 1;

const WARD_CODE_KEYS = ["N03_007", "ward_code"];
const NAME_JA_KEYS = ["N03_004", "name_ja"];
const NAME_EN_KEYS = ["name_en"];

/**
 * English names for Tokyo's 23 special wards, keyed by their 5-digit JIS
 * administrative code. MLIT's N03 data has no English field of its own.
 */
export const TOKYO_WARD_NAME_EN: Readonly<Record<string, string>> = {
  "13101": "Chiyoda",
  "13102": "Chuo",
  "13103": "Minato",
  "13104": "Shinjuku",
  "13105": "Bunkyo",
  "13106": "Taito",
  "13107": "Sumida",
  "13108": "Koto",
  "13109": "Shinagawa",
  "13110": "Meguro",
  "13111": "Ota",
  "13112": "Setagaya",
  "13113": "Shibuya",
  "13114": "Nakano",
  "13115": "Suginami",
  "13116": "Toshima",
  "13117": "Kita",
  "13118": "Arakawa",
  "13119": "Itabashi",
  "13120": "Nerima",
  "13121": "Adachi",
  "13122": "Katsushika",
  "13123": "Edogawa",
};

export interface ParsedWard {
  readonly wardCode: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly geomWKT: string;
}

export function parseWardFeature(feature: GeoJSONFeature, index: number): ParsedWard {
  const context = `wards feature #${index}`;
  const properties = feature.properties ?? {};

  const canonical = {
    ward_code: pickProperty(properties, WARD_CODE_KEYS),
    name_ja: pickProperty(properties, NAME_JA_KEYS),
  };
  expectColumns(canonical, ["ward_code", "name_ja"], context);

  const wardCode = String(canonical.ward_code);
  const nameJa = String(canonical.name_ja);

  const nameEnRaw = pickProperty(properties, NAME_EN_KEYS);
  const nameEn = nameEnRaw !== undefined ? String(nameEnRaw) : TOKYO_WARD_NAME_EN[wardCode];
  if (nameEn === undefined) {
    throw new Error(
      `${context}: no English name for ward_code "${wardCode}" — it is not one of the 23 ` +
        `Tokyo special wards this script knows by heart, and the feature has no name_en ` +
        `property either.`,
    );
  }

  const geomWKT = polygonGeometryToMultiPolygonWKT(feature.geometry, context);

  return { wardCode, nameJa, nameEn, geomWKT };
}

export function parseWards(features: readonly GeoJSONFeature[]): ParsedWard[] {
  const grouped = new Map<string, ParsedWard[]>();
  for (const [index, feature] of features.entries()) {
    const ward = parseWardFeature(feature, index);
    const list = grouped.get(ward.wardCode) ?? [];
    list.push(ward); grouped.set(ward.wardCode, list);
  }
  return [...grouped.values()].map((parts) => {
    const first = parts[0];
    if (!first) throw new Error("wards: empty component group");
    const geometry = parts.map((part) => part.geomWKT.slice("MULTIPOLYGON(".length, -1)).join(",");
    return { ...first, geomWKT: `MULTIPOLYGON(${geometry})` };
  });
}

export function assertTokyoWards(wards: readonly ParsedWard[]): void {
  const expected = new Set(Object.keys(TOKYO_WARD_NAME_EN));
  if (wards.length !== expected.size || wards.some((ward) => !expected.has(ward.wardCode))) {
    throw new Error(`wards: require exactly Tokyo codes 13101–13123; received ${wards.map((w) => w.wardCode).sort().join(", ")}`);
  }
}
