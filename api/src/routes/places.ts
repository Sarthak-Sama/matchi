/**
 * `GET /v1/places?query=` — destination autocomplete over named `pois` AND
 * `station_groups`, in one ranked list.
 *
 * `/v1/stations` answers "which station did you mean?". This answers
 * "where are you going?", which is a different question: a user commutes
 * to an office, a campus, a hospital — a PLACE — and making them work out
 * which station serves it is the guess this whole feature exists to
 * remove. So both tables are searched together and ranked against each
 * other by the same trigram similarity (`lib/text-ranking.ts`, shared with
 * `/v1/stations`), letting an exact station-name match outrank the dozens
 * of POIs that merely contain the same word.
 *
 * `pois` rows with a `NULL` name are excluded: an unnamed convenience
 * store is a real amenity for the derive step's density counts, but it is
 * not something a user can pick out of a list.
 */

import type { PlaceSuggestion } from "@tokyo/shared";
import { PLACES_LIMIT, placesResponseSchema } from "@tokyo/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../app.js";
import { assertDevResponseShape } from "./lib/dev-response-check.js";
import {
  similarityScoreSql,
  STATION_GROUP_MATCH_COLUMNS,
  textMatchSql,
} from "./lib/text-ranking.js";
import { parseOrThrow } from "./lib/validation.js";

const placesQuerySchema = z
  .object({
    query: z.string().min(1),
  })
  .strict();

const POI_MATCH_COLUMNS = { text: ["p.name"] } as const;

// One UNION ALL, ordered and limited ONCE over the combined set — not two
// separate top-N queries stitched together, which would either pad the
// list with poor POI matches when the station match is perfect or crowd
// the station out when it isn't.
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
      p.name AS name,
      NULL::text AS "nameJa",
      p.category AS category,
      ST_Y(p.point) AS lat,
      ST_X(p.point) AS lon,
      ${similarityScoreSql(POI_MATCH_COLUMNS, "$1")} AS score
    FROM pois p
    WHERE p.name IS NOT NULL
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

    const result = (await deps.pool.query(PLACES_SQL, [query, PLACES_LIMIT])) as {
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
