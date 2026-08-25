/**
 * Land prices dataset — MLIT's official posted land price points (dataset
 * code L01, 地価公示).
 *
 * VERIFIED property names (2026 L01 Tokyo export, `L01-26_13`): `L01_008`
 * is price per m² in yen, `L01_007` is the survey year, and `L01_028` is
 * the land-use category; `price_yen_per_sqm` / `year` / `use_category` are
 * accepted as friendlier aliases.
 *
 * The codes this module originally assumed — `L01_005` (year), `L01_006`
 * (price), `L01_022` (use) — are WRONG, and wrong in the most dangerous
 * way: those fields still exist in the real export carrying unrelated
 * values (`L01_005 = "000"`, `L01_006 = "001"`, `L01_022 = "0"`). Because
 * `pickProperty` returns the first key it finds, merely ADDING the correct
 * codes to these lists would have changed nothing — every point would have
 * imported as ¥1/m² in the year 0. They are removed rather than kept as
 * fallbacks for exactly that reason. `L01_028` (land use) is optional —
 * `derive`'s rent step only uses points whose `use_category` is exactly
 * `'residential'` (see `scripts/src/derive/rent.ts`), so
 * `classifyLandUseCategory` below maps the handful of category spellings
 * this script recognizes onto that literal; anything else is kept as
 * free text (excluded from the rent calculation, not fatal).
 *
 * `ward_code` is intentionally NOT read from source properties — it is
 * assigned later via a spatial join against the imported `wards` polygons
 * (see `import-mlit.ts`), which is more reliable than trusting whatever
 * administrative-code field (if any) the source file carries.
 */

import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { pickProperty, pointGeometryToLonLat } from "./geojson.js";

export const MIN_LAND_PRICES_ROWS = 1;

const PRICE_KEYS = ["L01_008", "price_yen_per_sqm"];
const YEAR_KEYS = ["L01_007", "year"];
const USE_CATEGORY_KEYS = ["L01_028", "use_category"];

const RESIDENTIAL_USE_TOKENS = new Set(["residential", "住宅", "住宅地", "1"]);

/** Maps a raw use-category value onto `'residential'` when recognized, else passes it through. */
export function classifyLandUseCategory(raw: string): string {
  const trimmed = raw.trim();
  if (RESIDENTIAL_USE_TOKENS.has(trimmed.toLowerCase()) || RESIDENTIAL_USE_TOKENS.has(trimmed)) {
    return "residential";
  }
  return trimmed;
}

export interface ParsedLandPrice {
  readonly priceYenPerSqm: number;
  readonly year: number;
  readonly useCategory?: string;
  readonly lon: number;
  readonly lat: number;
}

export function parseLandPriceFeature(feature: GeoJSONFeature, index: number): ParsedLandPrice {
  const context = `land-prices feature #${index}`;
  const properties = feature.properties ?? {};

  const canonical = {
    price_yen_per_sqm: pickProperty(properties, PRICE_KEYS),
    year: pickProperty(properties, YEAR_KEYS),
  };
  expectColumns(canonical, ["price_yen_per_sqm", "year"], context);

  const priceYenPerSqm = Number(canonical.price_yen_per_sqm);
  if (!Number.isFinite(priceYenPerSqm) || priceYenPerSqm <= 0) {
    throw new Error(
      `${context}: price_yen_per_sqm must be a positive number, got ${String(canonical.price_yen_per_sqm)}`,
    );
  }

  const year = Number(canonical.year);
  if (!Number.isInteger(year)) {
    throw new Error(`${context}: year must be an integer, got ${String(canonical.year)}`);
  }

  const useCategoryRaw = pickProperty(properties, USE_CATEGORY_KEYS);
  const useCategory = useCategoryRaw !== undefined ? classifyLandUseCategory(String(useCategoryRaw)) : undefined;

  const [lon, lat] = pointGeometryToLonLat(feature.geometry, context);

  return { priceYenPerSqm, year, useCategory, lon, lat };
}

export function parseLandPrices(features: readonly GeoJSONFeature[]): ParsedLandPrice[] {
  return features.map((feature, index) => parseLandPriceFeature(feature, index));
}
