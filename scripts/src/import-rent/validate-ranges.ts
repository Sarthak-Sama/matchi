import {
  MANAGEMENT_FEE_YEN_MAX,
  MANAGEMENT_FEE_YEN_MIN,
  RENT_PER_SQM_YEN_MAX,
  RENT_PER_SQM_YEN_MIN,
} from "@tokyo/shared";

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
