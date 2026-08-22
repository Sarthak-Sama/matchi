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
import { resolveSource } from "./lib/source-file.js";
import { expectRowCount } from "./lib/validate.js";
import type { ParsedRentStat } from "./import-rent/estat.js";
import { decodeEstatCsv, ESTAT_SOURCE, mapEstatRows, parseEstatCsv } from "./import-rent/estat.js";
import { mapReinsRows, parseReinsCsv, REINS_LICENCE_NOTICE, REINS_SOURCE } from "./import-rent/reins.js";
import type { RentUnit } from "./import-rent/rent-unit.js";
import { DEFAULT_RENT_UNIT } from "./import-rent/rent-unit.js";
import type { WardLookupEntry } from "./import-rent/ward-match.js";

const RUN_SOURCE = "rent";

const ESTAT_MANUAL_DOWNLOAD_URL =
  "https://www.e-stat.go.jp/ — search for 住宅・土地統計調査 " +
  "(Housing and Land Survey) 2023, drill down to Tokyo-to (東京都), municipality-level " +
  "rent and management-fee figures for the 23 special wards, and pass the saved CSV's path via --file.";

const REINS_MANUAL_DOWNLOAD_URL =
  "REINS has no public download API — a member exports their own quarterly ward-level rent " +
  "report from the REINS portal and passes its path via --reins.";

export interface ImportRentArgs {
  readonly estatPath?: string;
  readonly estatSourceDate?: Date;
  readonly reinsPath?: string;
  readonly reinsSourceDate?: Date;
  /** Declares the unit BOTH files' rent column is in. Defaults to `"sqm"` when omitted. */
  readonly rentUnit?: RentUnit;
}

async function loadEstat(localPath: string | undefined): Promise<string> {
  const raw = await resolveSource({
    label: "e-Stat rent",
    localPath,
    requiredEnvVar: "ESTAT_APP_ID",
    manualDownloadUrl: ESTAT_MANUAL_DOWNLOAD_URL,
    encoding: "latin1",
  });
  // `raw` is a lossless byte-preserving string (see lib/source-file.ts);
  // recover the exact original bytes before choosing the real decoding.
  return decodeEstatCsv(Buffer.from(raw, "latin1"));
}

async function loadReins(localPath: string): Promise<string> {
  return resolveSource({
    label: "REINS rent",
    localPath,
    manualDownloadUrl: REINS_MANUAL_DOWNLOAD_URL,
  });
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
  readonly reinsRowsImported: number;
}

export async function runRentImport(client: PoolClient, args: ImportRentArgs): Promise<RentImportResult> {
  const rentUnit = args.rentUnit ?? DEFAULT_RENT_UNIT;
  console.log(
    `import:rent — rent unit in effect: "${rentUnit}"` +
      (rentUnit === "tsubo" ? " (converting to yen/m² via TSUBO_TO_SQM before validation)" : ""),
  );

  const wards = await loadWards(client);

  const estatText = await loadEstat(args.estatPath);
  const estatRawRows = parseEstatCsv(estatText);
  const estatRows = mapEstatRows(estatRawRows, wards, rentUnit);

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

  const estatSourceUpdatedAt = args.estatSourceDate ?? null;
  const estatRowsImported = await upsertRentStats(client, ESTAT_SOURCE, estatRows, estatSourceUpdatedAt);

  let reinsRowsImported = 0;
  if (args.reinsPath !== undefined) {
    console.log(REINS_LICENCE_NOTICE);
    const reinsText = await loadReins(args.reinsPath);
    const reinsRawRows = parseReinsCsv(reinsText);
    const reinsRows = mapReinsRows(reinsRawRows, wards, rentUnit);
    const reinsSourceUpdatedAt = args.reinsSourceDate ?? null;
    reinsRowsImported = await upsertRentStats(client, REINS_SOURCE, reinsRows, reinsSourceUpdatedAt);
  }

  console.log(
    `import:rent — estat=${String(estatRowsImported)} row(s) across ${String(matchedWardCodes.size)} ` +
      `ward(s), reins=${String(reinsRowsImported)} row(s), rent unit: "${rentUnit}"`,
  );

  return {
    rowsImported: estatRowsImported + reinsRowsImported,
    sourceUpdatedAt: estatSourceUpdatedAt ?? undefined,
    estatRowsImported,
    reinsRowsImported,
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
    reinsPath: parseFlagValue(argv, "--reins"),
    reinsSourceDate: parseDateFlag(argv, "--reins-source-date"),
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
