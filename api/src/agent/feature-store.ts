import { LAYOUTS } from "@tokyo/shared";
import type { AreaFeatures, ModelParams } from "@tokyo/shared";

import type { DbPool } from "../db.js";

export interface FeatureStore {
  /** One row per locality, ordered by locality_id. Anchor-time vectors align to this order. */
  areas: AreaFeatures[];
  params: ModelParams;
  /** Column name -> COMMENT from agent.area_features (pg col_description). */
  columnComments: Record<string, string>;
  /** locality_id -> index into `areas`. */
  areaIndex: Map<string, number>;
}

// The columns the engine reads (AreaFeatures), nothing else.
const AREA_FEATURES_SQL = `
  SELECT
    locality_id, name_en, name_ja, ward_code, ward_name_en, ward_name_ja, lat, lon,
    rent_per_sqm_yen, management_fee_yen, land_price_used_fallback,
    land_value_yen_per_sqm, land_value_nearest_m,
    supermarket_count, restaurant_count, cafe_count, convenience_count,
    cuisine_variety_count, late_night_count, health_count,
    green_space_share, residential_zoning_share, road_rail_exposure_share,
    bar_count, line_count, reach_restaurant, nearest_station_walk_min, access_confidence
  FROM agent.area_features
  ORDER BY locality_id
`;

const MODEL_PARAMS_SQL = `SELECT key, value FROM agent.model_params`;

const COLUMN_COMMENTS_SQL = `
  SELECT a.attname AS column_name, col_description(c.oid, a.attnum) AS comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'agent' AND c.relname = 'area_features'
    AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY a.attnum
`;

/**
 * ModelParams mapping (the plan is silent, so the simplest reading):
 *  - rentElasticity <- model_params row `rent_land_elasticity` (0.3555 locally).
 *    types.ts quotes 0.356, which is that value rounded.
 *  - layoutAreaSqm  <- LAYOUTS[id].midSqm for every layout id in shared/config/scoring.
 * The other model_params rows (reach_decay_minutes, rent_local_multiplier_min/max,
 * CI and R2 rows) are not part of ModelParams and are not read by the engine.
 */
export function toModelParams(rows: readonly { key: string; value: number }[]): ModelParams {
  const byKey = new Map(rows.map((row) => [row.key, Number(row.value)]));
  const elasticity = byKey.get("rent_land_elasticity");
  if (elasticity === undefined || !Number.isFinite(elasticity)) {
    throw new Error("loadFeatureStore: agent.model_params has no usable rent_land_elasticity row");
  }
  const layoutAreaSqm: Record<string, number> = {};
  for (const [id, layout] of Object.entries(LAYOUTS)) layoutAreaSqm[id] = layout.midSqm;
  return { rentElasticity: elasticity, layoutAreaSqm };
}

export async function loadFeatureStore(pool: DbPool): Promise<FeatureStore> {
  const [areaResult, paramResult, commentResult] = await Promise.all([
    pool.query(AREA_FEATURES_SQL) as Promise<{ rows: AreaFeatures[] }>,
    pool.query(MODEL_PARAMS_SQL) as Promise<{ rows: { key: string; value: number }[] }>,
    pool.query(COLUMN_COMMENTS_SQL) as Promise<{
      rows: { column_name: string; comment: string | null }[];
    }>,
  ]);

  const areas = areaResult.rows;
  if (areas.length === 0) {
    throw new Error("loadFeatureStore: agent.area_features returned no rows");
  }
  const areaIndex = new Map<string, number>();
  areas.forEach((area, i) => areaIndex.set(area.locality_id, i));
  if (areaIndex.size !== areas.length) {
    throw new Error("loadFeatureStore: agent.area_features has duplicate locality_id values");
  }

  const columnComments: Record<string, string> = {};
  for (const row of commentResult.rows) {
    if (row.comment !== null) columnComments[row.column_name] = row.comment;
  }

  return { areas, params: toModelParams(paramResult.rows), columnComments, areaIndex };
}
