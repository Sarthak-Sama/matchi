import type { LonLat } from "./geo.js";

export interface MajorRoadFixture {
  readonly name: string;
  readonly road_class: string;
  readonly line: readonly LonLat[];
}

export const MAJOR_ROADS: readonly MajorRoadFixture[] = [
  {
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
