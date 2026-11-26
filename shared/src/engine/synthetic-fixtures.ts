// SYNTHETIC test fixtures for the engine tests. Not real data: every area,
// rent, count and travel time here is generated from a seed. Real data lives
// in agent.area_features and is never read by the engine tests.
import { createRng } from './rng.js';
import type { AnchorTimes, AreaFeatures, ModelParams, Profile } from './types.js';

export const SYNTHETIC_PARAMS: ModelParams = {
  rentElasticity: 0.356,
  layoutAreaSqm: { '1R': 21, '1K': 24, '1DK': 30, '1LDK': 38, '2K_2DK': 43, '2LDK': 55, '3LDK': 70 },
  // Same values as the model_params rows evidence_beta_share / evidence_tau_share (migration 0025).
  betaShare: 0.03,
  tauShare: 0.01,
};

/** n synthetic areas over 3 synthetic wards, ids "syn-000"... */
export function syntheticAreas(n = 60, seed = 7): AreaFeatures[] {
  const rng = createRng(seed);
  const out: AreaFeatures[] = [];
  for (let i = 0; i < n; i++) {
    const ward = i % 3;
    out.push({
      locality_id: `syn-${String(i).padStart(3, '0')}`,
      name_en: null,
      name_ja: `合成${i}`,
      ward_code: `9990${ward}`,
      ward_name_en: `Synthetic ward ${ward}`,
      ward_name_ja: `合成区${ward}`,
      lat: 35.6 + rng.next() * 0.1,
      lon: 139.6 + rng.next() * 0.1,
      rent_per_sqm_yen: 2500 + ward * 400,
      management_fee_yen: 4000 + ward * 300,
      land_price_used_fallback: false,
      land_value_yen_per_sqm: 400000 * rng.lognormal(0, 0.4),
      land_value_nearest_m: 50 + rng.next() * 800,
      supermarket_count: rng.int(20),
      restaurant_count: rng.int(150),
      cafe_count: rng.int(40),
      convenience_count: rng.int(30),
      cuisine_variety_count: rng.int(40),
      late_night_count: rng.int(15),
      health_count: rng.int(30),
      green_space_share: rng.next() * 0.3,
      residential_zoning_share: rng.next(),
      road_rail_exposure_share: rng.next() * 0.8,
      bar_count: rng.int(40),
      line_count: 1 + rng.int(6),
      reach_restaurant: rng.next() * 100,
      nearest_station_walk_min: 2 + rng.int(15),
      access_confidence: 'low',
    });
  }
  return out;
}

/** Synthetic one-way minutes from one anchor to every area (10 to 70). */
export function syntheticTimes(areas: readonly AreaFeatures[], anchorId = 'work', seed = 11): AnchorTimes {
  const rng = createRng(seed);
  return { [anchorId]: areas.map(() => 10 + rng.next() * 60) };
}

export function syntheticProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    anchors: [{ id: 'work', label: 'Synthetic office', tripsPerWeek: 5, period: 'peak' }],
    layout: '1K',
    budget: { value: 100000, firm: false },
    enoughMultipliers: {},
    ...overrides,
  };
}
