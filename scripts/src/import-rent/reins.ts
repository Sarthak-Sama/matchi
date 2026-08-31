import { expectColumns } from "../lib/validate.js";
import { parseCsvRecords, parseNumericCell, pickColumn } from "../lib/csv.js";
import type { ParsedRentStat } from "./estat.js";
import type { RentUnit } from "./rent-unit.js";
import { convertToPerSqm, DEFAULT_RENT_UNIT } from "./rent-unit.js";
import { assertRentRanges } from "./validate-ranges.js";
import type { WardLookupEntry } from "./ward-match.js";
import { matchWard } from "./ward-match.js";

export const REINS_SOURCE = "reins";

export const REINS_LICENCE_NOTICE =
  "import:rent — REINS data is licensed to members for internal use only; do not " +
  "redistribute raw REINS records. Make sure the --reins file you passed in was obtained " +
  "under a licence that permits this use.";

const WARD_CODE_KEYS = ["地域コード", "ward_code"];
const WARD_NAME_KEYS = ["地域", "区", "name_ja", "ward_name"];
const PERIOD_KEYS = ["period", "四半期"];
const YEAR_KEYS = ["year", "年"];
const QUARTER_KEYS = ["quarter", "Q", "四半期番号"];
const RENT_PER_SQM_KEYS = ["rent_per_sqm_yen", "家賃(1㎡当たり)"];
const MANAGEMENT_FEE_KEYS = ["management_fee_yen", "共益費・サービス費"];
const SAMPLE_COUNT_KEYS = ["sample_count", "成約件数"];

const PERIOD_PATTERN = /^\d{4}Q[1-4]$/;

export interface RawReinsRow {
  readonly rowIndex: number;
  readonly wardCode?: string;
  readonly wardName?: string;
  readonly period: string;

  readonly rentValueRawYen: number;
  readonly managementFeeYen: number;
  readonly sampleCount?: number;
}

function resolvePeriod(record: Readonly<Record<string, string>>, context: string): string {
  const direct = pickColumn(record, PERIOD_KEYS);
  if (direct !== undefined) {
    if (!PERIOD_PATTERN.test(direct.trim())) {
      throw new Error(
        `${context}: period "${direct}" is not in the expected "YYYYQn" shape (e.g. "2026Q2")`,
      );
    }
    return direct.trim();
  }

  const year = pickColumn(record, YEAR_KEYS);
  const quarter = pickColumn(record, QUARTER_KEYS);
  if (year === undefined || quarter === undefined) {
    throw new Error(
      `${context}: missing required column(s): period (${PERIOD_KEYS.join(" or ")}), or both ` +
        `year (${YEAR_KEYS.join(" or ")}) and quarter (${QUARTER_KEYS.join(" or ")})`,
    );
  }
  const combined = `${year.trim()}Q${quarter.trim()}`;
  if (!PERIOD_PATTERN.test(combined)) {
    throw new Error(
      `${context}: combined year/quarter "${combined}" is not in the expected "YYYYQn" shape`,
    );
  }
  return combined;
}

export function parseReinsRow(
  record: Readonly<Record<string, string>>,
  rowIndex: number,
): RawReinsRow {
  const context = `REINS row #${rowIndex}`;

  const wardCode = pickColumn(record, WARD_CODE_KEYS);
  const wardName = pickColumn(record, WARD_NAME_KEYS);
  if (wardCode === undefined && wardName === undefined) {
    throw new Error(
      `${context}: missing required column(s): ward code (${WARD_CODE_KEYS.join(" or ")}) or ` +
        `ward name (${WARD_NAME_KEYS.join(" or ")})`,
    );
  }

  const period = resolvePeriod(record, context);

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

  return { rowIndex, wardCode, wardName, period, rentValueRawYen, managementFeeYen, sampleCount };
}

export function parseReinsCsv(text: string): RawReinsRow[] {
  const stripped = text.replace(/^\uFEFF/, "");
  return parseCsvRecords(stripped).map((record, index) => parseReinsRow(record, index));
}

export function mapReinsRow(
  raw: RawReinsRow,
  wards: readonly WardLookupEntry[],
  rentUnit: RentUnit = DEFAULT_RENT_UNIT,
): ParsedRentStat {
  const label = raw.wardCode ?? raw.wardName ?? "?";
  const context = `REINS row #${raw.rowIndex} (${label})`;

  const wardCode = matchWard(raw.wardCode, raw.wardName, wards, context);
  const rentPerSqmYen = convertToPerSqm(raw.rentValueRawYen, rentUnit);
  assertRentRanges(rentPerSqmYen, raw.managementFeeYen, context);

  return {
    wardCode,
    period: raw.period,
    source: REINS_SOURCE,
    rentPerSqmYen,
    managementFeeYen: raw.managementFeeYen,
    sampleCount: raw.sampleCount,
  };
}

export function mapReinsRows(
  rows: readonly RawReinsRow[],
  wards: readonly WardLookupEntry[],
  rentUnit: RentUnit = DEFAULT_RENT_UNIT,
): ParsedRentStat[] {
  return rows.map((row) => mapReinsRow(row, wards, rentUnit));
}
