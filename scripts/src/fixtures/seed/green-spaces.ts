/**
 * green_spaces: OSM `leisure=park|garden` polygons, used to derive
 * `green_space_share`. A single park, sized to fully cover sg-nakano's
 * 800m catchment, gives derive/normalization.ts's min-max on
 * `green_space_share` real spread: sg-nakano near the max (~1.0, before
 * the `[0, 1]` clamp), every other station at the min (0 — no other green
 * space exists to intersect).
 *
 * sg-nakano ([139.6657, 35.7057] in stations.ts) is chosen deliberately:
 * its nearest neighbor among the other 20 seeded stations is > 3.5km away
 * (sg-hatsudai / sg-shinjuku), far outside both this rectangle and any
 * other station's own 800m catchment — so the overlap this fixture creates
 * is exclusive to sg-nakano and can't leak into a neighboring catchment
 * the way a tighter-packed station would (see pois.ts's sg-daikanyama
 * filler-radius override for the kind of leak this sidesteps).
 *
 * The rectangle's half-width/half-height (~904m / ~891m at this latitude)
 * comfortably exceed the 800m catchment radius on every side, so the
 * circle is fully enclosed regardless of `ST_Buffer`'s polygon
 * approximation of that circle.
 */

import type { LonLat } from "./geo.js";

export interface GreenSpaceFixture {
  readonly name: string | null;
  readonly leisure_class: string;
  readonly ring: readonly LonLat[];
}

export const GREEN_SPACES: readonly GreenSpaceFixture[] = [
  {
    // Fully covers sg-nakano's 800m catchment; every other station's
    // catchment is far enough away to touch none of it.
    name: "Nakano Central Park (fixture)",
    leisure_class: "park",
    ring: [
      [139.6557, 35.6977],
      [139.6757, 35.6977],
      [139.6757, 35.7137],
      [139.6557, 35.7137],
    ],
  },
];
