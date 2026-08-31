import { createRng, jitterPoint, randChoice } from "./geo.js";
import type { LonLat } from "./geo.js";
import { STATIONS } from "./stations.js";

export type PoiCategory =
  "supermarket" | "grocery" | "convenience" | "restaurant" | "cafe" | "bar" | "health";

export interface PoiFixture {
  readonly category: PoiCategory;
  readonly name: string | null;
  readonly point: LonLat;

  readonly cuisine: string | null;

  readonly openingHours: string | null;
}

const ALL_CATEGORIES: readonly PoiCategory[] = [
  "supermarket",
  "grocery",
  "convenience",
  "restaurant",
  "cafe",
  "bar",
];

const shibuya = STATIONS.find((s) => s.station_group_id === "sg-shibuya");
const yoga = STATIONS.find((s) => s.station_group_id === "sg-yoga");
if (!shibuya || !yoga) throw new Error("sg-shibuya / sg-yoga fixtures missing");

const rng = createRng(0x51de5);

function near(center: LonLat, maxRadiusM: number): LonLat {
  return jitterPoint(center, maxRadiusM, rng);
}

function repeat(
  n: number,
  category: PoiCategory,
  center: LonLat,
  maxRadiusM: number,
  namePrefix: string,
): PoiFixture[] {
  return Array.from({ length: n }, (_, i) => ({
    category,
    name: `${namePrefix} ${i + 1}`,
    point: near(center, maxRadiusM),
    cuisine: null,
    openingHours: null,
  }));
}

const RESTAURANT_CUISINES: readonly string[] = [
  "ramen",
  "sushi",
  "yakiniku",
  "italian",
  "french",
  "chinese",
  "indian",
  "thai",
];
const RESTAURANT_LATE_NIGHT_HOURS: readonly string[] = ["11:00-23:30", "11:00-23:45"];

const RESTAURANT_OFF_EXAMPLE_INDEX = 9;
const RESTAURANT_OFF_EXAMPLE = "Mo-Su 09:00-22:00; Tu 22:00-23:30 off";

const shibuyaRestaurants: PoiFixture[] = Array.from({ length: 15 }, (_, i) => ({
  category: "restaurant",
  name: `Shibuya Restaurant ${i + 1}`,
  point: near(shibuya.point, 450),
  cuisine: RESTAURANT_CUISINES[i] ?? null,
  openingHours:
    i === RESTAURANT_OFF_EXAMPLE_INDEX
      ? RESTAURANT_OFF_EXAMPLE
      : (RESTAURANT_LATE_NIGHT_HOURS[i] ?? null),
}));

const shibuyaCafes: PoiFixture[] = Array.from({ length: 8 }, (_, i) => ({
  category: "cafe",
  name: `Shibuya Cafe ${i + 1}`,
  point: near(shibuya.point, 450),
  cuisine: i === 0 ? "coffee_shop" : null,
  openingHours: i === 0 ? "24/7" : null,
}));

const BAR_OPENING_HOURS: readonly string[] = ["24/7", "24/7", "Mo-Su 18:00-02:00"];

const shibuyaBars: PoiFixture[] = Array.from({ length: 6 }, (_, i) => ({
  category: "bar",
  name: `Shibuya Bar ${i + 1}`,
  point: near(shibuya.point, 450),
  cuisine: null,
  openingHours: BAR_OPENING_HOURS[i] ?? null,
}));

const shibuyaPois: PoiFixture[] = [
  ...shibuyaRestaurants,
  ...shibuyaCafes,
  ...shibuyaBars,
  ...repeat(4, "convenience", shibuya.point, 450, "Shibuya Convenience"),
  ...repeat(2, "supermarket", shibuya.point, 450, "Shibuya Supermarket"),
  ...repeat(2, "grocery", shibuya.point, 450, "Shibuya Grocery"),
  ...repeat(3, "health", shibuya.point, 450, "Shibuya Health"),
];

const yogaPois: PoiFixture[] = [
  ...repeat(2, "convenience", yoga.point, 350, "Yoga Convenience"),
  ...repeat(1, "supermarket", yoga.point, 350, "Yoga Supermarket"),
  ...repeat(1, "grocery", yoga.point, 350, "Yoga Grocery"),
  ...repeat(1, "restaurant", yoga.point, 350, "Yoga Restaurant"),
];

const EXCLUDED_FROM_FILLER = new Set(["sg-shibuya", "sg-yoga", "sg-isolated-test"]);

const DEFAULT_FILLER_RADIUS_M = 400;

const FILLER_RADIUS_OVERRIDES: Record<string, number> = {
  "sg-daikanyama": 200, // ~1055m from sg-shibuya; 1055 - 200 = 855m > 800m catchment.
};

const filler: PoiFixture[] = STATIONS.filter(
  (s) => !EXCLUDED_FROM_FILLER.has(s.station_group_id),
).flatMap((station) => {
  const radius = FILLER_RADIUS_OVERRIDES[station.station_group_id] ?? DEFAULT_FILLER_RADIUS_M;
  return Array.from({ length: 10 }, (): PoiFixture => ({
    category: randChoice(rng, ALL_CATEGORIES),
    name: null,
    point: jitterPoint(station.point, radius, rng),
    cuisine: null,
    openingHours: null,
  }));
});

export const POIS: readonly PoiFixture[] = [...shibuyaPois, ...yogaPois, ...filler];

export const PINNED_POI_COUNTS = {
  "sg-shibuya": shibuyaPois.length,
  "sg-yoga": yogaPois.length,
} as const;
