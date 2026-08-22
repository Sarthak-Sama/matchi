/**
 * e-Stat 2023 Housing and Land Survey ward-level rent/management-fee
 * parser.
 *
 * FORMAT ASSUMPTIONS (unverifiable without a real download — see
 * task-12-report.md's "e-Stat format assumptions" section, which the user
 * must confirm against their actual export and adjust the *_KEYS arrays
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
 *       rent/m²     : "家賃(1㎡当たり)" | "rent_per_sqm_yen"
 *       mgmt fee    : "共益費・サービス費" | "management_fee_yen" (defaults
 *                     to 0 when the column/cell is absent)
 *       sample count: "標本数" | "sample_count" (optional)
 *   - Numeric cells may be quoted with comma thousands-separators (e.g.
 *     `"4,200"`) — stripped before parsing (see `import-rent/csv.ts`).
 *   - The rent figure is ALREADY expressed as yen per m² in the source
 *     file. This is the single biggest assumption here: e-Stat's raw
 *     Housing and Land Survey tables publish average total monthly rent
 *     and average floor area as separate figures, not a pre-divided
 *     per-m² value, for most publication tables. If the table the user
 *     downloads is one of those, they must divide rent by floor area
 *     themselves (or pass `--file` a pre-computed CSV) before running this
 *     script — flagged prominently in task-12-report.md.
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
import { parseCsvRecords, parseNumericCell, pickColumn } from "./csv.js";
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
  readonly rentPerSqmYen: number;
  readonly managementFeeYen: number;
  readonly sampleCount?: number;
}

/** Parses one already-decoded CSV record (row index is 0-based, over data rows only). */
export function parseEstatRow(record: Readonly<Record<string, string>>, rowIndex: number): RawEstatRow {
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
  const rentPerSqmYen = parseNumericCell(canonical.rent_per_sqm_yen, `${context} rent/m²`);
  if (rentPerSqmYen === undefined) {
    throw new Error(`${context}: rent/m² cell was empty`);
  }

  const managementFeeYen =
    parseNumericCell(pickColumn(record, MANAGEMENT_FEE_KEYS), `${context} management fee`) ?? 0;

  const sampleCountRaw = parseNumericCell(
    pickColumn(record, SAMPLE_COUNT_KEYS),
    `${context} sample count`,
  );
  const sampleCount = sampleCountRaw !== undefined ? Math.round(sampleCountRaw) : undefined;

  return { rowIndex, wardCode, wardName, rentPerSqmYen, managementFeeYen, sampleCount };
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
 * Resolves `raw`'s ward and validates its numeric ranges against
 * `@tokyo/shared`'s config bounds, throwing a row-specific error on either
 * failure. Never silently skips a row.
 */
export function mapEstatRow(raw: RawEstatRow, wards: readonly WardLookupEntry[]): ParsedRentStat {
  const label = raw.wardCode ?? raw.wardName ?? "?";
  const context = `e-Stat row #${raw.rowIndex} (${label})`;

  const wardCode = matchWard(raw.wardCode, raw.wardName, wards, context);
  assertRentRanges(raw.rentPerSqmYen, raw.managementFeeYen, context);

  return {
    wardCode,
    period: ESTAT_PERIOD,
    source: ESTAT_SOURCE,
    rentPerSqmYen: raw.rentPerSqmYen,
    managementFeeYen: raw.managementFeeYen,
    sampleCount: raw.sampleCount,
  };
}

export function mapEstatRows(
  rows: readonly RawEstatRow[],
  wards: readonly WardLookupEntry[],
): ParsedRentStat[] {
  return rows.map((row) => mapEstatRow(row, wards));
}
