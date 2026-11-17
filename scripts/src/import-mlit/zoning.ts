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

export function classifyZoningCategory(raw: string): ZoneClassification {
  const trimmed = raw.trim();

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
