/**
 * Zoning dataset — MLIT's "Use Districts" urban planning data (dataset
 * code A29, 用途地域).
 *
 * VERIFIED property names/values (2019 A29 Tokyo export, `A29-19_13`):
 * `A29_004` is A29's numeric use-district code (1-13, Japan's standard
 * 用途地域 classification — Category I/II Low-rise Residential through
 * Exclusive Industrial); `category` is accepted as a friendlier alias
 * carrying either that same numeric code as a string or a free-text
 * category name.
 *
 * **The numeric code alone is ambiguous and must not be trusted on its
 * own.** Japan renumbered 用途地域 in 2018 when 田園住居地域 was inserted at
 * position 8, shifting everything above it. The 2019 Tokyo export uses the
 * OLD 12-category numbering — verified by pairing `A29_004` against
 * `A29_005` across all 10,684 polygons — where 8 is 近隣商業地域. Under the
 * newer 13-category numbering this module was written against, 8 is
 * 田園住居地域, a RESIDENTIAL district. Reading the code alone would have
 * imported 1,468 neighborhood-commercial polygons as residential and
 * inflated `derive/zoning.ts`'s `residential_zoning_share` accordingly.
 *
 * So `A29_005` (the official district name) is preferred over `A29_004`,
 * and `ZONE_NAME_MAP` carries both systems' names. The numeric map remains
 * as a fallback for exports that omit the name, and is written against the
 * 13-category system.
 *
 * This module originally read `A29_001`, which is NOT the zoning class —
 * it is the administrative area code, and in the Tokyo export every single
 * feature carries the same value, `"13000"` (Tokyo prefecture). Reading it
 * would have handed `classifyZoningCategory` one constant string for all
 * 10,684 polygons: no numeric code match, no residential/commercial
 * keyword match, so every polygon in the prefecture would have failed
 * classification identically. `A29_005` carries the human-readable name
 * (`第一種低層住居専用地域` for code 1) and is a useful cross-check when
 * verifying a fresh export.
 *
 * `classifyZoningCategory` maps a district name, then a numeric code, then
 * a few obvious keyword fallbacks, onto `zoning_areas.category` /
 * `is_residential`. A feature may instead supply `is_residential`
 * directly, which always wins over the classifier.
 */

import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { pickProperty, polygonGeometryToMultiPolygonWKT } from "./geojson.js";

export const MIN_ZONING_ROWS = 1;

const CATEGORY_KEYS = [
  "YoutoName",
  "A55_YoutoName",
  "A29_005",
  "category",
  "YoutoCode",
  "A55_YoutoCode",
  "A29_004",
];
const CITY_CODE_KEYS = ["Citycode", "CityCode", "citycode"];
const IS_RESIDENTIAL_KEYS = ["is_residential"];

interface ZoneClassification {
  readonly category: string;
  readonly isResidential: boolean;
}

/**
 * The official 用途地域 names, which are unambiguous where the numeric
 * codes are not — see this module's doc comment. Covers both the 12- and
 * 13-category systems, since 田園住居地域 only exists in the latter.
 */
const ZONE_NAME_MAP: Readonly<Record<string, ZoneClassification>> = {
  第一種低層住居専用地域: { category: "category1_low_rise_residential", isResidential: true },
  第二種低層住居専用地域: { category: "category2_low_rise_residential", isResidential: true },
  第一種中高層住居専用地域: { category: "category1_mid_high_residential", isResidential: true },
  第二種中高層住居専用地域: { category: "category2_mid_high_residential", isResidential: true },
  第一種住居地域: { category: "category1_residential", isResidential: true },
  第二種住居地域: { category: "category2_residential", isResidential: true },
  準住居地域: { category: "quasi_residential", isResidential: true },
  田園住居地域: { category: "rural_residential", isResidential: true },
  近隣商業地域: { category: "neighborhood_commercial", isResidential: false },
  商業地域: { category: "commercial", isResidential: false },
  準工業地域: { category: "quasi_industrial", isResidential: false },
  工業地域: { category: "industrial", isResidential: false },
  工業専用地域: { category: "exclusive_industrial", isResidential: false },
};

/**
 * Japan's 用途地域 numeric codes under the CURRENT 13-category system.
 * Only reached when an export omits the district name — prefer
 * `ZONE_NAME_MAP`, since a 12-category export means something different by
 * every code from 8 up.
 */
const ZONE_CODE_MAP: Readonly<Record<string, ZoneClassification>> = {
  "1": { category: "category1_low_rise_residential", isResidential: true },
  "2": { category: "category2_low_rise_residential", isResidential: true },
  "3": { category: "category1_mid_high_residential", isResidential: true },
  "4": { category: "category2_mid_high_residential", isResidential: true },
  "5": { category: "category1_residential", isResidential: true },
  "6": { category: "category2_residential", isResidential: true },
  "7": { category: "quasi_residential", isResidential: true },
  "8": { category: "rural_residential", isResidential: true },
  "9": { category: "neighborhood_commercial", isResidential: false },
  "10": { category: "commercial", isResidential: false },
  "11": { category: "quasi_industrial", isResidential: false },
  "12": { category: "industrial", isResidential: false },
  "13": { category: "exclusive_industrial", isResidential: false },
};

/**
 * Classifies a raw category value as residential or not. Tries the
 * official district name first, then the numeric code, then a keyword
 * fallback for already-named categories (English or Japanese), and throws
 * when none works — the caller should supply an explicit `is_residential`
 * property instead.
 */
export function classifyZoningCategory(raw: string): ZoneClassification {
  const trimmed = raw.trim();

  // Name first: it identifies the district unambiguously, while the same
  // numeric code means different districts in the 12- and 13-category
  // systems (see this module's doc comment).
  const byName = ZONE_NAME_MAP[trimmed];
  if (byName) return byName;

  const byCode = ZONE_CODE_MAP[trimmed];
  if (byCode) return byCode;

  const lower = trimmed.toLowerCase();
  if (lower.includes("residential") || trimmed.includes("住居") || trimmed.includes("住宅")) {
    return { category: trimmed, isResidential: true };
  }
  if (
    lower.includes("commercial") ||
    lower.includes("industrial") ||
    trimmed.includes("商業") ||
    trimmed.includes("工業")
  ) {
    return { category: trimmed, isResidential: false };
  }

  throw new Error(
    `cannot classify zoning category "${raw}" as residential or not — supply an explicit ` +
      `is_residential property for this feature.`,
  );
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export interface ParsedZoningArea {
  readonly category: string;
  readonly isResidential: boolean;
  readonly geomWKT: string;
}

export function parseZoningFeature(feature: GeoJSONFeature, index: number): ParsedZoningArea {
  const context = `zoning feature #${index}`;
  const properties = feature.properties ?? {};

  const categoryRaw = pickProperty(properties, CATEGORY_KEYS);
  expectColumns({ category: categoryRaw }, ["category"], context);
  const rawCategory = String(categoryRaw);

  const explicitIsResidential = pickProperty(properties, IS_RESIDENTIAL_KEYS);
  let category: string;
  let isResidential: boolean;
  if (explicitIsResidential !== undefined) {
    category = rawCategory;
    isResidential = toBoolean(explicitIsResidential);
  } else {
    const classified = classifyZoningCategory(rawCategory);
    category = classified.category;
    isResidential = classified.isResidential;
  }

  const geomWKT = polygonGeometryToMultiPolygonWKT(feature.geometry, context);

  return { category, isResidential, geomWKT };
}

export function parseZoningAreas(features: readonly GeoJSONFeature[]): ParsedZoningArea[] {
  return features
    .filter((feature) => {
      const cityCode = pickProperty(feature.properties ?? {}, CITY_CODE_KEYS);
      return cityCode === undefined || /^131(?:0[1-9]|1[0-9]|2[0-3])$/.test(String(cityCode));
    })
    .map((feature, index) => parseZoningFeature(feature, index));
}
