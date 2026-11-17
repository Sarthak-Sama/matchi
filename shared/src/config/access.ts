export interface AccessHub {
  readonly key: string;
  readonly nameJa: string;
  readonly nameEn: string;
}

// Hubs are matched by station_groups.name_ja, so a hub that spans several
// station groups (Tokyo, Ikebukuro) takes the fastest of them. Editing this
// list changes locality_access.hub_minutes on the next `pnpm derive
// --only=access`; agent.area_features exposes one column per hub and needs a
// migration only when a key is added or removed.
export const ACCESS_HUBS: readonly AccessHub[] = [
  { key: "shinjuku", nameJa: "新宿", nameEn: "Shinjuku" },
  { key: "shibuya", nameJa: "渋谷", nameEn: "Shibuya" },
  { key: "ikebukuro", nameJa: "池袋", nameEn: "Ikebukuro" },
  { key: "tokyo", nameJa: "東京", nameEn: "Tokyo" },
  { key: "shinagawa", nameJa: "品川", nameEn: "Shinagawa" },
  { key: "ueno", nameJa: "上野", nameEn: "Ueno" },
  { key: "otemachi", nameJa: "大手町", nameEn: "Otemachi" },
  { key: "roppongi", nameJa: "六本木", nameEn: "Roppongi" },
];

// station_access.direct_reach_stations and stations_within_30_min both use
// this bound, on peak minutes.
export const DIRECT_REACH_MINUTES = 30;

// Starting value for the reachability decay. The live value is
// model_params.reach_decay_minutes; this seeds it.
export const DEFAULT_REACH_DECAY_MINUTES = 10;
