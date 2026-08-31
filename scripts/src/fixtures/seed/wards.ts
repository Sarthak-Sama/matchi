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
