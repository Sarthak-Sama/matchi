import type { LonLat } from "./geo.js";

export interface GreenSpaceFixture {
  readonly name: string | null;
  readonly leisure_class: string;
  readonly ring: readonly LonLat[];
}

export const GREEN_SPACES: readonly GreenSpaceFixture[] = [
  {
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
