/**
 * The 20 station groups of the vertical slice, plus the deliberately
 * disconnected 21st (`sg-isolated-test`). Coordinates are real approximate
 * WGS84 positions for each named station; three were nudged by a few
 * hundred metres (documented inline) purely so the simplified ward
 * rectangles in wards.ts can separate cleanly — each nudge stays inside the
 * station's real neighborhood.
 */

import type { LonLat } from "./geo.js";

export interface StationFixture {
  readonly station_group_id: string;
  readonly name_ja: string;
  readonly name_en: string;
  readonly point: LonLat;
  readonly ward_code: string;
  readonly aliases?: readonly string[];
}

export const STATIONS: readonly StationFixture[] = [
  // ---- Shibuya-ku (13113) ----
  {
    station_group_id: "sg-shibuya",
    name_ja: "渋谷",
    name_en: "Shibuya",
    point: [139.7016, 35.658],
    ward_code: "13113",
    aliases: ["Shibuya Station", "しぶや"],
  },
  // Nudged ~150m north (35.6467 -> 35.6480) for clean separation from the Meguro-ku ward polygon.
  {
    station_group_id: "sg-ebisu",
    name_ja: "恵比寿",
    name_en: "Ebisu",
    point: [139.7101, 35.648],
    ward_code: "13113",
  },
  {
    station_group_id: "sg-daikanyama",
    name_ja: "代官山",
    name_en: "Daikanyama",
    point: [139.7031, 35.6486],
    ward_code: "13113",
  },
  {
    station_group_id: "sg-sasazuka",
    name_ja: "笹塚",
    name_en: "Sasazuka",
    point: [139.6683, 35.6733],
    ward_code: "13113",
  },
  {
    station_group_id: "sg-hatagaya",
    name_ja: "幡ヶ谷",
    name_en: "Hatagaya",
    point: [139.6784, 35.6754],
    ward_code: "13113",
  },
  {
    station_group_id: "sg-hatsudai",
    name_ja: "初台",
    name_en: "Hatsudai",
    point: [139.6873, 35.6788],
    ward_code: "13113",
  },
  // Nudged ~700m south-east (35.6832,139.7021 -> 35.6790,139.7040) for clean separation from the Shinjuku-ku ward polygon.
  {
    station_group_id: "sg-yoyogi",
    name_ja: "代々木",
    name_en: "Yoyogi",
    point: [139.704, 35.679],
    ward_code: "13113",
  },

  // ---- Shinjuku-ku (13104) ----
  {
    station_group_id: "sg-shinjuku",
    name_ja: "新宿",
    name_en: "Shinjuku",
    point: [139.7006, 35.6896],
    ward_code: "13104",
    aliases: ["Shinjuku Station"],
  },
  {
    station_group_id: "sg-nakano",
    name_ja: "中野",
    name_en: "Nakano",
    point: [139.6657, 35.7057],
    ward_code: "13104",
  },

  // ---- Setagaya-ku (13112) ----
  {
    station_group_id: "sg-sangenjaya",
    name_ja: "三軒茶屋",
    name_en: "Sangenjaya",
    point: [139.6706, 35.6437],
    ward_code: "13112",
  },
  {
    station_group_id: "sg-komazawadaigaku",
    name_ja: "駒沢大学",
    name_en: "Komazawa-daigaku",
    point: [139.6656, 35.6338],
    ward_code: "13112",
  },
  {
    station_group_id: "sg-sakurashinmachi",
    name_ja: "桜新町",
    name_en: "Sakura-shinmachi",
    point: [139.6547, 35.6266],
    ward_code: "13112",
  },
  {
    station_group_id: "sg-yoga",
    name_ja: "用賀",
    name_en: "Yoga",
    point: [139.6357, 35.621],
    ward_code: "13112",
  },
  {
    station_group_id: "sg-shimokitazawa",
    name_ja: "下北沢",
    name_en: "Shimokitazawa",
    point: [139.6683, 35.6613],
    ward_code: "13112",
    aliases: ["Shimokita"],
  },

  // ---- Meguro-ku (13110) ----
  // Nudged ~350m south-west (35.6438,139.6989 -> 35.6420,139.6960) for clean separation from the Shibuya-ku ward polygon.
  {
    station_group_id: "sg-nakameguro",
    name_ja: "中目黒",
    name_en: "Nakameguro",
    point: [139.696, 35.642],
    ward_code: "13110",
  },
  {
    station_group_id: "sg-yutenji",
    name_ja: "祐天寺",
    name_en: "Yutenji",
    point: [139.6969, 35.6396],
    ward_code: "13110",
  },
  {
    station_group_id: "sg-gakugeidaigaku",
    name_ja: "学芸大学",
    name_en: "Gakugei-daigaku",
    point: [139.6879, 35.6335],
    ward_code: "13110",
  },
  {
    station_group_id: "sg-toritsudaigaku",
    name_ja: "都立大学",
    name_en: "Toritsu-daigaku",
    point: [139.6835, 35.6209],
    ward_code: "13110",
  },
  {
    station_group_id: "sg-jiyugaoka",
    name_ja: "自由が丘",
    name_en: "Jiyugaoka",
    point: [139.6689, 35.6079],
    ward_code: "13110",
    aliases: ["Jiyugaoka Station"],
  },
  {
    station_group_id: "sg-meguro",
    name_ja: "目黒",
    name_en: "Meguro",
    point: [139.7157, 35.6339],
    ward_code: "13110",
  },

  // ---- Deliberately disconnected fixture (Task 8/9/10 hard filter) ----
  {
    station_group_id: "sg-isolated-test",
    name_ja: "テスト孤立駅",
    name_en: "Isolated Test",
    point: [139.642, 35.612],
    ward_code: "13112",
  },
];

// `station_source_refs`: at least 4 rows mapping an upstream source's own
// station identifier to the deduplicated station_group_id above.
export interface StationSourceRefFixture {
  readonly station_group_id: string;
  readonly source: string;
  readonly source_id: string;
  readonly source_name: string;
}

export const STATION_SOURCE_REFS: readonly StationSourceRefFixture[] = [
  {
    station_group_id: "sg-shibuya",
    source: "odpt",
    source_id: "odpt.Station:JR-East.Yamanote.Shibuya",
    source_name: "渋谷",
  },
  {
    station_group_id: "sg-shibuya",
    source: "odpt",
    source_id: "odpt.Station:TokyoMetro.Ginza.Shibuya",
    source_name: "渋谷",
  },
  {
    station_group_id: "sg-shinjuku",
    source: "odpt",
    source_id: "odpt.Station:JR-East.Yamanote.Shinjuku",
    source_name: "新宿",
  },
  {
    station_group_id: "sg-meguro",
    source: "odpt",
    source_id: "odpt.Station:JR-East.Yamanote.Meguro",
    source_name: "目黒",
  },
  {
    station_group_id: "sg-nakameguro",
    source: "odpt",
    source_id: "odpt.Station:Tokyu.Toyoko.NakaMeguro",
    source_name: "中目黒",
  },
];
