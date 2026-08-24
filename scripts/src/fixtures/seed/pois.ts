/**
 * pois: >= 200 points across all 7 required categories, with a deliberate,
 * hand-verifiable contrast in amenity density:
 *
 *  - sg-shibuya: 40 hand-authored POIs within ~450m (dense urban core —
 *    restaurants, cafes, bars, convenience, supermarket, grocery, health).
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
 * filler POIs, for 40 + 5 + 180 = 225 total.
 *
 * --- task-3 additions (cuisine / opening_hours / health) ---
 *
 * Of sg-shibuya's original 37 supermarket/grocery/convenience/restaurant/
 * cafe/bar POIs (unchanged — this is still the total the "hand-verified
 * amenity counts" test in derive.test.ts sums), a deliberate subset of the
 * restaurant/cafe/bar POIs carries a `cuisine` and/or `openingHours` value,
 * plus 3 new `health`-category POIs, giving all three new raw columns real
 * spread against the other 20 stations (which stay at 0 — no filler POI
 * ever gets a category, cuisine, or opening_hours from this set):
 *
 *  - `health_count`: 3 ("Shibuya Health" 1-3) vs. 0 everywhere else.
 *  - `cuisine_variety_count`: 8 distinct cuisines across the first 8
 *    restaurants (`RESTAURANT_CUISINES`) plus 1 more on the first cafe
 *    ("coffee_shop") = 9 distinct cuisine values over restaurant+cafe POIs.
 *  - `late_night_count`: 2 restaurants closing at/after 23:00
 *    (`RESTAURANT_LATE_NIGHT_HOURS`), 2 bars at `24/7`, and 1 cafe at
 *    `24/7` = 5 counted. Two more restaurant/bar fixtures deliberately are
 *    NOT counted, to demonstrate the conservative heuristic in
 *    derive/amenities.ts (`lateNightConditionSql`) declining strings it
 *    can't confidently read: a 3rd bar given `"Mo-Su 18:00-02:00"` (open
 *    past 2am, a cross-midnight range the heuristic doesn't understand),
 *    and restaurant #10 given `RESTAURANT_OFF_EXAMPLE`
 *    (`"Mo-Su 09:00-22:00; Tu 22:00-23:30 off"` — its trailing `off`
 *    modifier marks that segment CLOSED, so counting it would be a false
 *    positive; see that constant's own comment below).
 *
 * See derive.test.ts's "task-3 raw counts" test for the live assertions
 * against these exact numbers.
 */

import { createRng, jitterPoint, randChoice } from "./geo.js";
import type { LonLat } from "./geo.js";
import { STATIONS } from "./stations.js";

export type PoiCategory =
  | "supermarket"
  | "grocery"
  | "convenience"
  | "restaurant"
  | "cafe"
  | "bar"
  | "health";

export interface PoiFixture {
  readonly category: PoiCategory;
  readonly name: string | null;
  readonly point: LonLat;
  /**
   * OSM `cuisine` tag, verbatim; null when absent. Non-null only on a
   * deliberate subset of sg-shibuya's restaurant/cafe fixtures — needed
   * for `cuisine_variety_count`'s `COUNT(DISTINCT cuisine)`.
   */
  readonly cuisine: string | null;
  /**
   * OSM `opening_hours` tag, verbatim; null when absent. Non-null only on
   * a deliberate subset of sg-shibuya's restaurant/cafe/bar fixtures —
   * needed for `late_night_count`'s conservative closing-hour heuristic
   * (see derive/amenities.ts).
   */
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

// -- sg-shibuya: 40 hand-authored POIs (dense) ---------------------------

// 8 of the 15 restaurants carry a distinct `cuisine`; the first 2 of those
// also close late (>= 23:00). Restaurant #10 (index 9) carries a real,
// constructible OSM `off` rule modifier — see RESTAURANT_OFF_EXAMPLE below.
// The remaining restaurants carry neither (same as every filler POI).
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

// A false-positive regression fixture (task-3 fix-up): this superficially
// matches the "-HH:MM closing at/after 23:00" pattern (it contains
// "-23:30"), but the trailing `off` modifier marks that Tuesday segment as
// CLOSED — the venue never actually opens past 22:00. Must NOT contribute
// to `late_night_count`. See derive/amenities.ts's `lateNightConditionSql`
// doc comment and derive/amenities.test.ts for the heuristic-level test of
// this exact string.
const RESTAURANT_OFF_EXAMPLE_INDEX = 9;
const RESTAURANT_OFF_EXAMPLE = "Mo-Su 09:00-22:00; Tu 22:00-23:30 off";

const shibuyaRestaurants: PoiFixture[] = Array.from({ length: 15 }, (_, i) => ({
  category: "restaurant",
  name: `Shibuya Restaurant ${i + 1}`,
  point: near(shibuya.point, 450),
  cuisine: RESTAURANT_CUISINES[i] ?? null,
  openingHours:
    i === RESTAURANT_OFF_EXAMPLE_INDEX ? RESTAURANT_OFF_EXAMPLE : (RESTAURANT_LATE_NIGHT_HOURS[i] ?? null),
}));

// The first of 8 cafes carries a 9th distinct cuisine value and a `24/7`
// closing time; the rest carry neither.
const shibuyaCafes: PoiFixture[] = Array.from({ length: 8 }, (_, i) => ({
  category: "cafe",
  name: `Shibuya Cafe ${i + 1}`,
  point: near(shibuya.point, 450),
  cuisine: i === 0 ? "coffee_shop" : null,
  openingHours: i === 0 ? "24/7" : null,
}));

// Of 6 bars: 2 are genuinely `24/7` (counted), 1 is open past 2am but
// written as a cross-midnight range the conservative heuristic declines to
// parse (NOT counted — see this module's doc comment), the rest carry no
// opening_hours at all.
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
    cuisine: null,
    openingHours: null,
  }));
});

export const POIS: readonly PoiFixture[] = [...shibuyaPois, ...yogaPois, ...filler];

// Exported so the seed test can hand-verify these two pinned counts
// against a live ST_DWithin query — see seed.test.ts.
export const PINNED_POI_COUNTS = {
  "sg-shibuya": shibuyaPois.length,
  "sg-yoga": yogaPois.length,
} as const;
