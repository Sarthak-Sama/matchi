/**
 * Rail lines dataset — MLIT's National Land Numerical Information railway
 * data (dataset code N02), railroad-section lines.
 *
 * ASSUMED property names (verify against a real download): `N02_004` (operator)
 * and `N02_003` (Japanese line name) are N02's real field codes; a
 * friendlier `operator` / `name_ja` is accepted too.
 *
 * IMPORTANT known gap: raw N02 data does not classify a line into this
 * schema's `mode` enum (`subway` | `local_rail` | `commuter_rail` |
 * `monorail` — a CHECK constraint on `rail_lines.mode`). This module
 * requires the input file to already carry an explicit `mode` property per
 * feature — i.e. that classification has to happen in a preprocessing
 * pass over the real download (by operator name or line type) before
 * feeding it to this script.
 */

import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { lineGeometryToMultiLineStringWKT, pickProperty, slug } from "./geojson.js";

export const MIN_RAIL_LINES_ROWS = 1;

const LINE_ID_KEYS = ["rail_line_id", "line_id"];
const OPERATOR_KEYS = ["N02_004", "operator"];
const NAME_JA_KEYS = ["N02_003", "name_ja", "line_name"];
const NAME_EN_KEYS = ["name_en"];
const MODE_KEYS = ["mode", "rail_mode"];

const VALID_MODES = new Set(["subway", "local_rail", "commuter_rail", "monorail"]);

export interface ParsedRailLine {
  readonly railLineId: string;
  readonly operator: string;
  readonly nameJa: string;
  readonly nameEn?: string;
  readonly mode: string;
  readonly geomWKT: string;
}

export function parseRailLineFeature(feature: GeoJSONFeature, index: number): ParsedRailLine {
  const context = `rail-lines feature #${index}`;
  const properties = feature.properties ?? {};

  const canonical = {
    operator: pickProperty(properties, OPERATOR_KEYS),
    name_ja: pickProperty(properties, NAME_JA_KEYS),
    mode: pickProperty(properties, MODE_KEYS),
  };
  expectColumns(canonical, ["operator", "name_ja", "mode"], context);

  const operator = String(canonical.operator);
  const nameJa = String(canonical.name_ja);
  const mode = String(canonical.mode);

  if (!VALID_MODES.has(mode)) {
    throw new Error(
      `${context}: mode "${mode}" is not one of [${[...VALID_MODES].join(", ")}]. Raw MLIT N02 ` +
        `data doesn't classify lines this way — pre-populate a "mode" property before importing.`,
    );
  }

  const nameEnRaw = pickProperty(properties, NAME_EN_KEYS);
  const nameEn = nameEnRaw !== undefined ? String(nameEnRaw) : undefined;

  const idRaw = pickProperty(properties, LINE_ID_KEYS);
  const railLineId = idRaw !== undefined ? String(idRaw) : `mlit-${slug(operator)}-${slug(nameJa)}`;

  const geomWKT = lineGeometryToMultiLineStringWKT(feature.geometry, context);

  return { railLineId, operator, nameJa, nameEn, mode, geomWKT };
}

export function parseRailLines(features: readonly GeoJSONFeature[]): ParsedRailLine[] {
  return features.map((feature, index) => parseRailLineFeature(feature, index));
}
