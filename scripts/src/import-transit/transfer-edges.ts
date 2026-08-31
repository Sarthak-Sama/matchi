import { STATION_MERGE_RADIUS_M } from "@tokyo/shared";
import type { PoolClient } from "pg";

export interface TransferEdgePair {
  readonly fromStationGroupId: string;
  readonly toStationGroupId: string;
}

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
