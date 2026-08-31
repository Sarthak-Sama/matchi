import { TSUBO_TO_SQM } from "@tokyo/shared";

export type RentUnit = "sqm" | "tsubo";

export const DEFAULT_RENT_UNIT: RentUnit = "sqm";

export function convertToPerSqm(value: number, unit: RentUnit): number {
  if (unit === "sqm") return value;
  return Math.round(value / TSUBO_TO_SQM);
}
