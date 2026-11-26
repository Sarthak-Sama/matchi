import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PoolClient } from "pg";

import { LAYOUTS, pickRentStat } from "@tokyo/shared";
import type { LayoutId, RentStatRow } from "@tokyo/shared";

import { DATA_DIR } from "./data-catalog.js";
import { parseFlagValue, runImportCliIfMain } from "./lib/cli.js";
import { parseCsvRecords, parseNumericCell } from "./lib/csv.js";
import type { ImportResult } from "./lib/import-run.js";
import { expectColumns } from "./lib/validate.js";

const RUN_SOURCE = "rent-reference";
const DEFAULT_CSV_PATH = path.join(DATA_DIR, "rent-reference.csv");

const MARKET_FACTOR_MIN = 0.8;
const MARKET_FACTOR_MAX = 1.6;

const REQUIRED_COLUMNS = [
  "ward_code",
  "layout",
  "median_rent_yen",
  "source_note",
  "collected_on",
] as const;

export interface ImportRentReferenceArgs {
  readonly csvPath: string;
}

export interface RentReference {
  readonly wardCode: string;
  readonly layout: LayoutId;
  readonly medianRentYen: number;
  readonly sourceNote: string;
  readonly collectedOn: string;
}

export interface MarketFactor {
  readonly factor: number;
  readonly refs: number;
}

async function readCsv(csvPath: string): Promise<string> {
  try {
    return await readFile(csvPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `import:rent-reference — ${csvPath} does not exist. Collect median asking rents per ward ` +
          `and layout by hand from listing sites into a CSV with the header ` +
          `ward_code,layout,median_rent_yen,source_note,collected_on (or pass --file <path>). ` +
          `Layouts: ${Object.keys(LAYOUTS).join(", ")}.`,
        { cause: err },
      );
    }
    throw err;
  }
}

function isLayoutId(value: string): value is LayoutId {
  return Object.hasOwn(LAYOUTS, value);
}

export function parseRentReferenceCsv(text: string): RentReference[] {
  return parseCsvRecords(text).map((record, index) => {
    const context = `rent reference row ${String(index + 2)}`;
    expectColumns(record, REQUIRED_COLUMNS, context);
    const layout = record["layout"] ?? "";
    if (!isLayoutId(layout)) {
      throw new Error(
        `${context}: layout "${layout}" is not one of ${Object.keys(LAYOUTS).join(", ")}`,
      );
    }
    const medianRentYen = parseNumericCell(record["median_rent_yen"], context) ?? 0;
    if (medianRentYen <= 0) throw new Error(`${context}: median_rent_yen must be positive`);
    const collectedOn = record["collected_on"] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(collectedOn)) {
      throw new Error(`${context}: collected_on "${collectedOn}" is not YYYY-MM-DD`);
    }
    const sourceNote = record["source_note"] ?? "";
    if (sourceNote === "") throw new Error(`${context}: source_note is required`);
    return { wardCode: record["ward_code"] ?? "", layout, medianRentYen, sourceNote, collectedOn };
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clampFactor(factor: number): number {
  return Math.min(MARKET_FACTOR_MAX, Math.max(MARKET_FACTOR_MIN, factor));
}

/**
 * Per ward: median(reference / modelled) over its references, clamped. Wards
 * without references get the median of the fitted wards' factors.
 */
export function fitMarketFactors(
  references: readonly RentReference[],
  modelledRentYen: (wardCode: string, layout: LayoutId) => number,
  wardCodes: readonly string[],
): Map<string, MarketFactor> {
  const ratios = new Map<string, number[]>();
  for (const ref of references) {
    const list = ratios.get(ref.wardCode) ?? [];
    list.push(ref.medianRentYen / modelledRentYen(ref.wardCode, ref.layout));
    ratios.set(ref.wardCode, list);
  }
  const fitted = [...ratios].map(([ward, list]): [string, MarketFactor] => [
    ward,
    { factor: clampFactor(median(list)), refs: list.length },
  ]);
  if (fitted.length === 0) throw new Error("import:rent-reference — no reference rows to fit.");
  const cityWide = median(fitted.map(([, f]) => f.factor));
  const fittedByWard = new Map(fitted);
  return new Map(
    wardCodes.map((ward) => [ward, fittedByWard.get(ward) ?? { factor: cityWide, refs: 0 }]),
  );
}

interface WardRentStat extends RentStatRow {
  readonly ward_code: string;
}

// Modelled ward rent for a layout: the survey rent the derive step starts from,
// before the land-value multiplier and the market factor.
async function loadModelledRent(
  client: PoolClient,
): Promise<(wardCode: string, layout: LayoutId) => number> {
  const { rows } = await client.query<WardRentStat>(
    "SELECT ward_code, period, source, rent_per_sqm_yen, management_fee_yen FROM rent_stats",
  );
  const byWard = new Map<string, WardRentStat[]>();
  for (const row of rows) byWard.set(row.ward_code, [...(byWard.get(row.ward_code) ?? []), row]);
  const currentYear = new Date().getFullYear();
  return (wardCode, layout) => {
    const stats = byWard.get(wardCode);
    if (stats === undefined) {
      throw new Error(
        `import:rent-reference — ward ${wardCode} has no rent_stats row (is the ward code right?)`,
      );
    }
    const { stat } = pickRentStat(stats, { currentYear });
    return stat.rent_per_sqm_yen * LAYOUTS[layout].midSqm + stat.management_fee_yen;
  };
}

async function writeReferences(
  client: PoolClient,
  references: readonly RentReference[],
  modelledRentYen: (wardCode: string, layout: LayoutId) => number,
): Promise<void> {
  await client.query("DELETE FROM rent_reference");
  for (const ref of references) {
    await client.query(
      `INSERT INTO rent_reference
         (ward_code, layout, median_rent_yen, source_note, collected_on, model_rent_yen)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        ref.wardCode,
        ref.layout,
        ref.medianRentYen,
        ref.sourceNote,
        ref.collectedOn,
        modelledRentYen(ref.wardCode, ref.layout),
      ],
    );
  }
}

async function writeFactors(
  client: PoolClient,
  factors: ReadonlyMap<string, MarketFactor>,
): Promise<void> {
  for (const [wardCode, { factor, refs }] of factors) {
    await client.query(
      "UPDATE rent_stats SET market_factor = $2, market_refs = $3 WHERE ward_code = $1",
      [wardCode, factor, refs],
    );
  }
}

export async function runRentReferenceImport(
  client: PoolClient,
  args: ImportRentReferenceArgs,
): Promise<ImportResult> {
  const references = parseRentReferenceCsv(await readCsv(args.csvPath));
  if (references.length === 0) {
    throw new Error(`import:rent-reference — ${args.csvPath} has a header but no rows.`);
  }
  const modelledRentYen = await loadModelledRent(client);
  const { rows: wards } = await client.query<{ ward_code: string }>(
    "SELECT DISTINCT ward_code FROM rent_stats ORDER BY ward_code",
  );
  const factors = fitMarketFactors(
    references,
    modelledRentYen,
    wards.map((w) => w.ward_code),
  );
  await writeReferences(client, references, modelledRentYen);
  await writeFactors(client, factors);

  const withRefs = [...factors.values()].filter((f) => f.refs > 0).length;
  console.log(
    `import:rent-reference — ${String(references.length)} reference(s), ${String(withRefs)} ward(s) fitted, ` +
      `${String(factors.size - withRefs)} on the city-wide factor. Re-run \`pnpm derive --only=localities,rent\`.`,
  );
  return { rowsImported: references.length };
}

export function parseArgs(argv: readonly string[]): ImportRentReferenceArgs {
  return { csvPath: parseFlagValue(argv, "--file") ?? DEFAULT_CSV_PATH };
}

runImportCliIfMain(import.meta.url, {
  commandName: "import:rent-reference",
  commandExample: "pnpm import:rent-reference",
  parseArgs,
  source: () => RUN_SOURCE,
  run: runRentReferenceImport,
});
