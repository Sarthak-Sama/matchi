/**
 * Backfills `station_groups.name_en` from the committed station romanization table.
 *
 * The MLIT N02 dataset carries no English station-name column at all, so `import:mlit`
 * falls back to the Japanese name and every station reads as Japanese in the UI. This
 * fills that gap without re-importing: `name_en` is a display field, nothing in scoring
 * or the transit graph reads it, so an UPDATE of one column is sufficient and avoids the
 * cascade a re-import would cause.
 *
 * Fails before writing if any station in the database has no entry in the table, so a
 * half-romanized station list is not possible.
 */

import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

import { createPool } from "./lib/db.js";
import { STATION_ROMANIZATION } from "./import-mlit/station-romanization.js";

export interface StationBackfillResult {
  readonly considered: number;
  readonly updated: number;
  readonly alreadyCorrect: number;
}

export async function backfillStationNames(pool: Pool): Promise<StationBackfillResult> {
  const byJa = new Map(STATION_ROMANIZATION.map((entry) => [entry.ja, entry.en]));

  const { rows } = await pool.query<{ station_group_id: string; name_ja: string }>(
    `SELECT station_group_id, name_ja FROM station_groups ORDER BY station_group_id`,
  );
  if (rows.length === 0) throw new Error("no station groups found — run import:mlit first");

  const missing = [...new Set(rows.filter((r) => !byJa.has(r.name_ja)).map((r) => r.name_ja))];
  if (missing.length > 0) {
    throw new Error(
      `no romanization for ${String(missing.length)} station name(s): ${missing.sort().join(", ")}. ` +
        `Regenerate with pnpm build:station-romanization, or add them to ` +
        `scripts/src/import-mlit/station-romanization-model.json.`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let updated = 0;
    for (const row of rows) {
      const nameEn = byJa.get(row.name_ja);
      // Unreachable: the missing check above already rejected any unmapped name.
      if (nameEn === undefined) throw new Error(`unmapped station ${row.name_ja}`);
      const { rowCount } = await client.query(
        `UPDATE station_groups SET name_en = $2
          WHERE station_group_id = $1 AND name_en IS DISTINCT FROM $2`,
        [row.station_group_id, nameEn],
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
    throw new Error("DATABASE_URL is required for backfill:station-names");
  }
  const pool = createPool();
  backfillStationNames(pool)
    .then((result) =>
      console.log(
        `backfill:station-names — ${String(result.updated)} updated, ` +
          `${String(result.alreadyCorrect)} already correct, ${String(result.considered)} considered`,
      ),
    )
    .finally(() => pool.end());
}
