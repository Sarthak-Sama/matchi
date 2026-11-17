import type { Pool } from "pg";

export async function assertCatchmentsDerived(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ missing: string }>(`
    SELECT count(*)::text AS missing
    FROM station_groups sg
    LEFT JOIN station_areas sa ON sa.station_group_id = sg.station_group_id
    WHERE sa.station_group_id IS NULL
  `);
  const missing = Number(rows[0]?.missing ?? "0");
  if (missing > 0) {
    throw new Error(
      `derive: ${missing} station(s) have no station_areas row. Run the catchments step ` +
        `first (\`pnpm derive --only=catchments\` or a full \`pnpm derive\`).`,
    );
  }
}

export async function assertColumnsPopulated(
  pool: Pool,
  columns: readonly string[],
  requiredByStep: string,
  fixHint: string,
): Promise<void> {
  const predicate = columns.map((c) => `${c} IS NULL`).join(" OR ");
  const { rows } = await pool.query<{ missing: string }>(`
    SELECT count(*)::text AS missing
    FROM neighborhood_metrics
    WHERE ${predicate}
  `);
  const missing = Number(rows[0]?.missing ?? "0");
  if (missing > 0) {
    throw new Error(
      `derive: ${missing} station(s) are missing one of [${columns.join(", ")}], required by ` +
        `the "${requiredByStep}" step. Run ${fixHint} first (or a full \`pnpm derive\`).`,
    );
  }
}

const RENT_SKIP_CONDITION_SQL = `
  sg.ward_code IS NULL
  OR NOT EXISTS (SELECT 1 FROM rent_stats rs WHERE rs.ward_code = sg.ward_code)
`;

export async function assertRentSourcePopulatedForRankableStations(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ missing: string }>(`
    SELECT count(*)::text AS missing
    FROM neighborhood_metrics nm
    JOIN station_groups sg ON sg.station_group_id = nm.station_group_id
    WHERE nm.rent_source IS NULL
      AND NOT (${RENT_SKIP_CONDITION_SQL})
  `);
  const missing = Number(rows[0]?.missing ?? "0");
  if (missing > 0) {
    throw new Error(
      `derive: ${missing} station(s) have a ward assignment and ward rent data available but no ` +
        `rent_source — the rent step has not written them yet. Run the rent step first ` +
        `(\`pnpm derive --only=rent\` or a full \`pnpm derive\`).`,
    );
  }
}
