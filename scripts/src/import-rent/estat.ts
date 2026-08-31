import iconv from "iconv-lite";

import { expectColumns } from "../lib/validate.js";
import { parseCsvRecords, parseNumericCell, pickColumn } from "../lib/csv.js";
import type { RentUnit } from "./rent-unit.js";
import { convertToPerSqm, DEFAULT_RENT_UNIT } from "./rent-unit.js";
import { assertRentRanges } from "./validate-ranges.js";
import type { WardLookupEntry } from "./ward-match.js";
import { matchWard } from "./ward-match.js";

export const ESTAT_PERIOD = "2023";
export const ESTAT_SOURCE = "estat";

const WARD_CODE_KEYS = ["地域コード", "ward_code"];
const WARD_NAME_KEYS = ["地域", "市区町村名", "name_ja", "ward_name"];
const RENT_PER_SQM_KEYS = ["家賃(1㎡当たり)", "rent_per_sqm_yen"];
const MANAGEMENT_FEE_KEYS = ["共益費・サービス費", "management_fee_yen"];
const SAMPLE_COUNT_KEYS = ["標本数", "sample_count"];

export function decodeEstatCsv(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  const decoded: string = iconv.decode(buffer, "Shift_JIS");

  return decoded.replace(/^\uFEFF/, "");
}

export interface RawEstatRow {
  readonly rowIndex: number;
  readonly wardCode?: string;
  readonly wardName?: string;

  readonly rentValueRawYen: number;
  readonly managementFeeYen: number;
  readonly sampleCount?: number;
}

export function parseEstatRow(
  record: Readonly<Record<string, string>>,
  rowIndex: number,
): RawEstatRow {
  const context = `e-Stat row #${rowIndex}`;

  const wardCode = pickColumn(record, WARD_CODE_KEYS);
  const wardName = pickColumn(record, WARD_NAME_KEYS);
  if (wardCode === undefined && wardName === undefined) {
    throw new Error(
      `${context}: missing required column(s): ward code (${WARD_CODE_KEYS.join(" or ")}) or ` +
        `ward name (${WARD_NAME_KEYS.join(" or ")})`,
    );
  }

  const canonical = { rent_per_sqm_yen: pickColumn(record, RENT_PER_SQM_KEYS) };
  expectColumns(canonical, ["rent_per_sqm_yen"], context);
  const rentValueRawYen = parseNumericCell(canonical.rent_per_sqm_yen, `${context} rent`);
  if (rentValueRawYen === undefined) {
    throw new Error(`${context}: rent cell was empty`);
  }

  const managementFeeYen =
    parseNumericCell(pickColumn(record, MANAGEMENT_FEE_KEYS), `${context} management fee`) ?? 0;

  const sampleCountRaw = parseNumericCell(
    pickColumn(record, SAMPLE_COUNT_KEYS),
    `${context} sample count`,
  );
  const sampleCount = sampleCountRaw !== undefined ? Math.round(sampleCountRaw) : undefined;

  return { rowIndex, wardCode, wardName, rentValueRawYen, managementFeeYen, sampleCount };
}

export function parseEstatCsv(text: string): RawEstatRow[] {
  return parseCsvRecords(text).map((record, index) => parseEstatRow(record, index));
}

export interface ParsedRentStat {
  readonly wardCode: string;
  readonly period: string;
  readonly source: string;
  readonly rentPerSqmYen: number;
  readonly managementFeeYen: number;
  readonly sampleCount?: number;
}

export function mapEstatRow(
  raw: RawEstatRow,
  wards: readonly WardLookupEntry[],
  rentUnit: RentUnit = DEFAULT_RENT_UNIT,
): ParsedRentStat {
  const label = raw.wardCode ?? raw.wardName ?? "?";
  const context = `e-Stat row #${raw.rowIndex} (${label})`;

  const wardCode = matchWard(raw.wardCode, raw.wardName, wards, context);
  const rentPerSqmYen = convertToPerSqm(raw.rentValueRawYen, rentUnit);
  assertRentRanges(rentPerSqmYen, raw.managementFeeYen, context);

  return {
    wardCode,
    period: ESTAT_PERIOD,
    source: ESTAT_SOURCE,
    rentPerSqmYen,
    managementFeeYen: raw.managementFeeYen,
    sampleCount: raw.sampleCount,
  };
}

export function mapEstatRows(
  rows: readonly RawEstatRow[],
  wards: readonly WardLookupEntry[],
  rentUnit: RentUnit = DEFAULT_RENT_UNIT,
): ParsedRentStat[] {
  return rows.map((row) => mapEstatRow(row, wards, rentUnit));
}
