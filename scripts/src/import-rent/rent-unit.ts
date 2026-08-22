/**
 * Explicit rent-unit handling for `import:rent`'s `--rent-unit` flag.
 *
 * `rent_stats.rent_per_sqm_yen`'s sane range (`RENT_PER_SQM_YEN_MIN`/`MAX`
 * in `@tokyo/shared`'s `config/scoring.ts`) cannot distinguish a per-m²
 * figure from a per-tsubo one at realistic Tokyo rent magnitudes — see
 * that constant's doc comment for the arithmetic. Rather than guess (or
 * narrow the range, which would reject legitimate premium-ward data), the
 * unit is a caller-declared choice: `--rent-unit=sqm` (the default) passes
 * every parsed rent value through unchanged; `--rent-unit=tsubo` divides
 * by `TSUBO_TO_SQM` to convert a per-tsubo figure to per-m² BEFORE the
 * range check ever runs, so a mislabeled/misconverted source still gets
 * caught by that check rather than silently passing at 3.3x its real
 * value.
 */

import { TSUBO_TO_SQM } from "@tokyo/shared";

export type RentUnit = "sqm" | "tsubo";

export const DEFAULT_RENT_UNIT: RentUnit = "sqm";

/**
 * Converts `value` (as declared by `unit`) to yen per m². `"sqm"` is the
 * identity; `"tsubo"` divides by `TSUBO_TO_SQM` (1 tsubo ≈ 3.3058 m²).
 * Rounded to the nearest yen, matching this codebase's other currency
 * conversions.
 */
export function convertToPerSqm(value: number, unit: RentUnit): number {
  if (unit === "sqm") return value;
  return Math.round(value / TSUBO_TO_SQM);
}
