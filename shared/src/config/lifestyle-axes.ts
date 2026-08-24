/**
 * The single source of truth for the lifestyle axes: the ordered id tuple,
 * each axis's display label and `neighborhood_metrics` column, and the
 * bounds on how many axes one request may select.
 *
 * Adding an axis means adding one entry to `LIFESTYLE_AXIS_IDS`, one entry
 * to `LIFESTYLE_AXES`, and one entry to the api-local describe satellite
 * (`api/src/domain/lifestyle-axis-describe.ts`). The request contract, both
 * route queries and row types, the scoring loop, and the frontend menu all
 * read this module and follow automatically.
 *
 * `formatRawValue`/`rawColumns` deliberately live in that api-local
 * satellite rather than here: they are typed against `LifestyleMetricsInput`,
 * which belongs to `api`, and `shared` must never import from `api`.
 */

export interface LifestyleAxisDefinition {
  /**
   * Human-readable axis name. Load-bearing: it is the `label` on every
   * `FactorEvidence` this axis produces, and therefore appears verbatim
   * inside `reasonsFor`/`reasonsAgainst` strings.
   */
  readonly label: string;
  /** The 0-100 `norm_*` column `pnpm derive` writes to `neighborhood_metrics`. */
  readonly normColumn: string;
  /**
   * The camelCase field this axis's normalized score carries on
   * `LifestyleMetricsInput` (and, as a SQL alias, on both routes' row
   * types). NOT mechanically derivable from either the id or the column —
   * `supermarkets` reads `norm_amenity_supermarket` as
   * `normAmenitySupermarket` — so it is declared rather than computed.
   */
  readonly metricsKey: string;
}

/**
 * Hand-written tuple rather than `Object.keys(LIFESTYLE_AXES)`, which
 * returns `string[]` and loses every literal type. This order is also the
 * UI menu order and the `factors` order for the lifestyle axes.
 */
export const LIFESTYLE_AXIS_IDS = [
  "floodSafety",
  "supermarkets",
  "restaurants",
  "quietness",
  "konbini",
  "cuisineVariety",
  "greenSpace",
  "lateNight",
  "health",
] as const;

export type LifestyleAxisId = (typeof LIFESTYLE_AXIS_IDS)[number];

/**
 * `as const` keeps the string literals alive so `metricsKey` can be used as
 * a mapped-type key downstream; `satisfies` makes the tuple and the
 * registry enforce each other in both directions (a missing entry and an
 * unknown entry are both compile errors) with zero casts.
 */
export const LIFESTYLE_AXES = {
  floodSafety: {
    label: "Flood safety",
    normColumn: "norm_flood_safety",
    metricsKey: "normFloodSafety",
  },
  supermarkets: {
    label: "Supermarkets",
    normColumn: "norm_amenity_supermarket",
    metricsKey: "normAmenitySupermarket",
  },
  restaurants: {
    label: "Restaurants",
    normColumn: "norm_amenity_restaurant",
    metricsKey: "normAmenityRestaurant",
  },
  quietness: {
    label: "Quietness",
    normColumn: "norm_quietness",
    metricsKey: "normQuietness",
  },
  konbini: {
    label: "Konbini",
    normColumn: "norm_amenity_convenience",
    metricsKey: "normAmenityConvenience",
  },
  cuisineVariety: {
    label: "Cuisine variety",
    normColumn: "norm_amenity_cuisine_variety",
    metricsKey: "normAmenityCuisineVariety",
  },
  greenSpace: {
    label: "Parks & green space",
    normColumn: "norm_green_space",
    metricsKey: "normGreenSpace",
  },
  lateNight: {
    label: "Late-night food (approx.)",
    normColumn: "norm_amenity_late_night",
    metricsKey: "normAmenityLateNight",
  },
  health: {
    label: "Everyday health",
    normColumn: "norm_amenity_health",
    metricsKey: "normAmenityHealth",
  },
} as const satisfies Record<LifestyleAxisId, LifestyleAxisDefinition>;

/** Union of every axis's `metricsKey` — e.g. `"normFloodSafety" | ...`. */
export type LifestyleAxisMetricsKey = (typeof LIFESTYLE_AXES)[LifestyleAxisId]["metricsKey"];

/**
 * A request must rate at least this many lifestyle axes. Zero selected axes
 * has no honest interpretation — lifestyle is 40% of the overall score and
 * there would be nothing to spend it on (see `scoreLifestyle`'s guard).
 */
export const MIN_SELECTED_LIFESTYLE_AXES = 1;

/**
 * And at most this many, so that no single axis's share can be diluted into
 * meaninglessness (and so the UI stays legible). With the original four
 * axes this ceiling was unreachable; now that the registry lists nine, it
 * genuinely binds — a request (or a form defaulting every axis to a value)
 * that rates more than five must be rejected, not silently accepted.
 */
export const MAX_SELECTED_LIFESTYLE_AXES = 5;

/**
 * The rule `optimizationRequestSchema`'s `preferences` refine enforces.
 * Kept as a named predicate so the bounds are testable independently of how
 * many axes happen to exist today.
 */
export function isValidSelectedAxisCount(count: number): boolean {
  return count >= MIN_SELECTED_LIFESTYLE_AXES && count <= MAX_SELECTED_LIFESTYLE_AXES;
}

/**
 * Builds a `Record` keyed by every axis id, in `LIFESTYLE_AXIS_IDS` order.
 * The lone `as` is the unavoidable seam between an empty object literal and
 * the fully-populated record the loop below produces; every caller stays
 * fully typed.
 */
export function mapLifestyleAxes<T>(build: (id: LifestyleAxisId) => T): Record<LifestyleAxisId, T> {
  const result = {} as Record<LifestyleAxisId, T>;
  for (const id of LIFESTYLE_AXIS_IDS) {
    result[id] = build(id);
  }
  return result;
}
