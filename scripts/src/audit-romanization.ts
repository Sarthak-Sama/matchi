/**
 * Read-only audit: which user-visible name columns still hold Japanese text?
 *
 * A value counts as unromanized when it is NULL, blank, or identical to the Japanese
 * name, or when it still contains kana/kanji. Run after a romanization backfill to see
 * what is actually left rather than assuming.
 */

import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

import { createPool } from "./lib/db.js";

const CJK = "[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]";

interface Audit {
  readonly label: string;
  readonly sql: string;
}

const audits: readonly Audit[] = [
  {
    label: "localities.name_en",
    sql: `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE name_en IS NULL OR btrim(name_en) = '' OR name_en = name_ja
                                     OR name_en ~ '${CJK}')::int AS unromanized
            FROM localities`,
  },
  {
    label: "station_groups.name_en",
    sql: `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE name_en IS NULL OR btrim(name_en) = '' OR name_en = name_ja
                                     OR name_en ~ '${CJK}')::int AS unromanized
            FROM station_groups`,
  },
  {
    label: "wards.name_en",
    sql: `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE name_en IS NULL OR btrim(name_en) = '' OR name_en = name_ja
                                     OR name_en ~ '${CJK}')::int AS unromanized
            FROM wards`,
  },
  {
    label: "rail_lines.name_en",
    sql: `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE name_en IS NULL OR btrim(name_en) = '' OR name_en = name_ja
                                     OR name_en ~ '${CJK}')::int AS unromanized
            FROM rail_lines`,
  },
  {
    label: "pois.name_en (destination search)",
    sql: `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE name_en IS NULL OR btrim(name_en) = '' OR name_en = name
                                     OR name_en ~ '${CJK}')::int AS unromanized
            FROM pois`,
  },
];

export async function runAudit(pool: Pool): Promise<void> {
  for (const audit of audits) {
    const { rows } = await pool.query<{ total: number; unromanized: number }>(audit.sql);
    const row = rows[0];
    if (!row) continue;
    const flag = row.unromanized === 0 ? "ok  " : "LEFT";
    console.log(
      `${flag} ${audit.label.padEnd(34)} ${String(row.unromanized).padStart(6)} of ${String(row.total)} still Japanese`,
    );
  }

  const samples = await pool.query<{ name_ja: string; name_en: string | null }>(
    `SELECT name_ja, name_en FROM rail_lines
      WHERE name_en IS NULL OR name_en = name_ja OR name_en ~ '${CJK}'
      ORDER BY name_ja LIMIT 12`,
  );
  if (samples.rows.length > 0) {
    console.log(`\nrail_lines still Japanese (first ${String(samples.rows.length)}):`);
    for (const r of samples.rows) console.log(`  ${r.name_ja} -> ${r.name_en ?? "(null)"}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["DATABASE_URL"]) throw new Error("DATABASE_URL is required for audit");
  const pool = createPool();
  runAudit(pool).finally(() => pool.end());
}
