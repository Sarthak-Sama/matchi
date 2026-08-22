/**
 * `GET /v1/neighborhoods/:stationGroupId?layout=` — the station, its ward,
 * the catchment polygon as GeoJSON, its derived metrics restated as
 * structured factor evidence, a modeled rent estimate for the requested
 * layout (default `1LDK`), and the data's source dates.
 *
 * There is no dedicated shared Zod schema for this route's full response
 * envelope (Task 2 only defined `neighborhoodResultSchema` for
 * `/v1/optimize`'s ranked-result shape, which lacks the catchment GeoJSON
 * and full metrics this route exposes) — so the dev-mode response check
 * here validates the two REUSABLE shared sub-schemas this response embeds
 * (`rentEstimateSchema`, `factorEvidenceSchema`) rather than a
 * one-off envelope schema invented just for this check.
 */

import type { FactorEvidence, Importance, RentEstimateResult } from "@tokyo/shared";
import { CATCHMENT_LABEL, factorEvidenceSchema, layoutSchema, rentEstimateSchema } from "@tokyo/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../app.js";
import { ApiError } from "../app.js";
import { scoreLifestyle } from "../domain/scoring.js";
import type { LifestyleMetricsInput } from "../domain/scoring.js";
import { assertDevResponseShape } from "./lib/dev-response-check.js";
import { recomputeRentForLayout } from "./lib/rent.js";
import { parseOrThrow } from "./lib/validation.js";

const DEFAULT_LAYOUT = "1LDK";

const paramsSchema = z.object({ stationGroupId: z.string().min(1) }).strict();
const querySchema = z.object({ layout: layoutSchema.default(DEFAULT_LAYOUT) }).strict();

/**
 * A uniform "medium" importance on every axis — this route displays a
 * station's metrics independent of any particular user's preferences, so
 * `scoreLifestyle`'s `FactorEvidence[]` output is generated with an equal
 * split across axes (each `effectiveWeight` = `OVERALL_WEIGHTS.lifestyle /
 * 4`) purely to reuse its already-tested raw-value/label/direction
 * assembly, not because these weights represent anyone's real request.
 */
const NEUTRAL_PREFERENCES: Record<"floodSafety" | "supermarkets" | "restaurants" | "quietness", Importance> = {
  floodSafety: "medium",
  supermarkets: "medium",
  restaurants: "medium",
  quietness: "medium",
};

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
    nm.norm_flood_safety AS "normFloodSafety",
    nm.norm_amenity_supermarket AS "normAmenitySupermarket",
    nm.norm_amenity_restaurant AS "normAmenityRestaurant",
    nm.norm_quietness AS "normQuietness",
    nm.supermarket_count AS "supermarketCount",
    nm.restaurant_count AS "restaurantCount",
    nm.cafe_count AS "cafeCount",
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

interface NeighborhoodRow {
  readonly stationGroupId: string;
  readonly nameEn: string;
  readonly nameJa: string;
  readonly aliases: string[];
  readonly wardCode: string | null;
  readonly wardNameEn: string | null;
  readonly wardNameJa: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly rentPerSqmYen: number | null;
  readonly managementFeeYen: number | null;
  readonly landPriceMultiplier: number | null;
  readonly landPricePointCount: number | null;
  readonly landPriceUsedFallback: boolean | null;
  readonly rentSource: string | null;
  readonly rentSourcePeriod: string | null;
  readonly normFloodSafety: number | null;
  readonly normAmenitySupermarket: number | null;
  readonly normAmenityRestaurant: number | null;
  readonly normQuietness: number | null;
  readonly supermarketCount: number | null;
  readonly restaurantCount: number | null;
  readonly cafeCount: number | null;
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
  readonly ward: { readonly wardCode: string; readonly nameEn: string; readonly nameJa: string } | null;
  readonly centroid: { readonly lat: number; readonly lon: number };
  readonly catchment: {
    readonly radiusM: number | null;
    readonly label: string;
    /** Parsed GeoJSON Polygon, or `null` when the catchment hasn't been derived yet. */
    readonly geoJson: unknown | null;
  };
  /**
   * `null` when this station's ward has no `rent_stats` row at all (see
   * `routes/lib/rent.ts` and task-10-brief.md's "four things" item 4) — the
   * neighborhood itself IS derived and shown, it simply has no honest rent
   * estimate to display, rather than a fabricated one.
   */
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

    if (
      !row ||
      row.derivedAt === null ||
      row.normFloodSafety === null ||
      row.normAmenitySupermarket === null ||
      row.normAmenityRestaurant === null ||
      row.normQuietness === null
    ) {
      throw new ApiError(
        404,
        "NEIGHBORHOOD_NOT_FOUND",
        `No derived neighborhood data for station "${stationGroupId}"`,
      );
    }

    const rent =
      row.rentPerSqmYen === null ||
      row.managementFeeYen === null ||
      row.landPriceMultiplier === null ||
      row.landPricePointCount === null ||
      row.landPriceUsedFallback === null ||
      row.rentSource === null ||
      row.rentSourcePeriod === null
        ? null
        : recomputeRentForLayout(
            {
              rentPerSqmYen: row.rentPerSqmYen,
              managementFeeYen: row.managementFeeYen,
              landPriceMultiplier: row.landPriceMultiplier,
              landPricePointCount: row.landPricePointCount,
              landPriceUsedFallback: row.landPriceUsedFallback,
              rentSource: row.rentSource,
              rentSourcePeriod: row.rentSourcePeriod,
            },
            layout,
            new Date().getFullYear(),
          );
    if (rent === null) {
      request.log.warn(
        { stationGroupId },
        "GET /v1/neighborhoods: no rent estimate available (ward has no rent_stats row)",
      );
    }

    const lifestyle: LifestyleMetricsInput = {
      normFloodSafety: row.normFloodSafety,
      normAmenitySupermarket: row.normAmenitySupermarket,
      normAmenityRestaurant: row.normAmenityRestaurant,
      normQuietness: row.normQuietness,
      supermarketCount: row.supermarketCount ?? 0,
      restaurantCount: row.restaurantCount ?? 0,
      cafeCount: row.cafeCount ?? 0,
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
