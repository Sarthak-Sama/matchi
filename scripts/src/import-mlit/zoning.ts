/**
 * Zoning dataset — MLIT's "Use Districts" urban planning data (dataset
 * code A29, 用途地域).
 *
 * ASSUMED property names/values (see task-11-report.md): `A29_001` is
 * A29's numeric use-district code (1-13, Japan's standard 用途地域
 * classification — Category I/II Low-rise Residential through Exclusive
 * Industrial); `category` is accepted as a friendlier alias carrying
 * either that same numeric code as a string or a free-text category name.
 * `classifyZoningCategory` maps the numeric codes (and a few obvious
 * keyword fallbacks) onto `zoning_areas.category` / `is_residential`. A
 * feature may instead supply `is_residential` directly, which always
 * wins over the classifier.
 */

import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { pickProperty, polygonGeometryToMultiPolygonWKT } from "./geojson.js";

export const MIN_ZONING_ROWS = 1;

const CATEGORY_KEYS = ["A29_001", "category"];
const IS_RESIDENTIAL_KEYS = ["is_residential"];

interface ZoneClassification {
  readonly category: string;
  readonly isResidential: boolean;
}

/** Japan's standard 用途地域 (Use District) numeric codes, 1-13. */
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
 * standard numeric code first, then a keyword fallback for already-named
 * categories (English or Japanese), and throws when neither works — the
 * caller should supply an explicit `is_residential` property instead.
 */
export function classifyZoningCategory(raw: string): ZoneClassification {
  const trimmed = raw.trim();

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
  return features.map((feature, index) => parseZoningFeature(feature, index));
}
