/**
 * Optional REINS (Real Estate Information Network System) quarterly
 * ward-level rent table parser. Only invoked when `--reins <file>` is
 * passed to `import:rent`.
 *
 * FORMAT ASSUMPTIONS (unverifiable without a real REINS export — see
 * task-12-report.md; adjust the *_KEYS arrays below if a real export
 * differs):
 *
 *   - Encoding: UTF-8 (a plain byte-order-mark is stripped if present).
 *     Unlike e-Stat, REINS member exports are commonly already saved as
 *     UTF-8 CSV/Excel by the agent producing them; this script does NOT
 *     apply the Shift-JIS decode e-Stat needs. If a real REINS export
 *     turns out to be Shift-JIS too, re-decode with `iconv-lite` the same
 *     way `import-rent/estat.ts` does before calling `parseReinsCsv`.
 *   - One header row, one data row per ward. Column headers tried, first
 *     match wins:
 *       ward code    : "地域コード" | "ward_code"
 *       ward name    : "地域" | "区" | "name_ja" | "ward_name"
 *       period       : "period" | "四半期" — accepted directly in the
 *                      `YYYYQn` shape this script writes to the database
 *                      (e.g. "2026Q2"); OR, split across "year" | "年" and
 *                      "quarter" | "Q" | "四半期番号" columns, combined
 *                      into `${year}Q${quarter}`.
 *       rent/area    : "rent_per_sqm_yen" | "家賃(1㎡当たり)"
 *       mgmt fee     : "management_fee_yen" | "共益費・サービス費"
 *                      (defaults to 0 when absent)
 *       sample count : "sample_count" | "成約件数" (optional)
 *   - `rent_stats.source` is the fixed literal `"reins"` for every row.
 *   - Same caller-declared unit as e-Stat: `import:rent`'s
 *     `--rent-unit=sqm|tsubo` flag applies uniformly to both files in one
 *     run (see `import-rent/estat.ts`'s doc comment for why this can't be
 *     inferred from the numbers). REINS listings commonly quote per-tsubo
 *     rents too, so this matters here just as much as for e-Stat.
 *
 * REINS data is licensed for members' internal use; `import-rent.ts`'s
 * `runRentImport` prints `REINS_LICENCE_NOTICE` every time this path runs
 * — it is on the caller to have the rights to whatever file they pass in.
 */

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
  /** As read from the source column, in whatever unit `--rent-unit` declares — NOT yet known to be per-m². */
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

export function parseReinsRow(record: Readonly<Record<string, string>>, rowIndex: number): RawReinsRow {
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

/** Strips a leading UTF-8 BOM character, if present, then parses every data row. */
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
