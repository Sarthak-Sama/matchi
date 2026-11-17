export interface LifestyleAxisDefinition {
  readonly label: string;

  readonly normColumn: string;

  readonly metricsKey: string;
}

export const LIFESTYLE_AXIS_IDS = [
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

export const LIFESTYLE_AXES = {
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

export type LifestyleAxisMetricsKey = (typeof LIFESTYLE_AXES)[LifestyleAxisId]["metricsKey"];

export const MIN_SELECTED_LIFESTYLE_AXES = 1;

export const MAX_SELECTED_LIFESTYLE_AXES = 5;

export function isValidSelectedAxisCount(count: number): boolean {
  return count >= MIN_SELECTED_LIFESTYLE_AXES && count <= MAX_SELECTED_LIFESTYLE_AXES;
}

export function mapLifestyleAxes<T>(build: (id: LifestyleAxisId) => T): Record<LifestyleAxisId, T> {
  const result = {} as Record<LifestyleAxisId, T>;
  for (const id of LIFESTYLE_AXIS_IDS) {
    result[id] = build(id);
  }
  return result;
}
