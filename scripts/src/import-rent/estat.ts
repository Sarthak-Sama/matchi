/**
 * e-Stat 2023 Housing and Land Survey ward-level rent/management-fee
 * parser.
 *
 * FORMAT ASSUMPTIONS (unverifiable without a real download; the user must
 * confirm these against their actual export and adjust the *_KEYS arrays
 * below if they differ):
 *
 *   - Encoding: Shift-JIS (`decodeEstatCsv` below), e-Stat's CSV default.
 *     A UTF-8 byte-order-mark is also accepted (some newer e-Stat exports
 *     offer a UTF-8 download) — detected from the raw bytes before
 *     assuming Shift-JIS.
 *   - One header row, one data row per municipality. Column headers tried,
 *     first match wins (official e-Stat header text first, a friendlier
 *     alias second so hand-built fixtures/overrides work too):
 *       ward code   : "地域コード" | "ward_code"
 *       ward name   : "地域" | "市区町村名" | "name_ja" | "ward_name"
 *       rent/area   : "家賃(1㎡当たり)" | "rent_per_sqm_yen"
 *       mgmt fee    : "共益費・サービス費" | "management_fee_yen" (defaults
 *                     to 0 when the column/cell is absent)
 *       sample count: "標本数" | "sample_count" (optional)
 *   - Numeric cells may be quoted with comma thousands-separators (e.g.
 *     `"4,200"`) — stripped before parsing (see `lib/csv.ts`).
 *   - The rent column's UNIT is a caller-declared choice, not something
 *     this script infers: `import:rent`'s `--rent-unit=sqm|tsubo` flag
 *     (default `sqm`) tells `mapEstatRow`/`mapEstatRows` below whether the
 *     column already holds yen-per-m² or yen-per-tsubo, and a `tsubo`
 *     declaration is converted via `rent-unit.ts`'s `convertToPerSqm`
 *     BEFORE the sane-range check in `validate-ranges.ts` ever runs. This
 *     exists because `RENT_PER_SQM_YEN_MIN`/`MAX` cannot tell a per-m²
 *     figure from a per-tsubo one apart at realistic magnitudes — see
 *     those constants' doc comment in `@tokyo/shared`'s `config/scoring.ts`
 *     for the arithmetic — and per-tsubo is the dominant convention in
 *     Japanese real-estate publishing, so guessing "sqm" silently would be
 *     an easy, undetectable ~3.3x error. Separately, e-Stat's raw Housing
 *     and Land Survey tables often publish average total monthly rent and
 *     average floor area as separate figures rather than a pre-divided
 *     per-unit-area value for most publication tables; if the table the
 *     user downloads is one of those, they must divide rent by floor area
 *     themselves (or pass `--file` a pre-computed CSV) before running this
 *     script regardless of `--rent-unit`.
 *   - Every row's `period` is the fixed literal `"2023"` (the survey year),
 *     not read from any column.
 *
 * A row that cannot be resolved to a known ward (see `ward-match.ts`) or
 * whose numeric values fall outside the sane ranges in
 * `@tokyo/shared`'s `config/scoring.ts` aborts the whole import with a
 * clear, row-specific error — matching this repo's house pattern
 * (validate inside the transaction; a bad file causes a harmless no-op
 * rollback) rather than a silent skip.
 */

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

/**
 * Decodes a raw e-Stat CSV download. Detects a UTF-8 byte-order-mark
 * first (`EF BB BF`) and treats the file as already-UTF-8 when present;
 * otherwise decodes as Shift-JIS (e-Stat's documented default) via
 * `iconv-lite` — Node has no built-in Shift-JIS `TextDecoder`, which is
 * this task's justification for the one permitted new dependency.
 */
export function decodeEstatCsv(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  const decoded: string = iconv.decode(buffer, "Shift_JIS");
  // Defensive: strip a UTF-8 BOM character if one somehow survived (it
  // shouldn't for a genuine Shift-JIS file, but a mislabeled/mixed input
  // could otherwise leave a stray U+FEFF as the first header cell).
  return decoded.replace(/^\uFEFF/, "");
}

export interface RawEstatRow {
  readonly rowIndex: number;
  readonly wardCode?: string;
  readonly wardName?: string;
  /** As read from the source column, in whatever unit `--rent-unit` declares — NOT yet known to be per-m². */
  readonly rentValueRawYen: number;
  readonly managementFeeYen: number;
  readonly sampleCount?: number;
}

/** Parses one already-decoded CSV record (row index is 0-based, over data rows only). */
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

  // Mirrors import-mlit/wards.ts's canonical-object pattern: pick the
  // first matching alias, then let the shared `expectColumns` helper (not
  // a hand-rolled check) produce the "missing required column(s)" error.
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

/** Parses every data row of an already-decoded e-Stat CSV. */
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

/**
 * Resolves `raw`'s ward, converts its rent value to per-m² per `rentUnit`
 * (identity for `"sqm"`, the default), and validates numeric ranges
 * against `@tokyo/shared`'s config bounds, throwing a row-specific error
 * on any failure. Never silently skips a row.
 */
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
