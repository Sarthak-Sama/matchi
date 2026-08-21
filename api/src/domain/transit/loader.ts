/**
 * The one file in this module that touches the database. Everything else
 * under `domain/transit/` is pure logic tested against a hand-built
 * fixture graph — this file's only job is to turn `rail_edges` rows (joined
 * to `rail_lines` for the line name) into `RailEdgeRow[]` for `buildGraphs`.
 */

import type { DbPool } from "../../db.js";
import type { RailEdgeRow } from "./graph.js";

const LOAD_RAIL_EDGES_SQL = `
  SELECT
    re.from_station_group_id AS "fromStationGroupId",
    re.to_station_group_id AS "toStationGroupId",
    re.rail_line_id AS "railLineId",
    rl.name_en AS "railLineName",
    re.edge_type AS "edgeType",
    re.peak_travel_minutes AS "peakTravelMinutes",
    re.offpeak_travel_minutes AS "offpeakTravelMinutes",
    re.peak_wait_minutes AS "peakWaitMinutes",
    re.offpeak_wait_minutes AS "offpeakWaitMinutes",
    re.confidence AS "confidence"
  FROM rail_edges re
  LEFT JOIN rail_lines rl ON rl.rail_line_id = re.rail_line_id
`;

/** Reads every `rail_edges` row, joined to `rail_lines` for the line name. */
export async function loadRailEdges(pool: DbPool): Promise<RailEdgeRow[]> {
  const result = (await pool.query(LOAD_RAIL_EDGES_SQL)) as { rows: RailEdgeRow[] };
  return result.rows;
}
