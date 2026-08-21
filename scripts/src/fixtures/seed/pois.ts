/**
 * pois: >= 200 points across all 6 required categories, with a deliberate,
 * hand-verifiable contrast in amenity density:
 *
 *  - sg-shibuya: 37 hand-authored POIs within ~450m (dense urban core —
 *    restaurants, cafes, bars, convenience, supermarket, grocery).
 *  - sg-yoga: exactly 5 hand-authored POIs within ~350m (quiet residential
 *    end-of-line station).
 *
 * Both are excluded from the generator loop below, so no *generated*
 * point can be centered inside either one's catchment. But exclusion alone
 * isn't enough to guarantee isolation for sg-shibuya: sg-daikanyama's own
 * center is only ~1055m away (real Tokyo geography — Daikanyama and
 * Shibuya are one Toyoko-line stop apart), and the default filler jitter
 * radius is 400m, so a Daikanyama filler point could land as close as
 * 1055 - 400 = 655m from Shibuya's center — inside its 800m catchment.
 * (This was caught for real: a first version of this fixture had exactly
 * one such point, giving sg-shibuya a live ST_DWithin count of 38, not the
 * documented 37 — see task-5-report.md's fix-up entry.)
 *
 * Fix: sg-daikanyama gets a tighter, station-specific filler radius of
 * 200m (`FILLER_RADIUS_OVERRIDES` below) instead of the 400m default, so
 * its worst-case point is 1055 - 200 = 855m from Shibuya's center — 55m
 * outside the 800m catchment. Every other filler-eligible station is
 * >= 1352m from sg-shibuya and >= 1826m from sg-yoga (computed the same
 * way), comfortably clear of both pinned catchments even at the full
 * 400m jitter, so no other override is needed.
 *
 * `PINNED_POI_COUNTS` below is asserted against a live `ST_DWithin` query
 * in `seed.test.ts` ("pinned POI counts match a live ST_DWithin count"),
 * so any future fixture edit that reintroduces a leak fails a real test
 * instead of silently drifting.
 *
 * The remaining 18 real stations (everything except sg-shibuya, sg-yoga,
 * and sg-isolated-test, which stays POI-free) each get 10 generated
 * filler POIs, for 42 + 180 = 222 total.
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

const DEFAULT_FILLER_RADIUS_M = 400;

// Station-specific filler jitter radius overrides, needed only where a
// filler-eligible station sits close enough to a pinned station
// (sg-shibuya / sg-yoga) that the default 400m radius could place a point
// inside the pinned station's 800m catchment. See the module doc comment
// for the distance math backing the sg-daikanyama value.
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
  }));
});

export const POIS: readonly PoiFixture[] = [...shibuyaPois, ...yogaPois, ...filler];

// Exported so the seed test can hand-verify these two pinned counts
// against a live ST_DWithin query — see seed.test.ts.
export const PINNED_POI_COUNTS = {
  "sg-shibuya": shibuyaPois.length,
  "sg-yoga": yogaPois.length,
} as const;
