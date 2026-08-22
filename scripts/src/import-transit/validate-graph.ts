/**
 * Final sanity check on the whole `rail_edges` graph (not just this run's
 * own rows — a station reachable only via a DIFFERENT source's edges is
 * still connected), run once at the end of `import:transit` regardless of
 * which mode produced this run's edges.
 *
 * Aborts (throwing, so `runImport` rolls the whole transaction back) if:
 *   - the total edge count is below `minEdges`, or
 *   - more than 10% of `station_groups` rows have no edge touching them
 *     at all (neither `from_station_group_id` nor `to_station_group_id`
 *     in any `rail_edges` row) — naming which ones.
 */

import type { PoolClient } from "pg";

const ORPHAN_SHARE_MAX = 0.1;

export interface GraphValidationSummary {
  readonly totalStationGroups: number;
  readonly totalEdges: number;
  readonly orphanStationGroupIds: readonly string[];
}

export async function validateGraph(
  client: PoolClient,
  options: { readonly minEdges: number },
): Promise<GraphValidationSummary> {
  const { rows: edgeCountRows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM rail_edges`,
  );
  const totalEdges = Number(edgeCountRows[0]?.count ?? "0");

  const { rows: totalRows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM station_groups`,
  );
  const totalStationGroups = Number(totalRows[0]?.count ?? "0");

  const { rows: orphanRows } = await client.query<{ station_group_id: string }>(
    `SELECT sg.station_group_id
     FROM station_groups sg
     WHERE NOT EXISTS (
       SELECT 1 FROM rail_edges re
       WHERE re.from_station_group_id = sg.station_group_id
          OR re.to_station_group_id = sg.station_group_id
     )
     ORDER BY sg.station_group_id`,
  );
  const orphanStationGroupIds = orphanRows.map((r) => r.station_group_id);

  if (totalEdges < options.minEdges) {
    throw new Error(
      `import:transit — the resulting rail_edges graph has only ${String(totalEdges)} edge(s), ` +
        `below the configured minimum of ${String(options.minEdges)}. Aborting rather than write ` +
        `a graph too sparse for the commute engine to be useful.`,
    );
  }

  const orphanShare = totalStationGroups > 0 ? orphanStationGroupIds.length / totalStationGroups : 0;
  if (orphanShare > ORPHAN_SHARE_MAX) {
    throw new Error(
      `import:transit — ${String(orphanStationGroupIds.length)} of ${String(totalStationGroups)} ` +
        `station_groups (${(orphanShare * 100).toFixed(1)}%) have no rail_edges at all, above the ` +
        `${String(ORPHAN_SHARE_MAX * 100)}% limit: ${orphanStationGroupIds.join(", ")}`,
    );
  }

  return { totalStationGroups, totalEdges, orphanStationGroupIds };
}
