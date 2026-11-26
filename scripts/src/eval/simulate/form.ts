// The fixed form (/v1/optimize) filled in by a hidden person, and scored by the
// API's own scoring code. The form asks for importance levels on up to five of
// eight lifestyle axes; a person's level for an axis comes from where the
// weight they put on it sits among everyone's weights.
import { FEATURE_KEYS, LIFESTYLE_AXIS_IDS, LIFESTYLE_SUFFICIENCY_TARGETS, MAX_SELECTED_LIFESTYLE_AXES, QUIETNESS_WEIGHTS } from '@tokyo/shared';
import type { AreaContext, AreaFeatures, FeatureKey, LifestyleAxisId, OptimizationRequest } from '@tokyo/shared';

import type { FormCandidate, ScoringModules } from '../engine-loader.js';
import { quantile } from './stats.js';
import type { HiddenUser } from './users.js';

type Importance = OptimizationRequest['preferences'][LifestyleAxisId];

/** Engine features behind each form axis; quietness adds up calm and (the nuisance) exposure. */
const AXIS_FEATURES: Record<LifestyleAxisId, readonly FeatureKey[]> = {
  supermarkets: ['supermarkets'],
  restaurants: ['dining'],
  quietness: ['residential_calm', 'road_rail_exposure'],
  konbini: ['konbini'],
  cuisineVariety: ['cuisine_variety'],
  greenSpace: ['green_space'],
  lateNight: ['late_night'],
  health: ['health'],
};

/** Importance level by the weight's quantile among all people's axis weights: below the median low, then medium, high, and the top 10% essential. */
const LEVEL_QUANTILES: readonly [number, Exclude<Importance, undefined>][] = [
  [0.5, 'low'],
  [0.75, 'medium'],
  [0.9, 'high'],
];

type AxisShares = Record<LifestyleAxisId, number>;

/** Each axis's share of the person's total feature weight. */
function axisShares(user: HiddenUser): AxisShares {
  const magnitude = (key: FeatureKey): number => Math.abs(user.theta[1 + FEATURE_KEYS.indexOf(key)]!);
  const total = FEATURE_KEYS.reduce((s, key) => s + magnitude(key), 0);
  const shares = {} as AxisShares;
  for (const axis of LIFESTYLE_AXIS_IDS) shares[axis] = AXIS_FEATURES[axis].reduce((s, key) => s + magnitude(key), 0) / total;
  return shares;
}

export interface FormFiller {
  /** The form's preferences for one hidden person. */
  preferences(user: HiddenUser): OptimizationRequest['preferences'];
}

export function createFormFiller(users: readonly HiddenUser[]): FormFiller {
  const pooled = users.flatMap((user) => Object.values(axisShares(user)));
  const cuts = LEVEL_QUANTILES.map(([q]) => quantile(pooled, q));
  const level = (share: number): Exclude<Importance, undefined> => {
    const i = cuts.findIndex((cut) => share < cut);
    return i >= 0 ? LEVEL_QUANTILES[i]![1] : 'essential';
  };
  return {
    preferences(user) {
      const shares = axisShares(user);
      const top = [...LIFESTYLE_AXIS_IDS].sort((a, b) => shares[b] - shares[a]).slice(0, MAX_SELECTED_LIFESTYLE_AXES);
      return Object.fromEntries(top.map((axis) => [axis, level(shares[axis])]));
    },
  };
}

const cap100 = (x: number): number => Math.min(100, Math.max(0, x));

/** The form's 0-100 lifestyle scores, derived from the same counts as the engine's features (area_features has no norm columns). */
function lifestyleOf(area: AreaFeatures): FormCandidate['lifestyle'] {
  const t = LIFESTYLE_SUFFICIENCY_TARGETS;
  const against = (count: number, target: number): number => cap100((100 * count) / target);
  const quiet =
    QUIETNESS_WEIGHTS.residentialZoningShare * (area.residential_zoning_share ?? 0) +
    QUIETNESS_WEIGHTS.inverseRoadRailExposure * (1 - (area.road_rail_exposure_share ?? 0)) +
    QUIETNESS_WEIGHTS.inverseNightlifeDensity * (1 - Math.min(1, (area.bar_count ?? 0) / t.nightlifeForQuietness));
  return {
    normAmenitySupermarket: against(area.supermarket_count, t.supermarketEquivalent),
    normAmenityRestaurant: against(area.restaurant_count + area.cafe_count, t.restaurantsAndCafes),
    normQuietness: cap100(100 * quiet),
    normAmenityConvenience: against(area.convenience_count, t.convenience),
    normAmenityCuisineVariety: against(area.cuisine_variety_count, t.cuisineTypes),
    normGreenSpace: against(area.green_space_share, t.greenSpaceShare),
    normAmenityLateNight: against(area.late_night_count, t.lateNight),
    normAmenityHealth: against(area.health_count, t.health),
    supermarketCount: area.supermarket_count,
    restaurantCount: area.restaurant_count,
    cafeCount: area.cafe_count,
    convenienceCount: area.convenience_count,
    cuisineVarietyCount: area.cuisine_variety_count,
    greenSpaceShare: area.green_space_share,
    lateNightCount: area.late_night_count,
    healthCount: area.health_count,
    sourceDate: null,
    confidence: 'medium',
  };
}

/** One form candidate per feasible area, with the engine's modelled rent and the main anchor's minutes. */
export function formCandidates(ctx: AreaContext, layout: string): FormCandidate[] {
  const candidates: FormCandidate[] = [];
  ctx.areas.forEach((area, a) => {
    if (!ctx.feasible[a]) return;
    candidates.push({
      localityId: area.locality_id,
      nameEn: area.name_en ?? area.name_ja,
      nameJa: area.name_ja,
      wardCode: area.ward_code,
      wardNameEn: area.ward_name_en ?? '',
      wardNameJa: area.ward_name_ja ?? '',
      centroid: { lat: area.lat, lon: area.lon },
      rent: { medianYen: ctx.rent[a]!, layout, confidence: 'medium', sourcePeriod: '' },
      commute: { totalMinutes: ctx.minutes[0]![a]!, confidence: 'medium', path: [] },
      lifestyle: lifestyleOf(area),
    });
  });
  return candidates;
}

/** The form's top pick among the candidates that pass its hard filters; null when none do. */
export function formTopPick(
  scoring: ScoringModules,
  candidates: readonly FormCandidate[],
  request: Pick<OptimizationRequest, 'monthlyBudgetYen' | 'maxCommuteMinutes' | 'preferences'>,
): string | null {
  const { feasible } = scoring.applyHardFilters(candidates, request);
  const ranked = scoring.rankCandidates(feasible.map((candidate) => scoring.scoreCandidate(candidate, request)));
  return ranked[0]?.localityId ?? null;
}
