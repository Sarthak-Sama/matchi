/**
 * Backfills `localities.name_en` from the Japan Post romanized-address archive
 * without touching geometry, samples or metrics.
 *
 * `import:localities` also writes `name_en`, but it does so by deleting and
 * re-inserting every locality, which cascades through `locality_samples`,
 * `locality_sample_stations` and `locality_metrics` and therefore forces a full
 * `derive` re-run. Nothing in the scoring pipeline reads `name_en` — it is a
 * display field — so enriching an already-imported database only needs an
 * UPDATE of one column. This script is that narrow path.
 *
 * It resolves every locality up front and fails before writing anything if any
 * name is missing, ambiguous, or covered by a stale override, so a partial
 * backfill is not possible.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

import { createPool } from "./lib/db.js";
import {
  buildRomanizationIndex,
  parseJapanPostCsv,
  resolveLocalityNames,
} from "./import-localities/romanization.js";

interface LocalityRow {
  readonly locality_id: string;
  readonly ward_code: string;
  readonly name_ja: string;
  readonly ward_name_ja: string | null;
}

export interface BackfillResult {
  readonly considered: number;
  readonly updated: number;
  readonly alreadyCorrect: number;
}

export async function backfillLocalityNames(
  pool: Pool,
  romanizationPath = "data/locality-romanization.csv",
): Promise<BackfillResult> {
  const { rows } = await pool.query<LocalityRow>(
    `SELECT l.locality_id, l.ward_code, l.name_ja, w.name_ja AS ward_name_ja
       FROM localities l
       LEFT JOIN wards w ON w.ward_code = l.ward_code
      ORDER BY l.locality_id`,
  );
  if (rows.length === 0) throw new Error("no localities found — run import:localities first");

  const missingWards = [...new Set(rows.filter((r) => !r.ward_name_ja).map((r) => r.ward_code))];
  if (missingWards.length > 0) {
    throw new Error(
      `wards table has no Japanese name for ward code(s) ${missingWards.sort().join(", ")}; ` +
        `run import:mlit before backfilling locality names`,
    );
  }

  const index = buildRomanizationIndex(parseJapanPostCsv(await readFile(romanizationPath)));
  const { nameEnByKey } = resolveLocalityNames({
    localities: rows.map((r) => ({
      wardCode: r.ward_code,
      wardNameJa: r.ward_name_ja ?? "",
      nameJa: r.name_ja,
    })),
    index,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let updated = 0;
    for (const row of rows) {
      const nameEn = nameEnByKey.get(`${row.ward_code}\u0000${row.name_ja}`);
      // resolveLocalityNames throws on any unresolved locality, so this is unreachable;
      // it exists because noUncheckedIndexedAccess cannot see that guarantee.
      if (nameEn === undefined) throw new Error(`unresolved romanization for ${row.locality_id}`);
      const { rowCount } = await client.query(
        `UPDATE localities SET name_en = $2
          WHERE locality_id = $1 AND name_en IS DISTINCT FROM $2`,
        [row.locality_id, nameEn],
      );
      updated += rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { considered: rows.length, updated, alreadyCorrect: rows.length - updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL is required for backfill:locality-names");
  }
  const source = process.argv[2] ?? "data/locality-romanization.csv";
  const pool = createPool();
  backfillLocalityNames(pool, source)
    .then((result) =>
      console.log(
        `backfill:locality-names — ${result.updated} updated, ` +
          `${result.alreadyCorrect} already correct, ${result.considered} considered`,
      ),
    )
    .finally(() => pool.end());
}
