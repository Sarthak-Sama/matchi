/**
 * Shared numeric-range validation for both `estat.ts` and `reins.ts` — the
 * brief's "sane range" bounds live once in `@tokyo/shared`'s
 * `config/scoring.ts` (never re-typed here) and this is the one place that
 * checks a parsed row against them.
 */

import {
  MANAGEMENT_FEE_YEN_MAX,
  MANAGEMENT_FEE_YEN_MIN,
  RENT_PER_SQM_YEN_MAX,
  RENT_PER_SQM_YEN_MIN,
} from "@tokyo/shared";

/** Throws a row-specific error when either value falls outside its configured sane range. */
export function assertRentRanges(
  rentPerSqmYen: number,
  managementFeeYen: number,
  context: string,
): void {
  if (rentPerSqmYen < RENT_PER_SQM_YEN_MIN || rentPerSqmYen > RENT_PER_SQM_YEN_MAX) {
    throw new Error(
      `${context}: rent_per_sqm_yen ${String(rentPerSqmYen)} is outside the sane range ` +
        `[${String(RENT_PER_SQM_YEN_MIN)}, ${String(RENT_PER_SQM_YEN_MAX)}]`,
    );
  }
  if (managementFeeYen < MANAGEMENT_FEE_YEN_MIN || managementFeeYen > MANAGEMENT_FEE_YEN_MAX) {
    throw new Error(
      `${context}: management_fee_yen ${String(managementFeeYen)} is outside the sane range ` +
        `[${String(MANAGEMENT_FEE_YEN_MIN)}, ${String(MANAGEMENT_FEE_YEN_MAX)}]`,
    );
  }
}
