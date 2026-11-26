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
  type Limit,
  type ModelledRent,
  type ModelParams,
  type MonthlyHours,
  type Profile,
  type Saturate,
} from './types.js';

/** Local rent multiplier clamp when ModelParams.rentClamp is absent (same as model_params rent_local_multiplier_min/max). */
export const FALLBACK_RENT_CLAMP: readonly [number, number] = [0.85, 1.15];
/** Fallback sigma_R, for wards without survey rent bands: land_value_nearest_m <= NEAR_PRICE_POINT_M, and otherwise (also for null land value, E04). */
export const SIGMA_RENT_NEAR = 0.08;
export const SIGMA_RENT_FAR = 0.12;
export const NEAR_PRICE_POINT_M = 300;
/** Floor area of one tatami, m2, for the size curve's tatami classes. */
export const SQM_PER_TATAMI = 1.62;
/** Fewer residents than this: offices, parks or port land, never recommended (D5). */
export const MIN_POPULATION = 100;
/** Percentile of reach_restaurant that counts as "enough" for dining_reach. */
export const DINING_REACH_H_PERCENTILE = 0.75;

/** The thirteen features, in FEATURE_KEYS order. h = null is derived from data in buildAreaContext. */
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
  { key: 'safety', label: 'Safety', columns: ['safety_score'], h: 0.8, sign: 'positive' },
];
/** Alias of featureTable. */
export const FEATURE_TABLE = featureTable;

/** Features whose columns are access values (null -> missingAccess, not nullLifestyle). */
const ACCESS_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['dining_reach', 'connectedness']);
/** Features whose null value means "no data": the area takes the median over areas instead of being excluded. */
const IMPUTED_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>(['safety']);

/** s(x) = 1 - 10^(-x / h); s(h) = 0.9. E20: h must be positive; a non-positive h gives a step at zero. */
export const saturate: Saturate = (x, h) => {
  if (!(x > 0)) return 0;
  if (!(h > 0)) return 1;
  return 1 - Math.pow(10, -x / h);
};

/**
 * R(a) = r_w * m(a) * k(A) * A + f_w, m = clip((L_a / wardMedian)^eps, rentClamp),
 * k = the size curve's rent per tatami relative to all sizes (D7: small units
 * cost more per m2). NaN when rent or fee is null (E04). Null land value or
 * ward median: m = 1 (E04). E18: reads rent_per_sqm_yen, management_fee_yen
 * and land_value_yen_per_sqm only.
 */
export const modelledRent: ModelledRent = (area, wardMedianLandValue, layoutAreaSqm, params) => {
  const r = area.rent_per_sqm_yen;
  const f = area.management_fee_yen;
  if (!isNum(r) || !isNum(f) || !Number.isFinite(layoutAreaSqm)) return NaN;
  let m = 1;
  const land = area.land_value_yen_per_sqm;
  if (isNum(land) && land > 0 && isNum(wardMedianLandValue) && wardMedianLandValue > 0) {
    const [lo, hi] = params.rentClamp ?? FALLBACK_RENT_CLAMP;
    m = Math.min(hi, Math.max(lo, Math.pow(land / wardMedianLandValue, params.rentElasticity)));
  }
  return r * m * sizeFactor(layoutAreaSqm, params) * layoutAreaSqm + f;
};

/**
 * relativeToAll of the size class holding the layout's tatami count: the
 * highest class starting at or below it. Classes without a published median
 * are absent, so a layout below the first known class (or in a gap) takes the
 * nearest known class below it, else the first. 1 with no curve.
 */
export function sizeFactor(layoutAreaSqm: number, params: ModelParams): number {
  const curve = params.rentSizeCurve;
  if (!curve || curve.length === 0) return 1;
  const tatami = layoutAreaSqm / SQM_PER_TATAMI;
  let factor = curve[0]!.relativeToAll;
  for (const c of curve) if (c.tatamiMin <= tatami) factor = c.relativeToAll;
  return factor;
}

/**
 * sigma_R: the distance-based base, scaled by how wide the ward's survey rent
 * spread is relative to the typical ward. The raw interquartile ratio is not
 * used directly: it mixes unit sizes (which the size curve already models), so
 * ln(ratio)/1.349 would give sigma near 0.5 and flatten every pBest.
 */
function rentSigma(area: AreaFeatures, params: ModelParams): number {
  const near =
    isNum(area.land_value_yen_per_sqm) && isNum(area.land_value_nearest_m) && area.land_value_nearest_m <= NEAR_PRICE_POINT_M;
  const base = near ? SIGMA_RENT_NEAR : SIGMA_RENT_FAR;
  const spread = params.rentSpreadByWard?.[area.ward_code];
  const typical = typicalLogSpread(params.rentSpreadByWard);
  if (!isNum(spread) || spread <= 1 || !(typical > 0)) return base;
  return base * (Math.log(spread) / typical);
}

const typicalSpreadCache = new WeakMap<object, number>();

/** Median ln(interquartile ratio) across wards; NaN when there are none. */
function typicalLogSpread(byWard: Readonly<Record<string, number>> | undefined): number {
  if (!byWard) return NaN;
  let typical = typicalSpreadCache.get(byWard);
  if (typical === undefined) {
    typical = median(Object.values(byWard).filter((r) => isNum(r) && r > 1).map(Math.log));
    typicalSpreadCache.set(byWard, typical);
  }
  return typical;
}

/** Calibrated commute sd in minutes for the area's access confidence (D4): p90 absolute error / 1.645; NaN when uncalibrated. */
function commuteSigma(area: AreaFeatures, params: ModelParams): number {
  const band = area.access_confidence ? params.commuteError?.[area.access_confidence] : undefined;
  return band && isNum(band.p90AbsErrorMinutes) && band.p90AbsErrorMinutes > 0 ? band.p90AbsErrorMinutes / 1.645 : NaN;
}

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

export type DataGap = 'uninhabited' | 'nullRent' | 'nullLifestyle' | 'missingAccess';

/**
 * First reason (D5, E04) an area cannot be scored, or null when its inputs
 * are complete. Uninhabited: population below MIN_POPULATION (unknown
 * population is not excluded). Access values: line_count, reach_restaurant,
 * nearest_station_walk_min and access_confidence.
 */
export function dataGap(area: AreaFeatures): DataGap | null {
  if (isNum(area.population) && area.population < MIN_POPULATION) return 'uninhabited';
  if (!isNum(area.rent_per_sqm_yen) || !isNum(area.management_fee_yen)) return 'nullRent';
  for (const def of featureTable) {
    if (ACCESS_FEATURES.has(def.key) || IMPUTED_FEATURES.has(def.key)) continue;
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

/** Feature value x for one area: the sum of its columns, or null when any is null. */
function featureValue(area: AreaFeatures, columns: readonly (keyof AreaFeatures)[]): number | null {
  let x = 0;
  for (const col of columns) {
    const v = area[col] as number | null | undefined;
    if (!isNum(v)) return null;
    x += v;
  }
  return x;
}

/**
 * The cap of each anchor, in profile.anchors order: its own cap, and for the
 * main anchor profile.commuteCap when it has none (E8).
 */
export function anchorCaps(profile: Profile): (Limit | undefined)[] {
  return profile.anchors.map((anchor, m) => anchor.cap ?? (m === 0 ? profile.commuteCap : undefined));
}

/**
 * Everything recommend/evidence need for one profile.
 *
 * - Firm limits test point estimates (E12): modelled rent against the budget,
 *   one-way minutes to each capped anchor against its cap (E8).
 * - sat is 0 (never NaN) where a column is null; such areas are infeasible.
 *   Imputed features (safety) take the median over areas instead.
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
  const travelSigma = new Float64Array(n);
  for (let a = 0; a < n; a++) {
    const area = areas[a]!;
    rent[a] = modelledRent(area, wardMedians.get(area.ward_code) ?? null, layoutSqm, params);
    sigmaRent[a] = rentSigma(area, params);
    travelSigma[a] = commuteSigma(area, params);
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
    const xs = areas.map((area) => featureValue(area, def.columns));
    const fill = IMPUTED_FEATURES.has(def.key) ? median(xs.filter(isNum)) : NaN;
    for (let a = 0; a < n; a++) {
      const x = xs[a] ?? fill;
      sat[a * nF + j] = isNum(x) ? saturate(x, h) : 0;
    }
  });

  const excluded: ExcludedSummary = {
    uninhabited: 0,
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
  const caps = anchorCaps(profile);
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
    if (caps.some((cap, m) => cap?.firm && minutes[m]![a]! > cap.value)) {
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

  const ctx: AreaContext = {
    areas,
    index,
    rent,
    minutes,
    sat,
    sigmaRent,
    commuteSigma: travelSigma,
    ...(params.betaShare !== undefined ? { betaShare: params.betaShare } : {}),
    ...(params.tauShare !== undefined ? { tauShare: params.tauShare } : {}),
    feasible,
    excluded,
    scale,
  };
  return ctx;
};

/** Per-area travel and limit terms of U, from point estimates. */
export interface AreaTerms {
  /** T(a): monthly hours across all anchors. */
  hours: Float64Array;
  /** Sum over capped anchors of [T_m(a) - T_C,m]+ in monthly hours; 0 with no cap. */
  overCap: Float64Array;
  /** [R(a) - B]+ in yen; 0 with no budget. */
  overBudget: Float64Array;
  /** 1 when U is defined: complete inputs, finite rent, finite minutes to every anchor. */
  scorable: Uint8Array;
}

/** T_C per anchor: its cap minutes as monthly hours at that anchor's trips (E12, E8); null where uncapped. */
export function capHours(profile: Profile): (number | null)[] {
  const caps = anchorCaps(profile);
  return profile.anchors.map((anchor, m) => {
    const cap = caps[m];
    return cap ? monthlyHours(cap.value, anchor.tripsPerWeek) : null;
  });
}

/** Monthly hours across anchors and the summed cap excess, for one area given one-way minutes per anchor. */
export function travelHours(
  minutesPerAnchor: readonly number[],
  profile: Profile,
  caps: readonly (number | null)[],
): { hours: number; overCap: number } {
  let hours = 0;
  let overCap = 0;
  profile.anchors.forEach((anchor, m) => {
    const h = monthlyHours(minutesPerAnchor[m] ?? 0, anchor.tripsPerWeek);
    hours += h;
    const tc = caps[m];
    if (tc != null) overCap += Math.max(0, h - tc);
  });
  return { hours, overCap };
}

export function areaTerms(ctx: AreaContext, profile: Profile): AreaTerms {
  const n = ctx.areas.length;
  const hours = new Float64Array(n);
  const overCap = new Float64Array(n);
  const overBudget = new Float64Array(n);
  const scorable = new Uint8Array(n);
  const caps = capHours(profile);
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
    const t = travelHours(mins, profile, caps);
    hours[a] = t.hours;
    overCap[a] = t.overCap;
    overBudget[a] = B !== undefined ? Math.max(0, ctx.rent[a]! - B) : 0;
  }
  return { hours, overCap, overBudget, scorable };
}
