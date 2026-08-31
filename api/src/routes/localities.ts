import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../app.js";
import { ApiError } from "../app.js";
import { parseOrThrow } from "./lib/validation.js";

const paramsSchema = z.object({ localityId: z.string().min(1) }).strict();

export function registerLocalityRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/localities/:localityId", async (request) => {
    const { localityId } = parseOrThrow(paramsSchema, request.params);
    const result = (await deps.pool.query(
      `SELECT l.locality_id AS "localityId", l.name_en AS "nameEn", l.name_ja AS "nameJa", l.ward_code AS "wardCode",
        w.name_en AS "wardNameEn", w.name_ja AS "wardNameJa", ST_Y(l.centroid) AS lat, ST_X(l.centroid) AS lon,
        ST_AsGeoJSON(l.geom)::jsonb AS polygon, lm.derived_at AS "derivedAt",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('stationGroupId', s.station_group_id, 'nameEn', s.name_en, 'nameJa', s.name_ja, 'walkMinutes', x.walk_minutes) ORDER BY x.walk_minutes)
          FROM (SELECT DISTINCT ON (station_group_id) station_group_id, walk_minutes FROM locality_sample_stations WHERE locality_id=l.locality_id ORDER BY station_group_id, walk_minutes) x
          JOIN station_groups s ON s.station_group_id=x.station_group_id), '[]'::jsonb) AS "nearbyStations"
       FROM localities l LEFT JOIN wards w ON w.ward_code=l.ward_code LEFT JOIN locality_metrics lm ON lm.locality_id=l.locality_id
       WHERE l.locality_id=$1`,
      [localityId],
    )) as { rows: unknown[] };
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "LOCALITY_NOT_FOUND", `No locality data for "${localityId}"`);
    return row;
  });
}
