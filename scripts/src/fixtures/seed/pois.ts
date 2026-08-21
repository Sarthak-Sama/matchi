/**
 * pois: >= 200 points across all 6 required categories, with a deliberate,
 * hand-verifiable contrast in amenity density:
 *
 *  - sg-shibuya: 37 hand-authored POIs within ~450m (dense urban core —
 *    restaurants, cafes, bars, convenience, supermarket, grocery).
 *  - sg-yoga: exactly 5 hand-authored POIs within ~350m (quiet residential
 *    end-of-line station).
 *
 * Both are excluded from the generator loop below, so those exact counts
 * (37 and 5) hold regardless of any filler placement elsewhere — Task 7
 * can hand-verify them directly.
 *
 * The remaining 17 real stations (everything except Shibuya, Yoga, and
 * sg-isolated-test, which stays POI-free) each get 10 generated filler
 * POIs, for 42 + 170 = 212 total.
 */

import { createRng, jitterPoint, randChoice } from "./geo.js";
import type { LonLat } from "./geo.js";
import { STATIONS } from "./stations.js";

export type PoiCategory = "supermarket" | "grocery" | "convenience" | "restaurant" | "cafe" | "bar";

export interface PoiFixture {
  readonly category: PoiCategory;
  readonly name: string | null;
  readonly point: LonLat;
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
  }));
}

// -- sg-shibuya: 37 hand-authored POIs (dense) --------------------------
const shibuyaPois: PoiFixture[] = [
  ...repeat(15, "restaurant", shibuya.point, 450, "Shibuya Restaurant"),
  ...repeat(8, "cafe", shibuya.point, 450, "Shibuya Cafe"),
  ...repeat(6, "bar", shibuya.point, 450, "Shibuya Bar"),
  ...repeat(4, "convenience", shibuya.point, 450, "Shibuya Convenience"),
  ...repeat(2, "supermarket", shibuya.point, 450, "Shibuya Supermarket"),
  ...repeat(2, "grocery", shibuya.point, 450, "Shibuya Grocery"),
];

// -- sg-yoga: exactly 5 hand-authored POIs (quiet) -----------------------
const yogaPois: PoiFixture[] = [
  ...repeat(2, "convenience", yoga.point, 350, "Yoga Convenience"),
  ...repeat(1, "supermarket", yoga.point, 350, "Yoga Supermarket"),
  ...repeat(1, "grocery", yoga.point, 350, "Yoga Grocery"),
  ...repeat(1, "restaurant", yoga.point, 350, "Yoga Restaurant"),
];

const EXCLUDED_FROM_FILLER = new Set(["sg-shibuya", "sg-yoga", "sg-isolated-test"]);

const filler: PoiFixture[] = STATIONS.filter(
  (s) => !EXCLUDED_FROM_FILLER.has(s.station_group_id),
).flatMap((station) =>
  Array.from({ length: 10 }, (): PoiFixture => ({
    category: randChoice(rng, ALL_CATEGORIES),
    name: null,
    point: jitterPoint(station.point, 400, rng),
  })),
);

export const POIS: readonly PoiFixture[] = [...shibuyaPois, ...yogaPois, ...filler];

// Exported for the seed test to hand-verify the two pinned counts.
export const PINNED_POI_COUNTS = {
  "sg-shibuya": shibuyaPois.length,
  "sg-yoga": yogaPois.length,
} as const;
