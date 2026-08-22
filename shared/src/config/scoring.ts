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

/**
 * Buffer distance (metres) used to compute `road_rail_exposure_share`: the
 * share of a station's catchment within this distance of a major road or
 * rail line. Added in Task 7.
 */
export const ROAD_RAIL_BUFFER_M = 100;

// ---------------------------------------------------------------------------
// Station merging (import scripts)
// ---------------------------------------------------------------------------

/**
 * Two station records within this many metres of each other (after their
 * normalized names match) are collapsed into one `station_group` by the
 * import scripts. Added in Task 11.
 */
export const STATION_MERGE_RADIUS_M = 300;

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

/**
 * `import:transit`'s GTFS mode derives expected wait from half the average
 * observed headway (see that script's `expectedWaitFromHeadway`), clamped
 * to this range. The floor guards against a handful of near-simultaneous
 * observed departures (e.g. two trips minutes apart at a terminal)
 * implying an implausibly short wait; the ceiling guards against a sparse
 * or partial-day GTFS sample (e.g. only late-night departures survived
 * weekday-service filtering) implying an implausibly long one. Added in
 * Task 14.
 */
export const MIN_EXPECTED_WAIT_MINUTES = 1;
export const MAX_EXPECTED_WAIT_MINUTES = 15;

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

/**
 * `scoreAffordability` awards the full 100 when the modeled median rent is
 * at or below this fraction of the monthly budget, 0 when it meets or
 * exceeds the budget, linear in between. Added in Task 9.
 */
export const AFFORDABILITY_FULL_SCORE_RATIO = 0.6;

/**
 * `scoreCommute` awards the full 100 at or below this many minutes, 0 at
 * the request's `maxCommuteMinutes`, linear in between. Added in Task 9.
 */
export const COMMUTE_FULL_SCORE_MINUTES = 15;

/**
 * `buildReasons` (and each `FactorEvidence`'s own `direction`) classifies a
 * factor as a positive reason when its contribution relative to what it
 * could have contributed (`pointContribution / (100 * effectiveWeight)`)
 * is above this. Added in Task 9.
 */
export const REASON_POSITIVE_THRESHOLD = 0.66;

/**
 * The negative-reason counterpart of `REASON_POSITIVE_THRESHOLD`: a factor
 * is classified as a negative reason when that same ratio is below this.
 * Added in Task 9.
 */
export const REASON_NEGATIVE_THRESHOLD = 0.34;

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
// API route defaults (spec-given numeric literals for the /v1 routes)
// ---------------------------------------------------------------------------

/** `POST /v1/optimize` returns at most this many ranked results. */
export const RESULTS_LIMIT = 20;

/** `GET /v1/stations`'s `limit` query param default when omitted. */
export const STATIONS_DEFAULT_LIMIT = 10;

/** `GET /v1/stations`'s `limit` query param is capped (not rejected) at this value. */
export const STATIONS_MAX_LIMIT = 50;

/** `GET /v1/neighborhoods/:id`'s `layout` query param default when omitted. */
export const NEIGHBORHOOD_DEFAULT_LAYOUT = "1LDK" as const;

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

// ---------------------------------------------------------------------------
// Import validation bounds (Task 12's `import:rent`)
// ---------------------------------------------------------------------------

/**
 * A `rent_stats.rent_per_sqm_yen` value outside this range fails the
 * import with a clear error rather than being written.
 *
 * What this range genuinely catches: a raw total-monthly-rent figure
 * mistaken for a per-m² one (real Tokyo studio/1LDK rents run
 * ¥50,000-150,000/month, comfortably above 20,000) and gross parsing
 * mistakes.
 *
 * What it does NOT catch: a per-tsubo figure mistaken for per-m². 1 tsubo
 * ≈ 3.3058 m² (see `TSUBO_TO_SQM` below), so a realistic per-m² rent of
 * ¥2,700-4,300 becomes ¥8,926-14,215 when misread as per-tsubo — still
 * comfortably inside [1,000, 20,000]. Since per-tsubo is the dominant unit
 * in Japanese real-estate publishing, this is a real and silent failure
 * mode, not a hypothetical one: it would inflate every ward's rent by
 * ~3.3x with no error raised anywhere. Narrowing this range cannot fix
 * that — legitimate premium-ward per-m² rents occupy the same band a
 * cheap per-tsubo table would. The only correct fix is for the importer
 * to have the caller declare the unit explicitly rather than guessing;
 * see `import:rent`'s `--rent-unit=sqm|tsubo` flag, which converts a
 * declared tsubo figure via `TSUBO_TO_SQM` before this range is ever
 * checked.
 */
export const RENT_PER_SQM_YEN_MIN = 1_000;
export const RENT_PER_SQM_YEN_MAX = 20_000;

/**
 * A `rent_stats.management_fee_yen` value outside this range fails the
 * import the same way.
 */
export const MANAGEMENT_FEE_YEN_MIN = 0;
export const MANAGEMENT_FEE_YEN_MAX = 50_000;

/**
 * 1 tsubo (坪), the traditional Japanese unit of floor area still common
 * in real-estate rent/price publishing, equals this many square metres.
 * Used by `import:rent`'s `--rent-unit=tsubo` to convert a declared
 * per-tsubo rent figure to per-m² before it is validated against
 * `RENT_PER_SQM_YEN_MIN`/`MAX` and written to `rent_stats`. See that
 * range's own doc comment above for why this conversion has to be an
 * explicit, user-declared choice rather than something the importer
 * infers from the numbers.
 */
export const TSUBO_TO_SQM = 3.3058;

// ---------------------------------------------------------------------------
// OSM import (Task 13's `import:osm`)
// ---------------------------------------------------------------------------

/**
 * The attribution OpenStreetMap's licence (ODbL) requires whenever data
 * derived from OSM is displayed or otherwise used. `import:osm` prints this
 * on every run (success or failure) — this is a licence obligation, not a
 * nicety, so it must not be gated behind a successful write.
 */
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

/**
 * Bounding box `import:osm --download` queries Overpass with, expressed as
 * `[south, west, north, east]` (Overpass QL's own bbox argument order),
 * approximating the extent of Tokyo's 23 special wards. This is a
 * spec-ish constant, not a physical/measured one: the true ward boundary
 * is the irregular polygon in `wards.geom` (from `import:mlit`), not a
 * rectangle. A rectangular bbox necessarily overshoots the real boundary
 * on every side (pulling in some POIs/roads just outside the 23 wards) —
 * acceptable here because Overpass's own per-element tag filters are the
 * real precision, and a slightly generous bbox costs a few unwanted rows,
 * not incorrect ones. Values: south 35.50, west 139.56, north 35.82, east
 * 139.92 — chosen to comfortably contain every special ward (Ota's
 * southern tip, Nerima/Itabashi's western and northern edges, Edogawa's
 * eastern edge) with margin, not tuned to any specific source.
 */
export const TOKYO_23_WARDS_BBOX = {
  south: 35.5,
  west: 139.56,
  north: 35.82,
  east: 139.92,
} as const;
