import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PoolClient } from "pg";

import { DATA_DIR } from "./data-catalog.js";
import { parseFlagValue, runImportCliIfMain } from "./lib/cli.js";
import { parseCsvRecords, parseNumericCell } from "./lib/csv.js";
import type { ImportResult } from "./lib/import-run.js";
import { expectColumns } from "./lib/validate.js";

const RUN_SOURCE = "commute-reference";
const DEFAULT_CSV_PATH = path.join(DATA_DIR, "commute-reference.csv");

const REQUIRED_COLUMNS = [
  "origin_name_ja",
  "destination_name_ja",
  "arrival_time",
  "reference_minutes",
  "source_note",
  "collected_on",
] as const;

export interface ImportCommuteReferenceArgs {
  readonly csvPath: string;
}

interface CommuteReferenceRow {
  readonly originNameJa: string;
  readonly destinationNameJa: string;
  readonly arrivalTime: string;
  readonly referenceMinutes: number;
  readonly referenceTransfers: number | null;
  readonly lineNote: string | null;
  readonly sourceNote: string;
  readonly collectedOn: string;
}

async function readCsv(csvPath: string): Promise<string> {
  try {
    return await readFile(csvPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `import:commute-reference — ${csvPath} does not exist. Collect journeys by hand into a ` +
          `CSV with the header origin_name_ja,destination_name_ja,arrival_time,reference_minutes,` +
          `reference_transfers,line_note,source_note,collected_on (or pass --file <path>).`,
        { cause: err },
      );
    }
    throw err;
  }
}

export function parseCommuteReferenceCsv(text: string): CommuteReferenceRow[] {
  return parseCsvRecords(text).map((record, index) => {
    const context = `commute reference row ${String(index + 2)}`;
    expectColumns(record, REQUIRED_COLUMNS, context);
    return {
      originNameJa: record["origin_name_ja"] ?? "",
      destinationNameJa: record["destination_name_ja"] ?? "",
      arrivalTime: record["arrival_time"] ?? "",
      referenceMinutes: parseNumericCell(record["reference_minutes"], context) ?? 0,
      referenceTransfers: parseNumericCell(record["reference_transfers"], context) ?? null,
      lineNote: record["line_note"] || null,
      sourceNote: record["source_note"] ?? "",
      collectedOn: record["collected_on"] ?? "",
    };
  });
}

async function upsertReferences(
  client: PoolClient,
  rows: readonly CommuteReferenceRow[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO commute_reference
         (origin_name_ja, destination_name_ja, arrival_time, reference_minutes,
          reference_transfers, line_note, source_note, collected_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (origin_name_ja, destination_name_ja, arrival_time) DO UPDATE SET
         reference_minutes = EXCLUDED.reference_minutes,
         reference_transfers = EXCLUDED.reference_transfers,
         line_note = EXCLUDED.line_note,
         source_note = EXCLUDED.source_note,
         collected_on = EXCLUDED.collected_on`,
      [
        row.originNameJa,
        row.destinationNameJa,
        row.arrivalTime,
        row.referenceMinutes,
        row.referenceTransfers,
        row.lineNote,
        row.sourceNote,
        row.collectedOn,
      ],
    );
  }
}

export async function runCommuteReferenceImport(
  client: PoolClient,
  args: ImportCommuteReferenceArgs,
): Promise<ImportResult> {
  const rows = parseCommuteReferenceCsv(await readCsv(args.csvPath));
  if (rows.length === 0) {
    throw new Error(`import:commute-reference — ${args.csvPath} has a header but no journeys.`);
  }
  await upsertReferences(client, rows);
  return { rowsImported: rows.length };
}

export function parseArgs(argv: readonly string[]): ImportCommuteReferenceArgs {
  return { csvPath: parseFlagValue(argv, "--file") ?? DEFAULT_CSV_PATH };
}

runImportCliIfMain(import.meta.url, {
  commandName: "import:commute-reference",
  commandExample: "pnpm import:commute-reference",
  parseArgs,
  source: () => RUN_SOURCE,
  run: runCommuteReferenceImport,
});
