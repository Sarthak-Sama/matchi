import type { PoolClient } from "pg";

import type { ImportResult } from "./lib/import-run.js";
import { parseFlagValue, runImportCliIfMain } from "./lib/cli.js";
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

  readonly reinsPath?: string;

  readonly reinsSourceDate?: Date;

  readonly rentUnit?: RentUnit;
}

async function loadEstat(localPath: string | undefined): Promise<string> {
  if (!localPath) throw new Error("loadEstat requires a local file");
  const { readFile } = await import("node:fs/promises");
  const raw = (await readFile(localPath)).toString("latin1");

  return decodeEstatCsv(Buffer.from(raw, "latin1"));
}

async function loadWards(client: PoolClient): Promise<WardLookupEntry[]> {
  const { rows } = await client.query<{ ward_code: string; name_ja: string }>(
    `SELECT ward_code, name_ja FROM wards ORDER BY ward_code`,
  );
  return rows.map((r) => ({ wardCode: r.ward_code, nameJa: r.name_ja }));
}

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
      [
        r.wardCode,
        r.period,
        source,
        r.rentPerSqmYen,
        r.managementFeeYen,
        r.sampleCount ?? null,
        sourceUpdatedAt,
      ],
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

function mergeLiveEstatRows(
  rent: Awaited<ReturnType<typeof fetchLiveEstat>>["rent"],
  fee: Awaited<ReturnType<typeof fetchLiveEstat>>["fee"],
): ParsedRentStat[] {
  const feeByWard = new Map(fee.values.map((value) => [value.area, value.value]));
  return rent.values.map((value) => {
    const managementFeeYen = feeByWard.get(value.area) ?? Number.NaN;
    assertRentRanges(value.value, managementFeeYen, `e-Stat API ward ${value.area}`);
    return {
      wardCode: value.area,
      period: "2023",
      source: ESTAT_SOURCE,
      rentPerSqmYen: value.value,
      managementFeeYen,
    };
  });
}

export async function runRentImport(
  client: PoolClient,
  args: ImportRentArgs,
): Promise<RentImportResult> {
  const rentUnit = args.rentUnit ?? DEFAULT_RENT_UNIT;
  console.log(
    `import:rent — rent unit in effect: "${rentUnit}"` +
      (rentUnit === "tsubo" ? " (converting to yen/m² via TSUBO_TO_SQM before validation)" : ""),
  );

  const wards = await loadWards(client);
  expectRowCount(wards.length, { min: 23, max: 23, label: "loaded Tokyo wards" });

  const live =
    args.estatPath === undefined
      ? await fetchLiveEstat(process.env["ESTAT_APP_ID"] ?? "")
      : undefined;
  const estatRows = live
    ? mergeLiveEstatRows(live.rent, live.fee)
    : mapEstatRows(parseEstatCsv(await loadEstat(args.estatPath)), wards, rentUnit);

  const matchedWardCodes = new Set(estatRows.map((r) => r.wardCode));
  expectRowCount(matchedWardCodes.size, {
    min: wards.length,
    max: wards.length,
    label: "distinct wards represented in the e-Stat rent file",
  });

  const estatSourceUpdatedAt = args.estatSourceDate ?? (live ? ESTAT_SOURCE_UPDATED_AT : null);
  const estatRowsImported = await upsertRentStats(
    client,
    ESTAT_SOURCE,
    estatRows,
    estatSourceUpdatedAt,
  );

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

runImportCliIfMain(import.meta.url, {
  commandName: "import:rent",
  commandExample: "pnpm import:rent --file ...",
  parseArgs,
  source: () => RUN_SOURCE,
  run: runRentImport,
});
