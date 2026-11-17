import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

import {
  groupLocalityFeatures,
  localityId,
  readLocalityFeatures,
} from "./import-localities.js";
import { createPool } from "./lib/db.js";

// Fills localities.population, households and area_sqm from the census
// boundary file without re-importing the boundaries, which would cascade
// away every locality-derived row. Run `pnpm derive --only=people` after.
export async function backfillLocalityPeople(
  pool: Pool,
  path = "data/localities.geojson",
): Promise<{ updated: number; unmatched: number }> {
  const grouped = [...groupLocalityFeatures(await readLocalityFeatures(path)).values()];
  const { rowCount } = await pool.query(
    `UPDATE localities l
     SET population = v.population, households = v.households, area_sqm = v.area_sqm
     FROM unnest($1::text[], $2::int[], $3::int[], $4::float8[])
       AS v(locality_id, population, households, area_sqm)
     WHERE v.locality_id = l.locality_id`,
    [
      grouped.map((g) => localityId(g.wardCode, g.nameJa)),
      grouped.map((g) => g.population),
      grouped.map((g) => g.households),
      grouped.map((g) => g.areaSqm),
    ],
  );
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM localities WHERE population IS NULL",
  );
  return { updated: rowCount ?? 0, unmatched: rows[0]?.n ?? 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["DATABASE_URL"])
    throw new Error("DATABASE_URL is required for backfill:locality-people");
  const pool = createPool();
  backfillLocalityPeople(pool, process.argv[2])
    .then(({ updated, unmatched }) =>
      console.log(
        `backfill:locality-people — ${updated} localities updated, ${unmatched} without census counts`,
      ),
    )
    .finally(() => pool.end());
}
