import { LAYOUTS } from "@tokyo/shared";
import type { AreaFeatures, CommuteErrorBand, ModelParams, RentSizeClass } from "@tokyo/shared";

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
    bar_count, line_count, reach_restaurant, nearest_station_walk_min, access_confidence, population,
    quake_rank, flood_share, crime_per_1k, safety_score,
    nearest_station_name_ja, nearest_station_name_en, rent_market_refs
  FROM agent.area_features
  ORDER BY locality_id
`;

const MODEL_PARAMS_SQL = `SELECT key, value FROM agent.model_params`;

const COMMUTE_ERROR_SQL = `
  SELECT confidence, n, mean_error_minutes, mae_minutes, p90_abs_error_minutes
  FROM agent.commute_error_model
`;

// Private rentals, latest survey year; size class 0 is the all-sizes row.
const RENT_SIZE_CURVE_SQL = `
  SELECT tatami_min, tatami_max, relative_to_all
  FROM agent.rent_size_curve
  WHERE tenure = 'private_rental' AND size_class_code <> '0' AND relative_to_all IS NOT NULL
    AND period = (SELECT max(period) FROM agent.rent_size_curve)
  ORDER BY tatami_min
`;

const RENT_BANDS_SQL = `
  SELECT ward_code, band_low_yen, band_high_yen, dwellings
  FROM agent.ward_rent_bands
  WHERE period = (SELECT max(period) FROM agent.ward_rent_bands)
`;

const COLUMN_COMMENTS_SQL = `
  SELECT a.attname AS column_name, col_description(c.oid, a.attnum) AS comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'agent' AND c.relname = 'area_features'
    AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY a.attnum
`;

interface RentBand {
  band_low_yen: number | null;
  band_high_yen: number | null;
  dwellings: number;
}

interface WardRentBand extends RentBand {
  ward_code: string;
}

interface CommuteErrorRow {
  confidence: string;
  n: number;
  mean_error_minutes: number;
  mae_minutes: number;
  p90_abs_error_minutes: number;
}

interface SizeCurveRow {
  tatami_min: number;
  tatami_max: number | null;
  relative_to_all: number;
}

/** Tables the engine reads beyond model_params. All may be empty, and the engine then falls back to its constants. */
export type CalibrationTables = Pick<
  ModelParams,
  "commuteError" | "rentSizeCurve" | "rentSpreadByWard"
>;

/**
 * Quantile of the rent distribution held in survey bands, interpolating inside
 * the band that holds it. The 0-yen and not-stated bands are skipped, and a
 * quantile in the open top band returns that band's lower bound.
 */
export function bandQuantile(bands: readonly RentBand[], q: number): number | null {
  const priced = bands
    .filter((b) => b.band_low_yen !== null && b.band_low_yen > 0)
    .sort((a, b) => a.band_low_yen! - b.band_low_yen!);
  const total = priced.reduce((sum, b) => sum + b.dwellings, 0);
  if (total <= 0) return null;
  let below = 0;
  for (const band of priced) {
    if (band.dwellings > 0 && below + band.dwellings >= q * total) {
      const low = band.band_low_yen!;
      if (band.band_high_yen === null) return low;
      return low + ((q * total - below) / band.dwellings) * (band.band_high_yen - low);
    }
    below += band.dwellings;
  }
  return null;
}

/** Per ward: 75th / 25th percentile rent. Wards whose bands give no usable ratio are left out. */
export function rentSpreadByWard(rows: readonly WardRentBand[]): Record<string, number> {
  const byWard = new Map<string, RentBand[]>();
  for (const row of rows) byWard.set(row.ward_code, [...(byWard.get(row.ward_code) ?? []), row]);
  const spread: Record<string, number> = {};
  for (const [ward, bands] of byWard) {
    const q25 = bandQuantile(bands, 0.25);
    const q75 = bandQuantile(bands, 0.75);
    if (q25 !== null && q75 !== null && q25 > 0) spread[ward] = q75 / q25;
  }
  return spread;
}

const CONFIDENCES = ["high", "medium", "low"] as const;

function commuteErrorByConfidence(
  rows: readonly CommuteErrorRow[],
): NonNullable<ModelParams["commuteError"]> {
  const byConfidence: Partial<Record<(typeof CONFIDENCES)[number], CommuteErrorBand>> = {};
  for (const row of rows) {
    const confidence = CONFIDENCES.find((c) => c === row.confidence);
    if (confidence === undefined) continue;
    byConfidence[confidence] = {
      n: Number(row.n),
      meanErrorMinutes: Number(row.mean_error_minutes),
      maeMinutes: Number(row.mae_minutes),
      p90AbsErrorMinutes: Number(row.p90_abs_error_minutes),
    };
  }
  return byConfidence;
}

/**
 * ModelParams mapping:
 *  - rentElasticity <- model_params row `rent_land_elasticity` (0.3555 locally).
 *    types.ts quotes 0.356, which is that value rounded.
 *  - layoutAreaSqm  <- LAYOUTS[id].midSqm for every layout id in shared/config/scoring.
 *  - rentClamp      <- model_params rows `rent_local_multiplier_min/max`, when both exist.
 *  - betaShare, tauShare <- model_params rows `evidence_beta_share`, `evidence_tau_share` (migration 0025), when present.
 * The other model_params rows (reach_decay_minutes, CI and R2 rows) are not read by the engine.
 */
export function toModelParams(
  rows: readonly { key: string; value: number }[],
  tables: CalibrationTables = {},
): ModelParams {
  const byKey = new Map(rows.map((row) => [row.key, Number(row.value)]));
  const elasticity = byKey.get("rent_land_elasticity");
  if (elasticity === undefined || !Number.isFinite(elasticity)) {
    throw new Error("loadFeatureStore: agent.model_params has no usable rent_land_elasticity row");
  }
  const layoutAreaSqm: Record<string, number> = {};
  for (const [id, layout] of Object.entries(LAYOUTS)) layoutAreaSqm[id] = layout.midSqm;
  const clampMin = byKey.get("rent_local_multiplier_min");
  const clampMax = byKey.get("rent_local_multiplier_max");
  const rentClamp =
    clampMin !== undefined &&
    clampMax !== undefined &&
    Number.isFinite(clampMin) &&
    Number.isFinite(clampMax)
      ? { rentClamp: [clampMin, clampMax] as const }
      : {};
  return {
    rentElasticity: elasticity,
    layoutAreaSqm,
    ...rentClamp,
    ...optionalParam("betaShare", byKey.get("evidence_beta_share")),
    ...optionalParam("tauShare", byKey.get("evidence_tau_share")),
    ...tables,
  };
}

function optionalParam<K extends keyof ModelParams>(key: K, value: number | undefined): Partial<Pick<ModelParams, K>> {
  return value !== undefined && Number.isFinite(value) ? ({ [key]: value } as Partial<Pick<ModelParams, K>>) : {};
}

function rentSizeCurve(rows: readonly SizeCurveRow[]): RentSizeClass[] {
  return rows.map((row) => ({
    tatamiMin: Number(row.tatami_min),
    tatamiMax: row.tatami_max === null ? null : Number(row.tatami_max),
    relativeToAll: Number(row.relative_to_all),
  }));
}

export async function loadFeatureStore(pool: DbPool): Promise<FeatureStore> {
  const [areaResult, paramResult, commentResult, commuteResult, curveResult, bandResult] =
    await Promise.all([
      pool.query(AREA_FEATURES_SQL) as Promise<{ rows: AreaFeatures[] }>,
      pool.query(MODEL_PARAMS_SQL) as Promise<{ rows: { key: string; value: number }[] }>,
      pool.query(COLUMN_COMMENTS_SQL) as Promise<{
        rows: { column_name: string; comment: string | null }[];
      }>,
      pool.query(COMMUTE_ERROR_SQL) as Promise<{ rows: CommuteErrorRow[] }>,
      pool.query(RENT_SIZE_CURVE_SQL) as Promise<{ rows: SizeCurveRow[] }>,
      pool.query(RENT_BANDS_SQL) as Promise<{ rows: WardRentBand[] }>,
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

  const params = toModelParams(paramResult.rows, {
    commuteError: commuteErrorByConfidence(commuteResult.rows),
    rentSizeCurve: rentSizeCurve(curveResult.rows),
    rentSpreadByWard: rentSpreadByWard(bandResult.rows),
  });
  return { areas, params, columnComments, areaIndex };
}
