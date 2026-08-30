/**
 * `pnpm import:rent` — imports ward-level rent and management-fee
 * statistics into `rent_stats`, primarily from e-Stat's 2023 Housing and
 * Land Survey, with an optional REINS quarterly overlay.
 *
 *   pnpm import:rent --file data/estat-rent-2023.csv [--rent-unit sqm] \
 *     [--source-date 2023-10-01] \
 *     [--reins data/reins-2026q2.csv] [--reins-source-date 2026-07-01]
 *
 * When `--file` is omitted, this script tries to download from e-Stat —
 * which currently always fails, naming `ESTAT_APP_ID` and a manual
 * download URL, because no verified e-Stat download endpoint/table id
 * could be confirmed without live network access while building this
 * script (see task-12-report.md's "e-Stat format assumptions" section, the
 * same situation Task 11 documented for MLIT). Passing `--file` is the
 * only supported path today. `--reins` has no download path at all — REINS
 * has no public API; a member exports their own quarterly report.
 *
 * e-Stat CSVs are Shift-JIS by default; `import-rent/estat.ts` decodes
 * explicitly with `iconv-lite` (this task's one permitted new dependency —
 * Node has no built-in Shift-JIS `TextDecoder`) and also accepts a UTF-8
 * byte-order-mark. `resolveSource` itself always reads/downloads as
 * `encoding: "latin1"` here specifically so no byte information is lost
 * before this script gets to choose the real decoding — see
 * `lib/source-file.ts`'s updated doc comment.
 *
 * `--rent-unit=sqm|tsubo` (default `sqm`) declares whether BOTH files'
 * rent column is already yen-per-m² or yen-per-tsubo — see
 * `import-rent/rent-unit.ts` and `@tokyo/shared`'s `RENT_PER_SQM_YEN_MIN`/
 * `MAX` doc comment for why this is a caller-declared choice rather than
 * something inferred from the numbers (a per-tsubo figure at realistic
 * Tokyo magnitudes lands inside the same "sane" range a per-m² figure
 * would, so guessing wrong would silently inflate every rent by ~3.3x).
 * The unit in effect is printed prominently at the start of every run.
 *
 * `rent_stats.source` names the data PROVIDER (`'estat'` | `'reins'`), not
 * this ingesting script — Task 6's `pickRentStat` reads that column
 * directly to prefer a recent REINS row over e-Stat. Each provider's rows
 * are upserted by this table's natural key (`ward_code`, `period`,
 * `source`); a ward that disappears from one (source, period) file's
 * matched set is deleted, but ONLY within that exact (source, period) —
 * never across periods, so re-running e-Stat for the current survey year
 * cannot delete a REINS row, and a later REINS quarter cannot delete an
 * earlier quarter's history for the same reason (see `upsertRentStats`).
 * This script's own `import_runs` bookkeeping row uses `source = 'rent'`
 * (the ingesting script's identity), distinct from the provider values
 * written into `rent_stats.source` — see task-12-report.md decision #1.
 *
 * Every dataset is parsed and validated (ward matching, then the sane
 * numeric ranges from `@tokyo/shared`'s `config/scoring.ts`) before any
 * write, following this repo's house pattern: all of it still runs inside
 * `runImport`'s transaction (from `scripts/src/lib/import-run.ts`), so a
 * bad file causes a harmless no-op rollback rather than a partial write.
 * An unmatched ward or an out-of-range value is a hard error naming the
 * offending value — never a silent skip (see `import-rent/ward-match.ts`'s
 * doc comment for why: `rent_stats.ward_code` is a real `NOT NULL` FK that
 * `import:mlit` now checks before dropping a ward).
 */

import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { createPool } from "./lib/db.js";
import type { ImportResult } from "./lib/import-run.js";
import { runImport } from "./lib/import-run.js";
import { expectRowCount } from "./lib/validate.js";
import type { ParsedRentStat } from "./import-rent/estat.js";
import { decodeEstatCsv, ESTAT_SOURCE, mapEstatRows, parseEstatCsv } from "./import-rent/estat.js";
import { ESTAT_SOURCE_UPDATED_AT, fetchLiveEstat } from "./import-rent/estat-api.js";
import type { RentUnit } from "./import-rent/rent-unit.js";
import { DEFAULT_RENT_UNIT } from "./import-rent/rent-unit.js";
import { assertRentRanges } from "./import-rent/validate-ranges.js";
import type { WardLookupEntry } from "./import-rent/ward-match.js";

const RUN_SOURCE = "rent";

export interface ImportRentArgs {
  readonly estatPath?: string;
  readonly estatSourceDate?: Date;
  /** @deprecated REINS is intentionally ignored until a licensed source exists. */
  readonly reinsPath?: string;
  /** @deprecated REINS is intentionally ignored until a licensed source exists. */
  readonly reinsSourceDate?: Date;
  /** Declares the unit BOTH files' rent column is in. Defaults to `"sqm"` when omitted. */
  readonly rentUnit?: RentUnit;
}

async function loadEstat(localPath: string | undefined): Promise<string> {
  if (!localPath) throw new Error("loadEstat requires a local file");
  const { readFile } = await import("node:fs/promises");
  const raw = (await readFile(localPath)).toString("latin1");
  // `raw` is a lossless byte-preserving string (see lib/source-file.ts);
  // recover the exact original bytes before choosing the real decoding.
  return decodeEstatCsv(Buffer.from(raw, "latin1"));
}

async function loadWards(client: PoolClient): Promise<WardLookupEntry[]> {
  const { rows } = await client.query<{ ward_code: string; name_ja: string }>(
    `SELECT ward_code, name_ja FROM wards ORDER BY ward_code`,
  );
  return rows.map((r) => ({ wardCode: r.ward_code, nameJa: r.name_ja }));
}

/**
 * Upserts `rows` (all sharing `source`) by `rent_stats`'s natural key
 * (`ward_code`, `period`, `source`), then deletes any existing row for
 * that exact `(source, period)` pair whose ward isn't in this run's
 * matched set — scoped per period (not blanket per source) so this never
 * touches a different period's history. See this file's module doc
 * comment for why that scoping matters.
 */
async function upsertRentStats(
  client: PoolClient,
  source: string,
  rows: readonly ParsedRentStat[],
  sourceUpdatedAt: Date | null,
): Promise<number> {
  for (const r of rows) {
    await client.query(
      `INSERT INTO rent_stats
         (ward_code, period, source, rent_per_sqm_yen, management_fee_yen, sample_count, source_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ward_code, period, source) DO UPDATE SET
         rent_per_sqm_yen = EXCLUDED.rent_per_sqm_yen,
         management_fee_yen = EXCLUDED.management_fee_yen,
         sample_count = EXCLUDED.sample_count,
         source_updated_at = EXCLUDED.source_updated_at,
         imported_at = now()`,
      [r.wardCode, r.period, source, r.rentPerSqmYen, r.managementFeeYen, r.sampleCount ?? null, sourceUpdatedAt],
    );
  }

  const periods = new Set(rows.map((r) => r.period));
  for (const period of periods) {
    const seenWardCodes = rows.filter((r) => r.period === period).map((r) => r.wardCode);
    await client.query(
      `DELETE FROM rent_stats WHERE source = $1 AND period = $2 AND ward_code <> ALL($3::text[])`,
      [source, period, seenWardCodes],
    );
  }

  return rows.length;
}

export interface RentImportResult extends ImportResult {
  readonly estatRowsImported: number;
  /** @deprecated always zero; retained temporarily for caller compatibility. */
  readonly reinsRowsImported: number;
}

function mergeLiveEstatRows(
  rent: Awaited<ReturnType<typeof fetchLiveEstat>>["rent"],
  fee: Awaited<ReturnType<typeof fetchLiveEstat>>["fee"],
): ParsedRentStat[] {
  const feeByWard = new Map(fee.values.map((value) => [value.area, value.value]));
  return rent.values.map((value) => {
    const managementFeeYen = feeByWard.get(value.area) ?? Number.NaN;
    assertRentRanges(value.value, managementFeeYen, `e-Stat API ward ${value.area}`);
    return { wardCode: value.area, period: "2023", source: ESTAT_SOURCE, rentPerSqmYen: value.value, managementFeeYen };
  });
}

export async function runRentImport(client: PoolClient, args: ImportRentArgs): Promise<RentImportResult> {
  const rentUnit = args.rentUnit ?? DEFAULT_RENT_UNIT;
  console.log(
    `import:rent — rent unit in effect: "${rentUnit}"` +
      (rentUnit === "tsubo" ? " (converting to yen/m² via TSUBO_TO_SQM before validation)" : ""),
  );

  const wards = await loadWards(client);
  expectRowCount(wards.length, { min: 23, max: 23, label: "loaded Tokyo wards" });

  const live = args.estatPath === undefined ? await fetchLiveEstat(process.env["ESTAT_APP_ID"] ?? "") : undefined;
  const estatRows = live
    ? mergeLiveEstatRows(live.rent, live.fee)
    : mapEstatRows(parseEstatCsv(await loadEstat(args.estatPath)), wards, rentUnit);

  // "Every one of the [known] ward codes present" — checked dynamically
  // against whatever `wards` currently holds, rather than a hardcoded 23,
  // so this works both in production (all 23 special wards, once
  // import:mlit has run) and in a partially-seeded environment (e.g. this
  // repo's 4-ward vertical slice).
  const matchedWardCodes = new Set(estatRows.map((r) => r.wardCode));
  expectRowCount(matchedWardCodes.size, {
    min: wards.length,
    max: wards.length,
    label: "distinct wards represented in the e-Stat rent file",
  });

  const estatSourceUpdatedAt = args.estatSourceDate ?? (live ? ESTAT_SOURCE_UPDATED_AT : null);
  const estatRowsImported = await upsertRentStats(client, ESTAT_SOURCE, estatRows, estatSourceUpdatedAt);

  console.log(
    `import:rent — estat=${String(estatRowsImported)} row(s) across ${String(matchedWardCodes.size)} ` +
      `ward(s), source=${live ? "e-Stat API" : "file"}, rent unit: "${rentUnit}"`,
  );

  return {
    rowsImported: estatRowsImported,
    sourceUpdatedAt: estatSourceUpdatedAt ?? undefined,
    estatRowsImported,
    reinsRowsImported: 0,
  };
}

function parseFlagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseRentUnitFlag(argv: readonly string[]): RentUnit | undefined {
  const raw = parseFlagValue(argv, "--rent-unit");
  if (raw === undefined) return undefined;
  if (raw !== "sqm" && raw !== "tsubo") {
    throw new Error(`--rent-unit "${raw}" must be "sqm" or "tsubo"`);
  }
  return raw;
}

function parseDateFlag(argv: readonly string[], flag: string): Date | undefined {
  const raw = parseFlagValue(argv, flag);
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} "${raw}" is not a valid date`);
  }
  return parsed;
}

export function parseArgs(argv: readonly string[]): ImportRentArgs {
  return {
    estatPath: parseFlagValue(argv, "--file"),
    estatSourceDate: parseDateFlag(argv, "--source-date"),
    rentUnit: parseRentUnitFlag(argv),
  };
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error(
      "DATABASE_URL is not set. Set it to a PostgreSQL connection string, e.g.\n" +
        "  DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo pnpm import:rent --file ...",
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const pool = createPool();
  try {
    const result = await runImport({ source: RUN_SOURCE, pool }, (client) => runRentImport(client, args));
    console.log(`import:rent complete. rows_imported=${String(result.rowsImported)}`);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
