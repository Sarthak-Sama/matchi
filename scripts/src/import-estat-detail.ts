import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";

import { DATA_DIR } from "./data-catalog.js";
import {
  assertLabels,
  buildRentBands,
  buildSizeCurve,
  parseStatsData,
  PER_TATAMI_BANDS,
  RENT_BANDS,
  SIZE_CLASSES,
} from "./import-estat-detail/parse.js";
import type { RentBandRow, SizeCurveRow } from "./import-estat-detail/parse.js";
import { runImportCliIfMain } from "./lib/cli.js";
import type { ImportResult } from "./lib/import-run.js";

const RUN_SOURCE = "estat-detail";
const ESTAT_DIR = path.join(DATA_DIR, "raw", "estat");
const BANDS_TABLE_ID = "0004021454";
const SIZE_CURVE_TABLE_ID = "0004021502";
const PERIOD = "2023";
const SOURCE_UPDATED_AT = new Date("2025-03-27T00:00:00.000Z");
const PRIVATE_RENTAL = "private_rental";

type JsonRecord = Record<string, unknown>;

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function readCachedTable(tableId: string): Promise<unknown> {
  const names = await readdir(ESTAT_DIR).catch(() => []);
  const name = names.find((n) => n.startsWith(`${tableId}-`) && n.endsWith(".json"));
  if (name === undefined) {
    throw new Error(
      `import:estat-detail: no ${tableId}-*.json in ${ESTAT_DIR}. Fetch the e-Stat table into data/raw/estat first.`,
    );
  }
  return readJson(path.join(ESTAT_DIR, name));
}

// The cached data files carry no class labels; the sibling meta-<id>.json
// (getMetaInfo) does. Returns code -> label for one class, e.g. "cat02".
async function metaLabels(tableId: string, classId: string): Promise<Map<string, string>> {
  const raw = (await readJson(path.join(ESTAT_DIR, `meta-${tableId}.json`))) as JsonRecord;
  const classInf = (raw["GET_META_INFO"] as JsonRecord)["METADATA_INF"] as JsonRecord;
  const objects = ((classInf["CLASS_INF"] as JsonRecord)["CLASS_OBJ"] as JsonRecord[]).filter(
    (o) => o["@id"] === classId,
  );
  const classes = objects[0]?.["CLASS"] as JsonRecord[] | JsonRecord | undefined;
  if (classes === undefined) throw new Error(`meta-${tableId}.json has no class ${classId}`);
  return new Map(
    [classes]
      .flat()
      .map((c) => [String((c as JsonRecord)["@code"]), String((c as JsonRecord)["@name"])]),
  );
}

async function loadRentBands(): Promise<RentBandRow[]> {
  assertLabels(await metaLabels(BANDS_TABLE_ID, "cat02"), RENT_BANDS, `e-Stat ${BANDS_TABLE_ID}`);
  const cells = parseStatsData(await readCachedTable(BANDS_TABLE_ID), BANDS_TABLE_ID);
  return buildRentBands(cells);
}

async function loadSizeCurve(): Promise<SizeCurveRow[]> {
  const context = `e-Stat ${SIZE_CURVE_TABLE_ID}`;
  assertLabels(await metaLabels(SIZE_CURVE_TABLE_ID, "cat02"), SIZE_CLASSES, context);
  assertLabels(await metaLabels(SIZE_CURVE_TABLE_ID, "cat03"), PER_TATAMI_BANDS, context);
  const cells = parseStatsData(await readCachedTable(SIZE_CURVE_TABLE_ID), SIZE_CURVE_TABLE_ID);
  return buildSizeCurve(cells);
}

async function writeRentBands(client: PoolClient, rows: readonly RentBandRow[]): Promise<void> {
  for (const r of rows) {
    await client.query(
      `INSERT INTO rent_bands
         (ward_code, period, band_code, band_low_yen, band_high_yen, dwellings,
          ward_total_dwellings, source, source_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (ward_code, period, band_code) DO UPDATE SET
         band_low_yen = EXCLUDED.band_low_yen, band_high_yen = EXCLUDED.band_high_yen,
         dwellings = EXCLUDED.dwellings, ward_total_dwellings = EXCLUDED.ward_total_dwellings,
         source = EXCLUDED.source, source_updated_at = EXCLUDED.source_updated_at,
         imported_at = now()`,
      [
        r.wardCode,
        PERIOD,
        r.bandCode,
        r.low,
        r.high,
        r.dwellings,
        r.wardTotal,
        `e-Stat ${BANDS_TABLE_ID}`,
        SOURCE_UPDATED_AT,
      ],
    );
  }
}

async function writeSizeCurve(client: PoolClient, rows: readonly SizeCurveRow[]): Promise<void> {
  for (const r of rows) {
    await client.query(
      `INSERT INTO rent_size_curve
         (period, tenure, size_class_code, tatami_min, tatami_max, dwellings,
          median_rent_per_tatami_yen, relative_to_all, source, source_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (period, tenure, size_class_code) DO UPDATE SET
         tatami_min = EXCLUDED.tatami_min, tatami_max = EXCLUDED.tatami_max,
         dwellings = EXCLUDED.dwellings,
         median_rent_per_tatami_yen = EXCLUDED.median_rent_per_tatami_yen,
         relative_to_all = EXCLUDED.relative_to_all, source = EXCLUDED.source,
         source_updated_at = EXCLUDED.source_updated_at, imported_at = now()`,
      [
        PERIOD,
        PRIVATE_RENTAL,
        r.sizeClassCode,
        r.tatamiMin,
        r.tatamiMax,
        r.dwellings,
        r.medianRentPerTatami,
        r.relativeToAll,
        `e-Stat ${SIZE_CURVE_TABLE_ID}`,
        SOURCE_UPDATED_AT,
      ],
    );
  }
}

export async function runEstatDetailImport(client: PoolClient): Promise<ImportResult> {
  const bands = await loadRentBands();
  const curve = await loadSizeCurve();
  await writeRentBands(client, bands);
  await writeSizeCurve(client, curve);
  console.log(
    `import:estat-detail — rent_bands=${String(bands.length)} rent_size_curve=${String(curve.length)}`,
  );
  return { rowsImported: bands.length + curve.length, sourceUpdatedAt: SOURCE_UPDATED_AT };
}

runImportCliIfMain(import.meta.url, {
  commandName: "import:estat-detail",
  commandExample: "pnpm import:estat-detail",
  parseArgs: () => undefined,
  source: () => RUN_SOURCE,
  run: (client) => runEstatDetailImport(client),
});
