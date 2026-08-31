import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { pickProperty, pointGeometryToLonLat } from "./geojson.js";

export const MIN_LAND_PRICES_ROWS = 1;

const PRICE_KEYS = ["L01_008", "price_yen_per_sqm"];
const YEAR_KEYS = ["L01_007", "year"];
const USE_CATEGORY_KEYS = ["L01_028", "use_category"];

const RESIDENTIAL_USE_TOKENS = new Set(["residential", "住宅", "住宅地", "1"]);

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
  const useCategory =
    useCategoryRaw !== undefined ? classifyLandUseCategory(String(useCategoryRaw)) : undefined;

  const [lon, lat] = pointGeometryToLonLat(feature.geometry, context);

  return { priceYenPerSqm, year, useCategory, lon, lat };
}

export function parseLandPrices(features: readonly GeoJSONFeature[]): ParsedLandPrice[] {
  return features.map((feature, index) => parseLandPriceFeature(feature, index));
}
