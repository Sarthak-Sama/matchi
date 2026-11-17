import { createRng, jitterPoint, randChoice, randRange } from "./geo.js";
import type { LonLat } from "./geo.js";
import { STATIONS } from "./stations.js";

export interface LandPriceFixture {
  readonly point: LonLat;
  readonly price_yen_per_sqm: number;
  readonly year: number;
  readonly use_category: string;
  readonly ward_code: string;
}

const WARD_BASE_PRICE: Record<string, number> = {
  "13113": 1_650_000, // Shibuya
  "13104": 1_350_000, // Shinjuku
  "13110": 900_000, // Meguro
  "13112": 620_000, // Setagaya
};

const USE_CATEGORIES = ["residential", "commercial", "residential", "residential"] as const;

const YEAR = 2024;

const rng = createRng(0x1a2b3c);

function priceFor(wardCode: string): number {
  const base = WARD_BASE_PRICE[wardCode] ?? 800_000;
  const factor = randRange(rng, 0.85, 1.15);
  return Math.round(base * factor);
}

const EXCLUDED_FROM_FILLER = new Set(["sg-isolated-test", "sg-toritsudaigaku"]);

const filler: LandPriceFixture[] = STATIONS.filter(
  (s) => !EXCLUDED_FROM_FILLER.has(s.station_group_id),
).flatMap((station) =>
  Array.from({ length: 4 }, (): LandPriceFixture => ({
    point: jitterPoint(station.point, 250, rng),
    price_yen_per_sqm: priceFor(station.ward_code),
    year: YEAR,
    use_category: randChoice(rng, USE_CATEGORIES),
    ward_code: station.ward_code,
  })),
);

const toritsudaigaku = STATIONS.find((s) => s.station_group_id === "sg-toritsudaigaku");
if (!toritsudaigaku) throw new Error("sg-toritsudaigaku fixture missing");

const pinnedSparse: LandPriceFixture[] = [
  {
    point: [toritsudaigaku.point[0] + 0.0003, toritsudaigaku.point[1] + 0.0002],
    price_yen_per_sqm: 875_000,
    year: YEAR,
    use_category: "residential",
    ward_code: "13110",
  },
  {
    point: [toritsudaigaku.point[0] - 0.0004, toritsudaigaku.point[1] - 0.0003],
    price_yen_per_sqm: 910_000,
    year: YEAR,
    use_category: "residential",
    ward_code: "13110",
  },
];

export const LAND_PRICES: readonly LandPriceFixture[] = [...filler, ...pinnedSparse];
