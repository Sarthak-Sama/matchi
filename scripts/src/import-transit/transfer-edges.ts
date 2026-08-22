/**
 * Transfer-edge generation, shared by both GTFS and `--from-topology`
 * mode (the task brief describes this as one common final step, not
 * per-mode logic).
 *
 * For every pair of DIFFERENT `station_groups` whose points are within
 * `STATION_MERGE_RADIUS_M`, writes a `transfer` edge in EACH direction:
 * `travel_minutes = 0` and `rail_line_id = NULL` — `TRANSFER_PENALTY_MINUTES`
 * is applied by the router (`api/src/domain/transit/dijkstra.ts`'s
 * `relax`), unconditionally, for every `transfer`-type edge it walks,
 * regardless of what that edge's own `travel_minutes` says. Storing the
 * penalty here too would double-apply it.
 *
 * Scope note: this recomputes the FULL cross-group transfer-edge set from
 * the CURRENT `station_groups` table every run (a physical-proximity fact
 * that should always reflect the latest station positions, regardless of
 * which import mode/run last touched it) — so both the delete-stale and
 * the upsert below deliberately match `edge_type = 'transfer' AND
 * from_station_group_id <> to_station_group_id`, NEVER touching the
 * same-station-group self-loop `transfer` rows the seed fixture and a
 * future GTFS-derived same-station interchange might also write (those
 * represent a different concept — a same-group platform change — and are
 * out of this function's scope).
 */

import { STATION_MERGE_RADIUS_M } from "@tokyo/shared";
import type { PoolClient } from "pg";

export interface TransferEdgePair {
  readonly fromStationGroupId: string;
  readonly toStationGroupId: string;
}

/** Every ordered pair of distinct `station_groups` within `STATION_MERGE_RADIUS_M` of each other. */
async function findTransferPairs(client: PoolClient): Promise<TransferEdgePair[]> {
  const { rows } = await client.query<{ from_id: string; to_id: string }>(
    `SELECT a.station_group_id AS from_id, b.station_group_id AS to_id
     FROM station_groups a
     JOIN station_groups b
       ON a.station_group_id <> b.station_group_id
      AND ST_DWithin(a.point::geography, b.point::geography, $1)`,
    [STATION_MERGE_RADIUS_M],
  );
  return rows.map((r) => ({ fromStationGroupId: r.from_id, toStationGroupId: r.to_id }));
}

/**
 * Recomputes the full cross-group transfer-edge set and writes it,
 * deleting any stale cross-group transfer edge no longer within radius.
 * Returns the number of pairs written (each pair is one directed row).
 */
export async function writeTransferEdges(
  client: PoolClient,
  source: string,
  sourceUpdatedAt: Date | null,
): Promise<number> {
  const pairs = await findTransferPairs(client);

  const fromIds = pairs.map((p) => p.fromStationGroupId);
  const toIds = pairs.map((p) => p.toStationGroupId);

  await client.query(
    `DELETE FROM rail_edges
     WHERE edge_type = 'transfer'
       AND from_station_group_id <> to_station_group_id
       AND NOT EXISTS (
         SELECT 1 FROM unnest($1::text[], $2::text[]) AS desired(from_id, to_id)
         WHERE desired.from_id = rail_edges.from_station_group_id
           AND desired.to_id = rail_edges.to_station_group_id
       )`,
    [fromIds, toIds],
  );

  for (const pair of pairs) {
    await client.query(
      `INSERT INTO rail_edges
         (from_station_group_id, to_station_group_id, rail_line_id, edge_type,
          peak_travel_minutes, offpeak_travel_minutes, peak_wait_minutes, offpeak_wait_minutes,
          confidence, source, source_updated_at)
       VALUES ($1, $2, NULL, 'transfer', 0, 0, 0, 0, 'medium', $3, $4)
       ON CONFLICT (from_station_group_id, to_station_group_id, edge_type)
         WHERE rail_line_id IS NULL
       DO UPDATE SET
         confidence = EXCLUDED.confidence,
         source = EXCLUDED.source,
         source_updated_at = EXCLUDED.source_updated_at,
         imported_at = now()`,
      [pair.fromStationGroupId, pair.toStationGroupId, source, sourceUpdatedAt],
    );
  }

  return pairs.length;
}
