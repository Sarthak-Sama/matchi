/**
 * land_prices: >= 60 points, with prices that vary meaningfully within and
 * between wards, and a deliberate split for the `MIN_LAND_PRICE_POINTS`
 * fallback:
 *
 *  - sg-isolated-test's 800m catchment gets ZERO points (nothing is ever
 *    placed near it).
 *  - sg-toritsudaigaku gets exactly 2 hand-placed points, tight around its
 *    own center (well inside 800m, and far enough from every neighboring
 *    station's own filler — see distances noted below — that no stray
 *    point from elsewhere lands in its catchment).
 *  - every other of the 18 real stations gets 4 generated points placed
 *    within a 250m jitter of its own center (comfortably inside its own
 *    800m catchment, and comfortably short of every neighboring station's
 *    catchment given real station spacing here is >= ~900m), so each ends
 *    up with >= 3 (actually exactly 4, often a few more from a
 *    neighbor's spillover) points.
 *
 * (Actual per-station counts were verified for real post-seed with an
 * ST_DWithin query — see task-5-report.md.)
 */

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

// Ward base land price (yen/sqm) and spread, chosen so prices vary clearly
// both between wards (Shibuya > Shinjuku > Meguro > Setagaya) and within a
// ward (each point independently jittered +/-15%).
const WARD_BASE_PRICE: Record<string, number> = {
  "13113": 1_650_000, // Shibuya
  "13104": 1_350_000, // Shinjuku
  "13110": 900_000, // Meguro
  "13112": 620_000, // Setagaya
};

const USE_CATEGORIES = ["residential", "commercial", "residential", "residential"] as const;

const YEAR = 2024;

// Deterministic seed -> identical fixture every run (idempotence).
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

// Hand-placed: exactly 2 points, both within ~80m of Toritsu-daigaku's own
// center — well short of the >= 1.4km gap to its nearest neighbors
// (Gakugei-daigaku, Jiyugaoka), so nothing else can land in this catchment.
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
