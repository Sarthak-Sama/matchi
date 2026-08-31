export interface LayoutDefinition {
  readonly id: string;
  readonly label: string;
  readonly minSqm: number;
  readonly maxSqm: number;
  readonly midSqm: number;
}

export const LAYOUTS = {
  "1R": { id: "1R", label: "1R", minSqm: 18, maxSqm: 25, midSqm: 21 },
  "1K": { id: "1K", label: "1K", minSqm: 20, maxSqm: 28, midSqm: 24 },
  "1DK": { id: "1DK", label: "1DK", minSqm: 25, maxSqm: 35, midSqm: 30 },
  "1LDK": { id: "1LDK", label: "1LDK", minSqm: 32, maxSqm: 45, midSqm: 38 },
  "2K_2DK": {
    id: "2K_2DK",
    label: "2K/2DK",
    minSqm: 35,
    maxSqm: 50,
    midSqm: 43,
  },
  "2LDK": { id: "2LDK", label: "2LDK", minSqm: 45, maxSqm: 65, midSqm: 55 },
  "3LDK": { id: "3LDK", label: "3LDK", minSqm: 60, maxSqm: 80, midSqm: 70 },
} as const satisfies Record<string, LayoutDefinition>;

export const LAYOUT_IDS = ["1R", "1K", "1DK", "1LDK", "2K_2DK", "2LDK", "3LDK"] as const;

export const LOW_ESTIMATE_FACTOR = 0.9;

export const HIGH_ESTIMATE_FACTOR = 1.1;

export const LAND_PRICE_MULTIPLIER_EXPONENT = 0.25;
export const LAND_PRICE_MULTIPLIER_MIN = 0.85;
export const LAND_PRICE_MULTIPLIER_MAX = 1.15;

export const MIN_LAND_PRICE_POINTS = 3;

export const LAND_PRICE_FALLBACK_WARN_SHARE = 0.5;

export const RENT_STAT_RECENT_MAX_AGE_YEARS = 2;

export const RENT_STAT_OLD_MIN_AGE_YEARS = 5;

export const CATCHMENT_RADIUS_M = 800;

export const CATCHMENT_LABEL = "approximate 10-minute station area";

export const ROAD_RAIL_BUFFER_M = 100;

export const STATION_MERGE_RADIUS_M = 300;

export const ACCESS_WALK_MINUTES = 8;

export const TRANSFER_PENALTY_MINUTES = 5;

export const PEAK_WAIT_MINUTES = 4;

export const OFFPEAK_WAIT_MINUTES = 6;

export const PEAK_WINDOW = {
  startMinutes: 7 * 60 + 30,
  endMinutes: 10 * 60,
} as const;

export const FALLBACK_SPEEDS_KMH = {
  subway: 28,
  local_rail: 28,
  commuter_rail: 35,
  monorail: 30,
} as const;

export const DWELL_SECONDS_PER_INTERMEDIATE_STATION = 45;

export const MIN_EXPECTED_WAIT_MINUTES = 1;
export const MAX_EXPECTED_WAIT_MINUTES = 15;

export const WALK_SPEED_M_PER_MIN = 80;

export const WALK_DETOUR_FACTOR = 1.3;

export const MAX_DESTINATION_WALK_M = 1500;

export const LOCALITY_SAMPLE_COUNT = 9;
export const LOCALITY_STATION_LIMIT = 3;
export const LOCALITY_STATION_RADIUS_M = 1500;

export const LIFESTYLE_SUFFICIENCY_TARGETS = {
  supermarketEquivalent: 4,
  restaurantsAndCafes: 40,
  convenience: 10,
  cuisineTypes: 12,
  lateNight: 6,
  health: 8,
  greenSpaceShare: 0.15,
  nightlifeForQuietness: 6,
} as const;

export const OVERALL_WEIGHTS = {
  affordability: 0.3,
  commute: 0.3,
  lifestyle: 0.4,
} as const;

export const IMPORTANCE_VALUES = {
  low: 1,
  medium: 2,
  high: 4,
  essential: 8,
} as const;

export const IMPORTANCE_OPTIONS = Object.keys(IMPORTANCE_VALUES) as ReadonlyArray<
  keyof typeof IMPORTANCE_VALUES
>;

export const AFFORDABILITY_FULL_SCORE_RATIO = 0.8;

export const COMMUTE_FULL_SCORE_MINUTES = 15;

export const REASON_POSITIVE_THRESHOLD = 0.66;

export const REASON_NEGATIVE_THRESHOLD = 0.34;

export const QUIETNESS_WEIGHTS = {
  residentialZoningShare: 0.5,
  inverseRoadRailExposure: 0.3,
  inverseNightlifeDensity: 0.2,
} as const;

export const AMENITY_WEIGHTS = {
  supermarket: 1.0,
  grocery: 0.5,
  convenience: 0.25,
} as const;

export const RENT_LABEL = "modeled area rent";

export const COMMUTE_LABEL = "typical weekday estimate";

export const QUIETNESS_LABEL = "quietness proxy";

export const RESULTS_LIMIT = 20;

export const STATIONS_DEFAULT_LIMIT = 10;

export const STATIONS_MAX_LIMIT = 50;

export const PLACES_LIMIT = 10;

export const NEIGHBORHOOD_DEFAULT_LAYOUT = "1LDK" as const;

export type Confidence = "high" | "medium" | "low";

export function lowerConfidence(c: Confidence): Confidence {
  if (c === "high") return "medium";
  if (c === "medium") return "low";
  return "low";
}

export const RENT_PER_SQM_YEN_MIN = 1_000;
export const RENT_PER_SQM_YEN_MAX = 20_000;

export const MANAGEMENT_FEE_YEN_MIN = 0;
export const MANAGEMENT_FEE_YEN_MAX = 50_000;

export const TSUBO_TO_SQM = 3.3058;

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export const TOKYO_23_WARDS_BBOX = {
  south: 35.5,
  west: 139.56,
  north: 35.82,
  east: 139.92,
} as const;
