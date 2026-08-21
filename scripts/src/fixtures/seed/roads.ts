/**
 * major_roads: a handful of arterial roads passing near some stations and
 * not others, used later to derive road/rail noise exposure.
 */

import type { LonLat } from "./geo.js";

export interface MajorRoadFixture {
  readonly name: string;
  readonly road_class: string;
  readonly line: readonly LonLat[];
}

export const MAJOR_ROADS: readonly MajorRoadFixture[] = [
  {
    // Passes close by Nakameguro / Yutenji / Gakugei-daigaku (Meguro-dori corridor).
    name: "Meguro-dori",
    road_class: "arterial",
    line: [
      [139.699, 35.6435],
      [139.696, 35.641],
      [139.6925, 35.6375],
      [139.686, 35.633],
      [139.681, 35.6215],
    ],
  },
  {
    // Passes close by Shibuya / Shinjuku (Meiji-dori corridor, north-south).
    name: "Meiji-dori",
    road_class: "arterial",
    line: [
      [139.703, 35.66],
      [139.7015, 35.6685],
      [139.7, 35.679],
      [139.699, 35.689],
    ],
  },
  {
    // Runs through Setagaya, close to Sangenjaya / Komazawa-daigaku / Sakura-shinmachi.
    name: "Setagaya-dori",
    road_class: "arterial",
    line: [
      [139.671, 35.6445],
      [139.666, 35.6345],
      [139.6555, 35.6275],
      [139.645, 35.622],
    ],
  },
  {
    // Highway well north, close only to Nakano.
    name: "Kanjo 7-go",
    road_class: "highway",
    line: [
      [139.665, 35.72],
      [139.666, 35.712],
      [139.6665, 35.706],
      [139.667, 35.698],
    ],
  },
];
