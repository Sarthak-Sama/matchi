/**
 * Flood dataset — MLIT flood hazard (想定最大規模浸水想定区域) polygons
 * (dataset code A31).
 *
 * ASSUMED property names/values (see task-11-report.md): `A31_101` is
 * A31's depth-category field; `depth_category` is accepted as a friendlier
 * alias. `classifyFloodDepth` maps the standard 5-level Japanese flood
 * hazard depth classification onto `flood_zones.depth_rank` (1 = shallow,
 * 5 = deepest — higher rank means worse, matching `derive`'s flood step,
 * which sums `share * depth_rank`). A feature may instead supply
 * `depth_rank` directly, which always wins over the classifier.
 */

import { expectColumns } from "../lib/validate.js";
import type { GeoJSONFeature } from "./geojson.js";
import { pickProperty, polygonGeometryToMultiPolygonWKT } from "./geojson.js";

export const MIN_FLOOD_ROWS = 1;

const DEPTH_CATEGORY_KEYS = ["A31_101", "depth_category"];
const DEPTH_RANK_KEYS = ["depth_rank"];

/** Japan's standard 5-level flood inundation depth classification. */
const DEPTH_RANK_MAP: Readonly<Record<string, number>> = {
  "0.5m未満": 1,
  "0.5m以上3.0m未満": 2,
  "3.0m以上5.0m未満": 3,
  "5.0m以上10.0m未満": 4,
  "10.0m以上": 5,
  "0-0.5m": 1,
  "0.5-3.0m": 2,
  "3.0-5.0m": 3,
  "5.0-10.0m": 4,
  "10.0m+": 5,
};

/** Classifies a raw depth-category string into its severity rank (1=shallow .. 5=deepest). */
export function classifyFloodDepth(raw: string): number {
  const trimmed = raw.trim();
  const rank = DEPTH_RANK_MAP[trimmed];
  if (rank === undefined) {
    throw new Error(
      `cannot classify flood depth category "${raw}" — supply an explicit depth_rank property ` +
        `for this feature.`,
    );
  }
  return rank;
}

export interface ParsedFloodZone {
  readonly depthCategory: string;
  readonly depthRank: number;
  readonly geomWKT: string;
}

export function parseFloodFeature(feature: GeoJSONFeature, index: number): ParsedFloodZone {
  const context = `flood feature #${index}`;
  const properties = feature.properties ?? {};

  const categoryRaw = pickProperty(properties, DEPTH_CATEGORY_KEYS);
  expectColumns({ depth_category: categoryRaw }, ["depth_category"], context);
  const depthCategory = String(categoryRaw);

  const explicitRank = pickProperty(properties, DEPTH_RANK_KEYS);
  const depthRank = explicitRank !== undefined ? Number(explicitRank) : classifyFloodDepth(depthCategory);
  if (!Number.isFinite(depthRank)) {
    throw new Error(`${context}: depth_rank must be a number, got ${String(explicitRank)}`);
  }

  const geomWKT = polygonGeometryToMultiPolygonWKT(feature.geometry, context);

  return { depthCategory, depthRank, geomWKT };
}

export function parseFloodZones(features: readonly GeoJSONFeature[]): ParsedFloodZone[] {
  return features.map((feature, index) => parseFloodFeature(feature, index));
}
