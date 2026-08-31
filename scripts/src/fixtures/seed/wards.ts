/**
 * The 4 wards of the vertical slice, as simplified (but valid,
 * non-overlapping) polygons positioned at their real-world location.
 *
 * Each polygon is hand-drawn to comfortably enclose exactly the stations
 * assigned to that ward (see stations.ts) and to leave a real gap — never
 * just a shared edge — from its neighbors. The polygons are rectangles with
 * one or two corners cut off (octagons), which is enough to route around
 * the handful of places where two wards' station clusters interleave in
 * longitude (Setagaya/Meguro) or come close in latitude (Shibuya/Shinjuku).
 * Containment for every station was verified with `ST_Contains` after
 * seeding.
 */

import type { LonLat } from "./geo.js";

export interface WardFixture {
  readonly ward_code: string;
  readonly name_ja: string;
  readonly name_en: string;
  readonly ring: readonly LonLat[];
}

export const WARDS: readonly WardFixture[] = [
  {
    ward_code: "13113",
    name_ja: "渋谷区",
    name_en: "Shibuya",
    // L-shape: a southern lobe (Shibuya/Ebisu/Daikanyama) and a northern
    // lobe (Sasazuka/Hatagaya/Hatsudai/Yoyogi), joined by a waist that stays
    // east of lon 139.676 so it does not reach into Setagaya's Shimokitazawa.
    ring: [
      [139.676, 35.645],
      [139.718, 35.645],
      [139.718, 35.686],
      [139.663, 35.686],
      [139.663, 35.667],
      [139.676, 35.667],
    ],
  },
  {
    ward_code: "13104",
    name_ja: "新宿区",
    name_en: "Shinjuku",
    // Simple rectangle north of Shibuya-ku; also stretched west to cover
    // Nakano (whose real ward, Nakano-ku, is not one of the 4 in this
    // slice — folded into the Shinjuku polygon instead).
    // NOTE: this makes sg-nakano's ward assignment a disclosed fixture
    // fiction, not merely a simplification — the polygon reaches ~3km west
    // of real Shinjuku Station to contain it, so roughly three-quarters of
    // this rectangle's area is real Nakano-ku, not Shinjuku-ku.
    ring: [
      [139.66, 35.688],
      [139.706, 35.688],
      [139.706, 35.71],
      [139.66, 35.71],
    ],
  },
  {
    ward_code: "13112",
    name_ja: "世田谷区",
    name_en: "Setagaya",
    // Rectangle with the SE corner cut off so it doesn't reach into
    // Meguro-ku's Jiyugaoka/Toritsu-daigaku pocket.
    ring: [
      [139.625, 35.6],
      [139.66, 35.6],
      [139.66, 35.622],
      [139.674, 35.622],
      [139.674, 35.665],
      [139.625, 35.665],
    ],
  },
  {
    ward_code: "13110",
    name_ja: "目黒区",
    name_en: "Meguro",
    // Rectangle with the NW corner cut off so it doesn't reach into
    // Setagaya-ku's Sangenjaya/Komazawa-daigaku pocket.
    ring: [
      [139.665, 35.601],
      [139.722, 35.601],
      [139.722, 35.6435],
      [139.68, 35.6435],
      [139.68, 35.617],
      [139.665, 35.617],
    ],
  },
];
