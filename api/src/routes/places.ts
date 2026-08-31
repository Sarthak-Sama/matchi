import type { PlaceSuggestion } from "@tokyo/shared";
import { PLACES_LIMIT, placesResponseSchema } from "@tokyo/shared";
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

const PLACES_QUERY_MAX_LENGTH = 100;

const placesQuerySchema = z
  .object({
    query: z.string().min(1).max(PLACES_QUERY_MAX_LENGTH),
  })
  .strict();

const POI_MATCH_COLUMNS = { text: ["p.name", "p.name_en"] } as const;

const PLACES_SQL = `
  SELECT kind, id, name, "nameJa", category, lat, lon
  FROM (
    SELECT
      'station' AS kind,
      sg.station_group_id AS id,
      sg.name_en AS name,
      sg.name_ja AS "nameJa",
      NULL::text AS category,
      ST_Y(sg.point) AS lat,
      ST_X(sg.point) AS lon,
      ${similarityScoreSql(STATION_GROUP_MATCH_COLUMNS, "$1")} AS score
    FROM station_groups sg
    WHERE ${textMatchSql(STATION_GROUP_MATCH_COLUMNS, "$1")}

    UNION ALL

    SELECT
      'poi' AS kind,
      'poi:' || p.id AS id,
      -- Prefer the English name for display, falling back to the OSM
      -- name tag when name:en is absent (roughly half of real landmarks).
      -- nameJa then carries the Japanese original, but only when it is
      -- genuinely a *second* name: when name_en is null the fallback
      -- already shows the Japanese name, and repeating it would render
      -- the same string twice.
      COALESCE(p.name_en, p.name) AS name,
      CASE WHEN p.name_en IS NOT NULL THEN p.name END AS "nameJa",
      p.category AS category,
      ST_Y(p.point) AS lat,
      ST_X(p.point) AS lon,
      ${similarityScoreSql(POI_MATCH_COLUMNS, "$1")} AS score
    FROM pois p
    WHERE COALESCE(p.name_en, p.name) IS NOT NULL
      AND ${textMatchSql(POI_MATCH_COLUMNS, "$1")}
  ) matches
  ORDER BY score DESC, name ASC
  LIMIT $2
`;

interface PlaceRow {
  readonly kind: "station" | "poi";
  readonly id: string;
  readonly name: string;
  readonly nameJa: string | null;
  readonly category: string | null;
  readonly lat: number;
  readonly lon: number;
}

export function registerPlacesRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/places", async (request, reply) => {
    const { query } = parseOrThrow(placesQuerySchema, request.query);

    const result = (await deps.pool.query(PLACES_SQL, [
      escapeLikeWildcards(query),
      PLACES_LIMIT,
    ])) as {
      rows: PlaceRow[];
    };

    const results: PlaceSuggestion[] = result.rows.map((row) => ({
      kind: row.kind,
      id: row.id,
      name: row.name,
      nameJa: row.nameJa,
      category: row.category,
      lat: row.lat,
      lon: row.lon,
    }));

    const body = { results };
    assertDevResponseShape(deps.config, request.log, placesResponseSchema, body, "GET /v1/places");

    reply.status(200).send(body);
  });
}
