/**
 * The single source of truth for every formula constant, threshold, weight,
 * layout size, speed, penalty, and clamp bound used across the Tokyo
 * neighborhood optimizer.
 *
 * No numeric literal from the binding spec may be duplicated anywhere else
 * in the codebase — downstream packages import from this module instead of
 * re-typing a number. Later tasks append their own constants here rather
 * than introducing parallel config modules.
 */

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Rent estimator constants
// ---------------------------------------------------------------------------

/** Applied to layout min m² to derive the low end of a rent estimate. */
export const LOW_ESTIMATE_FACTOR = 0.9;

/** Applied to layout max m² to derive the high end of a rent estimate. */
export const HIGH_ESTIMATE_FACTOR = 1.1;

export const LAND_PRICE_MULTIPLIER_EXPONENT = 0.25;
export const LAND_PRICE_MULTIPLIER_MIN = 0.85;
export const LAND_PRICE_MULTIPLIER_MAX = 1.15;

/**
 * Below this count of land-price data points, the multiplier is exactly
 * `1.0` and confidence drops.
 */
export const MIN_LAND_PRICE_POINTS = 3;

/**
 * A rent stat "vintage" (source period) counts as recent if it is at most
 * this many years older than the current year. Used both to prefer a REINS
 * row over an e-Stat row in `pickRentStat`, and to decide whether
 * `estimateRent` should step confidence down for a stale source period.
 */
export const RENT_STAT_RECENT_MAX_AGE_YEARS = 2;

/**
 * A rent stat older than this many years is considered stale enough for
 * `pickRentStat` to assign `low` confidence.
 */
export const RENT_STAT_OLD_MIN_AGE_YEARS = 5;

// ---------------------------------------------------------------------------
// Catchment
// ---------------------------------------------------------------------------

export const CATCHMENT_RADIUS_M = 800;

export const CATCHMENT_LABEL = "approximate 10-minute station area";

// ---------------------------------------------------------------------------
// Commute constants
// ---------------------------------------------------------------------------

/** Fixed neighborhood-to-station walk. */
export const ACCESS_WALK_MINUTES = 8;

export const TRANSFER_PENALTY_MINUTES = 5;

export const PEAK_WAIT_MINUTES = 4;

export const OFFPEAK_WAIT_MINUTES = 6;

/**
 * The morning peak window, expressed in minutes from midnight.
 *
 * `startMinutes` is INCLUSIVE (07:30 counts as peak), `endMinutes` is
 * EXCLUSIVE (10:00 itself does NOT count as peak). i.e. peak iff
 * `startMinutes <= minutes < endMinutes`.
 */
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

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

/** Must sum to exactly 1 (asserted in tests). */
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

// ---------------------------------------------------------------------------
// Quietness proxy weights
// ---------------------------------------------------------------------------

/** Must sum to exactly 1 (asserted in tests). */
export const QUIETNESS_WEIGHTS = {
  residentialZoningShare: 0.5,
  inverseRoadRailExposure: 0.3,
  inverseNightlifeDensity: 0.2,
} as const;

// ---------------------------------------------------------------------------
// Amenity weights (supermarket-equivalent weighting)
// ---------------------------------------------------------------------------

export const AMENITY_WEIGHTS = {
  supermarket: 1.0,
  grocery: 0.5,
  convenience: 0.25,
} as const;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Load-bearing: every rent value the system produces or displays must carry
 * this label. Strings like "available rent", "listing", or anything
 * implying real inventory must never reach a user.
 */
export const RENT_LABEL = "modeled area rent";

export const COMMUTE_LABEL = "typical weekday estimate";

export const QUIETNESS_LABEL = "quietness proxy";

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";

/** Steps confidence down one notch: high -> medium -> low -> low. */
export function lowerConfidence(c: Confidence): Confidence {
  if (c === "high") return "medium";
  if (c === "medium") return "low";
  return "low";
}
