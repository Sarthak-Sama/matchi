import type { StationSuggestion } from "@tokyo/shared";
import { STATIONS_DEFAULT_LIMIT, STATIONS_MAX_LIMIT, stationsResponseSchema } from "@tokyo/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../app.js";
import { assertDevResponseShape } from "./lib/dev-response-check.js";
import {
  escapeLikeWildcards,
  similarityScoreSql,
  STATION_GROUP_MATCH_COLUMNS,
  textMatchSql,
} from "./lib/text-ranking.js";
import { parseOrThrow } from "./lib/validation.js";

const STATIONS_QUERY_MAX_LENGTH = 100;

const stationsQuerySchema = z
  .object({
    query: z.string().min(1).max(STATIONS_QUERY_MAX_LENGTH),
    limit: z.coerce.number().int().min(1).default(STATIONS_DEFAULT_LIMIT),
  })
  .strict();

const STATIONS_SQL = `
  SELECT
    sg.station_group_id AS "stationGroupId",
    sg.name_en AS "nameEn",
    sg.name_ja AS "nameJa",
    sg.aliases,
    ST_Y(sg.point) AS lat,
    ST_X(sg.point) AS lon,
    COALESCE(lines.names, ARRAY[]::text[]) AS lines,
    ${similarityScoreSql(STATION_GROUP_MATCH_COLUMNS, "$1")} AS score
  FROM station_groups sg
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT rl.name_en ORDER BY rl.name_en) AS names
    FROM rail_edges re
    JOIN rail_lines rl ON rl.rail_line_id = re.rail_line_id
    WHERE (re.from_station_group_id = sg.station_group_id OR re.to_station_group_id = sg.station_group_id)
      AND rl.name_en IS NOT NULL
  ) lines ON true
  WHERE ${textMatchSql(STATION_GROUP_MATCH_COLUMNS, "$1")}
  ORDER BY score DESC, sg.name_en ASC
  LIMIT $2
`;

interface StationRow {
  readonly stationGroupId: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly aliases: string[];
  readonly lat: number;
  readonly lon: number;
  readonly lines: string[];
}

export function registerStationsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/stations", async (request, reply) => {
    const { query, limit } = parseOrThrow(stationsQuerySchema, request.query);
    const effectiveLimit = Math.min(limit, STATIONS_MAX_LIMIT);

    const result = (await deps.pool.query(STATIONS_SQL, [
      escapeLikeWildcards(query),
      effectiveLimit,
    ])) as {
      rows: StationRow[];
    };

    const results: StationSuggestion[] = result.rows.map((row) => ({
      stationGroupId: row.stationGroupId,
      nameEn: row.nameEn,
      nameJa: row.nameJa,
      aliases: row.aliases,
      lines: row.lines,
      lat: row.lat,
      lon: row.lon,
    }));

    const body = { results };
    assertDevResponseShape(
      deps.config,
      request.log,
      stationsResponseSchema,
      body,
      "GET /v1/stations",
    );

    reply.status(200).send(body);
  });
}
