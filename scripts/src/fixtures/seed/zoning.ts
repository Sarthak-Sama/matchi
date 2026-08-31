/**
 * zoning_areas: a mix of residential and non-residential categories,
 * deliberately arranged so residential-zoning share is unambiguously
 * different between two named stations:
 *
 *  - sg-shibuya's 800m catchment sits entirely inside the Z1 commercial
 *    rectangle and touches no residential polygon -> ~0% residential share.
 *  - sg-yoga's 800m catchment sits entirely inside the Z4 Setagaya
 *    residential rectangle and touches no commercial polygon -> ~100%
 *    residential share.
 *
 * (Verified for real post-seed with an ST_Intersects/ST_Area query.)
 */

import type { LonLat } from "./geo.js";

export interface ZoningAreaFixture {
  readonly category: string;
  readonly is_residential: boolean;
  readonly ring: readonly LonLat[];
}

export const ZONING_AREAS: readonly ZoningAreaFixture[] = [
  {
    // Fully covers sg-shibuya's 800m catchment; no residential polygon
    // reaches into this rectangle.
    category: "commercial",
    is_residential: false,
    ring: [
      [139.69, 35.648],
      [139.713, 35.648],
      [139.713, 35.668],
      [139.69, 35.668],
    ],
  },
  {
    category: "commercial",
    is_residential: false,
    ring: [
      [139.688, 35.68],
      [139.712, 35.68],
      [139.712, 35.7],
      [139.688, 35.7],
    ],
  },
  {
    category: "neighborhood_commercial",
    is_residential: false,
    ring: [
      [139.66, 35.702],
      [139.672, 35.702],
      [139.672, 35.71],
      [139.66, 35.71],
    ],
  },
  {
    // Fully covers sg-yoga's 800m catchment; no non-residential polygon
    // reaches into this rectangle.
    category: "category1_low_rise_residential",
    is_residential: true,
    ring: [
      [139.6, 35.595],
      [139.685, 35.595],
      [139.685, 35.67],
      [139.6, 35.67],
    ],
  },
  {
    category: "category1_mid_high_residential",
    is_residential: true,
    ring: [
      [139.66, 35.598],
      [139.722, 35.598],
      [139.722, 35.646],
      [139.66, 35.646],
    ],
  },
  {
    category: "category1_low_rise_residential",
    is_residential: true,
    ring: [
      [139.66, 35.6705],
      [139.689, 35.6705],
      [139.689, 35.6795],
      [139.66, 35.6795],
    ],
  },
];
