import type {
  FactorEvidence,
  Importance,
  LifestyleAxisId,
  RentEstimateResult,
} from "@tokyo/shared";
import {
  CATCHMENT_LABEL,
  factorEvidenceSchema,
  layoutSchema,
  mapLifestyleAxes,
  NEIGHBORHOOD_DEFAULT_LAYOUT,
  rentEstimateSchema,
} from "@tokyo/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../app.js";
import { ApiError } from "../app.js";
import { scoreLifestyle } from "../domain/scoring.js";
import type { LifestyleMetricsInput } from "../domain/scoring.js";
import { assertDevResponseShape } from "./lib/dev-response-check.js";
import type { LifestyleMetricColumns } from "./lib/lifestyle-columns.js";
import {
  LIFESTYLE_SELECT_SQL,
  readLifestyleNormScores,
  readLifestyleRawCounts,
} from "./lib/lifestyle-columns.js";
import { readStoredRentInputs, recomputeRentForLayout } from "./lib/rent.js";
import type { StoredRentInputRow } from "./lib/rent.js";
import { parseOrThrow } from "./lib/validation.js";

const paramsSchema = z.object({ stationGroupId: z.string().min(1) }).strict();
const querySchema = z
  .object({ layout: layoutSchema.default(NEIGHBORHOOD_DEFAULT_LAYOUT) })
  .strict();

const NEUTRAL_PREFERENCES: Record<LifestyleAxisId, Importance> = mapLifestyleAxes(() => "medium");

const NEIGHBORHOOD_SQL = `
  SELECT
    sg.station_group_id AS "stationGroupId",
    sg.name_en AS "nameEn",
    sg.name_ja AS "nameJa",
    sg.aliases,
    sg.ward_code AS "wardCode",
    w.name_en AS "wardNameEn",
    w.name_ja AS "wardNameJa",
    ST_Y(sg.point) AS lat,
    ST_X(sg.point) AS lon,
    nm.rent_per_sqm_yen AS "rentPerSqmYen",
    nm.management_fee_yen AS "managementFeeYen",
    nm.land_price_multiplier AS "landPriceMultiplier",
    nm.land_price_point_count AS "landPricePointCount",
    nm.land_price_used_fallback AS "landPriceUsedFallback",
    nm.rent_source AS "rentSource",
    nm.rent_source_period AS "rentSourcePeriod",
    ${LIFESTYLE_SELECT_SQL},
    nm.derived_at AS "derivedAt",
    nm.source_dates AS "sourceDates",
    sa.radius_m AS "catchmentRadiusM",
    ST_AsGeoJSON(sa.geom) AS "catchmentGeoJson"
  FROM station_groups sg
  LEFT JOIN wards w ON w.ward_code = sg.ward_code
  LEFT JOIN neighborhood_metrics nm ON nm.station_group_id = sg.station_group_id
  LEFT JOIN station_areas sa ON sa.station_group_id = sg.station_group_id
  WHERE sg.station_group_id = $1
`;

interface NeighborhoodRow extends LifestyleMetricColumns, StoredRentInputRow {
  readonly stationGroupId: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly aliases: string[];
  readonly wardCode: string | null;
  readonly wardNameEn: string | null;
  readonly wardNameJa: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly derivedAt: Date | null;
  readonly sourceDates: Record<string, string> | null;
  readonly catchmentRadiusM: number | null;
  readonly catchmentGeoJson: string | null;
}

interface NeighborhoodDetailResponse {
  readonly stationGroupId: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly aliases: string[];
  readonly ward: {
    readonly wardCode: string;
    readonly nameEn: string;
    readonly nameJa: string;
  } | null;
  readonly centroid: { readonly lat: number; readonly lon: number };
  readonly catchment: {
    readonly radiusM: number | null;
    readonly label: string;

    readonly geoJson: unknown | null;
  };

  readonly rent: RentEstimateResult | null;
  readonly factors: readonly FactorEvidence[];
  readonly sourceDates: Record<string, string>;
  readonly derivedAt: string;
}

export function registerNeighborhoodRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/neighborhoods/:stationGroupId", async (request, reply) => {
    const { stationGroupId } = parseOrThrow(paramsSchema, request.params);
    const { layout } = parseOrThrow(querySchema, request.query);

    const result = (await deps.pool.query(NEIGHBORHOOD_SQL, [stationGroupId])) as {
      rows: NeighborhoodRow[];
    };
    const row = result.rows[0];
    const normScores = row ? readLifestyleNormScores(row) : null;

    if (!row || row.derivedAt === null || normScores === null) {
      if (row && normScores === null) {
        request.log.warn(
          { stationGroupId },
          "GET /v1/neighborhoods: excluding station with incomplete normalized lifestyle metrics — has `pnpm derive` been run since the last schema migration?",
        );
      }
      throw new ApiError(
        404,
        "NEIGHBORHOOD_NOT_FOUND",
        `No derived neighborhood data for station "${stationGroupId}"`,
      );
    }

    const rentInputs = readStoredRentInputs(row);
    const rent =
      rentInputs === null
        ? null
        : recomputeRentForLayout(rentInputs, layout, new Date().getFullYear());
    if (rent === null) {
      request.log.warn(
        { stationGroupId },
        "GET /v1/neighborhoods: no rent estimate available (ward has no rent_stats row)",
      );
    }

    const lifestyle: LifestyleMetricsInput = {
      ...normScores,
      ...readLifestyleRawCounts(row),
      sourceDate: row.derivedAt.toISOString(),
      confidence: "medium",
    };
    const { factors } = scoreLifestyle(lifestyle, NEUTRAL_PREFERENCES);

    const ward =
      row.wardCode !== null && row.wardNameEn !== null && row.wardNameJa !== null
        ? { wardCode: row.wardCode, nameEn: row.wardNameEn, nameJa: row.wardNameJa }
        : null;

    const body: NeighborhoodDetailResponse = {
      stationGroupId: row.stationGroupId,
      nameEn: row.nameEn,
      nameJa: row.nameJa,
      aliases: row.aliases,
      ward,
      centroid: { lat: row.lat, lon: row.lon },
      catchment: {
        radiusM: row.catchmentRadiusM,
        label: CATCHMENT_LABEL,
        geoJson: row.catchmentGeoJson ? (JSON.parse(row.catchmentGeoJson) as unknown) : null,
      },
      rent,
      factors,
      sourceDates: row.sourceDates ?? {},
      derivedAt: row.derivedAt.toISOString(),
    };

    if (deps.config.NODE_ENV !== "production") {
      assertDevResponseShape(
        deps.config,
        request.log,
        z.array(factorEvidenceSchema),
        body.factors,
        "GET /v1/neighborhoods/:stationGroupId (factors)",
      );
      if (body.rent !== null) {
        assertDevResponseShape(
          deps.config,
          request.log,
          rentEstimateSchema,
          body.rent,
          "GET /v1/neighborhoods/:stationGroupId (rent)",
        );
      }
    }

    reply.status(200).send(body);
  });
}
