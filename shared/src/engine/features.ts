// Area-side inputs of the engine: the feature table, saturation, modelled rent,
// travel hours and the per-profile AreaContext (docs/plans/engine-spec.md,
// "The value of an area, in yen"). Pure: no DB, no model, no randomness.
import {
  FEATURE_KEYS,
  type AnchorTimes,
  type AreaContext,
  type AreaFeatures,
  type BuildAreaContext,
  type ExcludedSummary,
  type FeatureKey,
  type FeatureTable,
  type ModelledRent,
  type ModelParams,
  type MonthlyHours,
  type Profile,
  type Saturate,
} from './types.js';

/** Local rent multiplier clamp (spec; wider than the stored 0.85 to 1.15, see E18). */
export const RENT_CLAMP: readonly [number, number] = [0.7, 1.4];
/** sigma_R when land_value_nearest_m <= NEAR_PRICE_POINT_M, and otherwise (also for null land value, E04). */
export const SIGMA_RENT_NEAR = 0.08;
export const SIGMA_RENT_FAR = 0.12;
export const NEAR_PRICE_POINT_M = 300;
/** Percentile of reach_restaurant that counts as "enough" for dining_reach. */
export const DINING_REACH_H_PERCENTILE = 0.75;

/** The twelve features, in FEATURE_KEYS order. h = null is derived from data in buildAreaContext. */
export const featureTable: FeatureTable = [
  { key: 'supermarkets', label: 'Supermarkets', columns: ['supermarket_count'], h: 4, sign: 'positive' },
  { key: 'dining', label: 'Restaurants and cafes', columns: ['restaurant_count', 'cafe_count'], h: 40, sign: 'positive' },
  { key: 'konbini', label: 'Konbini', columns: ['convenience_count'], h: 10, sign: 'positive' },
  { key: 'cuisine_variety', label: 'Cuisine variety', columns: ['cuisine_variety_count'], h: 12, sign: 'positive' },
  { key: 'late_night', label: 'Late-night food', columns: ['late_night_count'], h: 6, sign: 'positive' },
  { key: 'health', label: 'Everyday health', columns: ['health_count'], h: 8, sign: 'positive' },
  { key: 'green_space', label: 'Green space', columns: ['green_space_share'], h: 0.15, sign: 'positive' },
  { key: 'residential_calm', label: 'Residential calm', columns: ['residential_zoning_share'], h: 0.6, sign: 'positive' },
  { key: 'road_rail_exposure', label: 'Road and rail exposure', columns: ['road_rail_exposure_share'], h: 0.5, sign: 'negative' },
  { key: 'bars', label: 'Bars nearby', columns: ['bar_count'], h: 6, sign: 'either' },
  { key: 'dining_reach', label: 'Dining a short ride away', columns: ['reach_restaurant'], h: null, sign: 'positive' },
  { key: 'connectedness', label: 'Connectedness', columns: ['line_count'], h: 3, sign: 'positive' },
];
/** Alias of featureTable. */
export const FEATURE_TABLE = featureTable;

/** Features whose columns are access values (null -> missingAccess, not nullLifestyle). */
const ACCESS_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['dining_reach', 'connectedness']);

/** s(x) = 1 - 10^(-x / h); s(h) = 0.9. E20: h must be positive; a non-positive h gives a step at zero. */
export const saturate: Saturate = (x, h) => {
  if (!(x > 0)) return 0;
  if (!(h > 0)) return 1;
  return 1 - Math.pow(10, -x / h);
};

/**
 * R(a) = r_w * m(a) * A + f_w, m = clip((L_a / wardMedian)^eps, 0.7, 1.4).
 * NaN when rent or fee is null (E04). Null land value or ward median: m = 1 (E04).
 * E18: reads rent_per_sqm_yen, management_fee_yen and land_value_yen_per_sqm only.
 */
export const modelledRent: ModelledRent = (area, wardMedianLandValue, layoutAreaSqm, params) => {
  const r = area.rent_per_sqm_yen;
  const f = area.management_fee_yen;
  if (!isNum(r) || !isNum(f) || !Number.isFinite(layoutAreaSqm)) return NaN;
  let m = 1;
  const land = area.land_value_yen_per_sqm;
  if (isNum(land) && land > 0 && isNum(wardMedianLandValue) && wardMedianLandValue > 0) {
    m = Math.min(RENT_CLAMP[1], Math.max(RENT_CLAMP[0], Math.pow(land / wardMedianLandValue, params.rentElasticity)));
  }
  return r * m * layoutAreaSqm + f;
};

/** Hours per month for round trips: 52/12 * n * 2t / 60. */
export const monthlyHours: MonthlyHours = (oneWayMinutes, tripsPerWeek) =>
  (52 / 12) * tripsPerWeek * ((2 * oneWayMinutes) / 60);

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Median of finite values; NaN for an empty list. */
export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/** Linear-interpolated quantile of finite values; NaN for an empty list. */
export function quantile(values: readonly number[], q: number): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

/** Median land value per ward over non-null localities (E18: not a column). */
export function wardMedianLandValues(areas: readonly AreaFeatures[]): Map<string, number> {
  const byWard = new Map<string, number[]>();
  for (const a of areas) {
    if (!isNum(a.land_value_yen_per_sqm)) continue;
    const list = byWard.get(a.ward_code);
    if (list) list.push(a.land_value_yen_per_sqm);
    else byWard.set(a.ward_code, [a.land_value_yen_per_sqm]);
  }
  const out = new Map<string, number>();
  for (const [ward, list] of byWard) out.set(ward, median(list));
  return out;
}

/**
 * Layout size used for rent. Spec is silent on a missing or unknown layout:
 * the median of the configured sizes is used so a scale exists before the
 * layout is known (the engine reports 'layout' as missing in that case).
 */
export function resolveLayoutAreaSqm(profile: Profile, params: ModelParams): number {
  const known = profile.layout !== undefined ? params.layoutAreaSqm[profile.layout] : undefined;
  if (isNum(known)) return known;
  return median(Object.values(params.layoutAreaSqm));
}

/** h for dining_reach: 75th percentile of reach_restaurant; E20: floored at the smallest positive value. */
export function diningReachH(areas: readonly AreaFeatures[]): number {
  const values: number[] = [];
  for (const a of areas) if (isNum(a.reach_restaurant)) values.push(a.reach_restaurant);
  const p = quantile(values, DINING_REACH_H_PERCENTILE);
  if (p > 0) return p;
  let smallest = Infinity;
  for (const v of values) if (v > 0 && v < smallest) smallest = v;
  return Number.isFinite(smallest) ? smallest : 1; // no positive value anywhere: every s is 0 regardless of h
}

export type DataGap = 'nullRent' | 'nullLifestyle' | 'missingAccess';

/**
 * First data reason (E04) an area cannot be scored, or null when its inputs
 * are complete. Access values: line_count, reach_restaurant,
 * nearest_station_walk_min and access_confidence.
 */
export function dataGap(area: AreaFeatures): DataGap | null {
  if (!isNum(area.rent_per_sqm_yen) || !isNum(area.management_fee_yen)) return 'nullRent';
  for (const def of featureTable) {
    if (ACCESS_FEATURES.has(def.key)) continue;
    for (const col of def.columns) if (!isNum(area[col] as number | null)) return 'nullLifestyle';
  }
  if (
    !isNum(area.line_count) ||
    !isNum(area.reach_restaurant) ||
    !isNum(area.nearest_station_walk_min) ||
    area.access_confidence == null
  ) {
    return 'missingAccess';
  }
  return null;
}

function anchorVector(anchorTimes: AnchorTimes, anchorId: string, n: number): Float64Array | number[] | null {
  const v = Object.prototype.hasOwnProperty.call(anchorTimes, anchorId) ? anchorTimes[anchorId] : undefined;
  return v && v.length === n ? v : null;
}

/**
 * Everything recommend/evidence need for one profile.
 *
 * - Firm limits test point estimates (E12): modelled rent against the budget,
 *   one-way minutes to the main anchor (profile.anchors[0]) against the cap.
 * - sat is 0 (never NaN) where a column is null; such areas are infeasible.
 * - minutes[m] keeps profile.anchors order. An anchor with no vector of the
 *   right length in anchorTimes is ignored: its row is all zeros, so it adds no
 *   travel time and disconnects nothing. The engine reports it as 'no_times';
 *   callers should drop such anchors from the profile before calling.
 */
export const buildAreaContext: BuildAreaContext = (areas, params, profile, anchorTimes) => {
  const n = areas.length;
  const nF = FEATURE_KEYS.length;
  const index = new Map<string, number>();
  areas.forEach((a, i) => index.set(a.locality_id, i));

  const wardMedians = wardMedianLandValues(areas);
  const layoutSqm = resolveLayoutAreaSqm(profile, params);

  const rent = new Float64Array(n);
  const sigmaRent = new Float64Array(n);
  for (let a = 0; a < n; a++) {
    const area = areas[a]!;
    rent[a] = modelledRent(area, wardMedians.get(area.ward_code) ?? null, layoutSqm, params);
    const near =
      isNum(area.land_value_yen_per_sqm) && isNum(area.land_value_nearest_m) && area.land_value_nearest_m <= NEAR_PRICE_POINT_M;
    sigmaRent[a] = near ? SIGMA_RENT_NEAR : SIGMA_RENT_FAR;
  }

  const minutes: Float64Array[] = profile.anchors.map((anchor) => {
    const row = new Float64Array(n);
    const v = anchorVector(anchorTimes, anchor.id, n);
    if (v) for (let a = 0; a < n; a++) row[a] = Number.isFinite(v[a]) && v[a]! >= 0 ? v[a]! : NaN;
    return row;
  });

  const reachH = diningReachH(areas);
  const sat = new Float64Array(n * nF);
  featureTable.forEach((def, j) => {
    const base = def.h ?? reachH;
    const mult = profile.enoughMultipliers?.[def.key];
    const h = base * (isNum(mult) && mult > 0 ? mult : 1);
    for (let a = 0; a < n; a++) {
      const area = areas[a]!;
      let x = 0;
      let complete = true;
      for (const col of def.columns) {
        const v = area[col] as number | null;
        if (isNum(v)) x += v;
        else complete = false;
      }
      sat[a * nF + j] = complete ? saturate(x, h) : 0;
    }
  });

  const excluded: ExcludedSummary = {
    nullRent: 0,
    nullLifestyle: 0,
    missingAccess: 0,
    disconnected: 0,
    overBudgetFirm: 0,
    overCommuteCapFirm: 0,
  };
  const feasible = new Uint8Array(n);
  const reachableRents: number[] = [];
  const budget = profile.budget;
  const cap = profile.commuteCap;
  const mainMinutes = minutes[0];
  for (let a = 0; a < n; a++) {
    const gap = dataGap(areas[a]!);
    if (gap !== null) {
      excluded[gap]++;
      continue;
    }
    if (!Number.isFinite(rent[a])) {
      excluded.nullRent++; // no usable layout size
      continue;
    }
    if (minutes.some((row) => !Number.isFinite(row[a]))) {
      excluded.disconnected++;
      continue;
    }
    reachableRents.push(rent[a]!);
    if (budget?.firm && rent[a]! > budget.value) {
      excluded.overBudgetFirm++;
      continue;
    }
    if (cap?.firm && mainMinutes && mainMinutes[a]! > cap.value) {
      excluded.overCommuteCapFirm++;
      continue;
    }
    feasible[a] = 1;
  }

  // E08: one scale. Budget if stated; else the median modelled rent of the
  // reachable areas (complete inputs, finite minutes to every anchor; with no
  // anchor that is every scorable area); else of any area with a rent.
  let scale = budget ? budget.value : median(reachableRents);
  if (!(scale > 0)) scale = median(Array.from(rent));
  if (!(scale > 0)) scale = 1; // no rent anywhere: keeps divisions finite, nothing is feasible

  const ctx: AreaContext = { areas, index, rent, minutes, sat, sigmaRent, feasible, excluded, scale };
  return ctx;
};

/** Per-area travel and limit terms of U, from point estimates. */
export interface AreaTerms {
  /** T(a): monthly hours across all anchors. */
  hours: Float64Array;
  /** [T_1(a) - T_C]+ in monthly hours; 0 with no cap or no anchor. */
  overCap: Float64Array;
  /** [R(a) - B]+ in yen; 0 with no budget. */
  overBudget: Float64Array;
  /** 1 when U is defined: complete inputs, finite rent, finite minutes to every anchor. */
  scorable: Uint8Array;
}

/** T_C = cap minutes as monthly hours at the main anchor's trips (E12). */
export function capHours(profile: Profile): number | null {
  const cap = profile.commuteCap;
  const main = profile.anchors[0];
  if (!cap || !main) return null;
  return monthlyHours(cap.value, main.tripsPerWeek);
}

/** Hours, cap excess and budget excess for one area given one-way minutes per anchor. */
export function travelHours(minutesPerAnchor: readonly number[], profile: Profile): { hours: number; main: number } {
  let hours = 0;
  let main = 0;
  profile.anchors.forEach((anchor, m) => {
    const h = monthlyHours(minutesPerAnchor[m] ?? 0, anchor.tripsPerWeek);
    hours += h;
    if (m === 0) main = h;
  });
  return { hours, main };
}

export function areaTerms(ctx: AreaContext, profile: Profile): AreaTerms {
  const n = ctx.areas.length;
  const hours = new Float64Array(n);
  const overCap = new Float64Array(n);
  const overBudget = new Float64Array(n);
  const scorable = new Uint8Array(n);
  const tc = capHours(profile);
  const B = profile.budget?.value;
  const mins: number[] = new Array(ctx.minutes.length).fill(0);
  for (let a = 0; a < n; a++) {
    let ok = dataGap(ctx.areas[a]!) === null && Number.isFinite(ctx.rent[a]!);
    for (let m = 0; m < ctx.minutes.length; m++) {
      mins[m] = ctx.minutes[m]![a]!;
      if (!Number.isFinite(mins[m])) ok = false;
    }
    if (!ok) continue;
    scorable[a] = 1;
    const t = travelHours(mins, profile);
    hours[a] = t.hours;
    overCap[a] = tc !== null ? Math.max(0, t.main - tc) : 0;
    overBudget[a] = B !== undefined ? Math.max(0, ctx.rent[a]! - B) : 0;
  }
  return { hours, overCap, overBudget, scorable };
}
