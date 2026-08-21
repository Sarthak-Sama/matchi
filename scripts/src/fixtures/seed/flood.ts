/**
 * flood_zones: 3 polygons with distinct depth_category/depth_rank.
 *
 * Placement is deliberate (real Shibuya sits in a low-lying river valley
 * and does have a known flood-risk history, so this is not even
 * unrealistic):
 *  - FZ1 (shallow, rank 1) and FZ2 (deep, rank 3) both fully cover
 *    sg-shibuya's 800m catchment -> Shibuya overlaps TWO depth categories.
 *  - FZ3 (rank 2) sits close enough to sg-sangenjaya's center to overlap
 *    its catchment, but far enough from every neighboring station
 *    (sg-komazawadaigaku, sg-shimokitazawa) that they stay flood-free.
 *  - sg-yoga, sg-sakurashinmachi, sg-komazawadaigaku, the Meguro-ku
 *    cluster, sg-shinjuku, sg-nakano, and sg-isolated-test overlap none of
 *    the three zones.
 * (Verified for real post-seed with ST_Intersects — see task-5-report.md.)
 */

import type { LonLat } from "./geo.js";

export interface FloodZoneFixture {
  readonly depth_category: string;
  readonly depth_rank: number;
  readonly ring: readonly LonLat[];
}

export const FLOOD_ZONES: readonly FloodZoneFixture[] = [
  {
    depth_category: "0-0.5m",
    depth_rank: 1,
    ring: [
      [139.69, 35.649],
      [139.712, 35.649],
      [139.712, 35.667],
      [139.69, 35.667],
    ],
  },
  {
    depth_category: "1.0-2.0m",
    depth_rank: 3,
    ring: [
      [139.698, 35.654],
      [139.706, 35.654],
      [139.706, 35.662],
      [139.698, 35.662],
    ],
  },
  {
    depth_category: "0.5-1.0m",
    depth_rank: 2,
    ring: [
      [139.672, 35.645],
      [139.677, 35.645],
      [139.677, 35.649],
      [139.672, 35.649],
    ],
  },
];
