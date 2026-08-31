import type { FastifyBaseLogger } from "fastify";

import type { Candidate, LifestyleMetricsInput } from "../../domain/scoring.js";
import { percentile } from "../../domain/percentile.js";
import { estimateCommute } from "../../domain/transit/commute.js";
import type { DijkstraSeed } from "../../domain/transit/dijkstra.js";
import type { reverseDijkstra } from "../../domain/transit/dijkstra.js";
import type { Confidence, LayoutId } from "@tokyo/shared";
import { walkMinutesForMetres } from "./access-stations.js";
import type { LifestyleMetricColumns } from "./lifestyle-columns.js";
import { readLifestyleNormScores, readLifestyleRawCounts } from "./lifestyle-columns.js";
import { recomputeRentForLayout } from "./rent.js";
import type { NameLookups } from "./station-names.js";
import { resolvePathNames } from "./station-names.js";

const LIFESTYLE_BUNDLE_CONFIDENCE: Confidence = "medium";

export const CANDIDATES_SQL = `
  SELECT
    l.locality_id AS "localityId",
    l.name_en AS "nameEn",
    l.name_ja AS "nameJa",
    l.ward_code AS "wardCode",
    w.name_en AS "wardNameEn",
    w.name_ja AS "wardNameJa",
    ST_Y(l.centroid) AS lat, ST_X(l.centroid) AS lon,
    ST_AsGeoJSON(l.geom)::jsonb AS polygon,
    lm.rent_per_sqm_yen AS "rentPerSqmYen", lm.management_fee_yen AS "managementFeeYen",
    lm.land_price_multiplier AS "landPriceMultiplier", lm.land_price_point_count AS "landPricePointCount",
    lm.land_price_used_fallback AS "landPriceUsedFallback", lm.rent_source AS "rentSource",
    lm.rent_source_period AS "rentSourcePeriod",
    lm.norm_amenity_supermarket AS "normAmenitySupermarket", lm.norm_amenity_restaurant AS "normAmenityRestaurant",
    lm.norm_quietness AS "normQuietness", lm.norm_amenity_convenience AS "normAmenityConvenience",
    lm.norm_amenity_cuisine_variety AS "normAmenityCuisineVariety", lm.norm_green_space AS "normGreenSpace",
    lm.norm_amenity_late_night AS "normAmenityLateNight", lm.norm_amenity_health AS "normAmenityHealth",
    lm.supermarket_count AS "supermarketCount", lm.restaurant_count AS "restaurantCount", lm.cafe_count AS "cafeCount",
    lm.convenience_count AS "convenienceCount", lm.cuisine_variety_count AS "cuisineVarietyCount",
    lm.green_space_share AS "greenSpaceShare", lm.late_night_count AS "lateNightCount", lm.health_count AS "healthCount",
    lm.derived_at AS "derivedAt",
    COALESCE(samples.samples, '[]'::jsonb) AS samples
  FROM locality_metrics lm JOIN localities l ON l.locality_id = lm.locality_id
  LEFT JOIN wards w ON w.ward_code = l.ward_code
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('sampleNumber', ls.sample_number, 'lat', ST_Y(ls.point), 'lon', ST_X(ls.point),
      'stations', COALESCE((SELECT jsonb_agg(jsonb_build_object('stationGroupId', lss.station_group_id, 'walkMinutes', lss.walk_minutes, 'rank', lss.station_rank) ORDER BY lss.station_rank)
        FROM locality_sample_stations lss WHERE lss.locality_id = ls.locality_id AND lss.sample_number = ls.sample_number), '[]'::jsonb))
      ORDER BY ls.sample_number) AS samples
    FROM locality_samples ls WHERE ls.locality_id = l.locality_id
  ) samples ON true
`;

export interface ExclusionCounts {
  missingLifestyleMetrics: number;
}

export interface CandidateRow extends LifestyleMetricColumns {
  readonly localityId: string;
  readonly nameEn: string | null;
  readonly nameJa: string;
  readonly wardCode: string | null;
  readonly wardNameEn: string | null;
  readonly wardNameJa: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly polygon?: unknown;
  readonly samples: readonly LocalitySample[];
  readonly rentPerSqmYen: number | null;
  readonly managementFeeYen: number | null;
  readonly landPriceMultiplier: number | null;
  readonly landPricePointCount: number | null;
  readonly landPriceUsedFallback: boolean | null;
  readonly rentSource: string | null;
  readonly rentSourcePeriod: string | null;
  readonly derivedAt: Date;
}

export interface LocalitySample {
  readonly sampleNumber: number;
  readonly lat: number;
  readonly lon: number;
  readonly stations: readonly {
    readonly stationGroupId: string;
    readonly walkMinutes: number;
    readonly rank: number;
  }[];
}

export interface Destination {
  readonly seeds: DijkstraSeed[];
  readonly point: { readonly lat: number; readonly lon: number } | null;
}

function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function estimateWalkCommute(
  destination: Destination,
  sample: LocalitySample,
): ReturnType<typeof estimateCommute> {
  if (destination.point === null) return null;
  const minutes = walkMinutesForMetres(metresBetween(sample, destination.point));
  return {
    mode: "walk",
    totalMinutes: minutes,
    accessWalkMinutes: minutes,
    railMinutes: 0,
    waitMinutes: 0,
    transferCount: 0,
    transferPenaltyMinutes: 0,
    destinationWalkMinutes: 0,
    confidence: "medium",
    label: "typical weekday estimate",
    path: [],
  };
}

function estimateBestTransitCommute(
  sample: LocalitySample,
  dijkstraResult: ReturnType<typeof reverseDijkstra>,
  lookups: NameLookups,
): ReturnType<typeof estimateCommute> {
  const perStation = sample.stations.flatMap((station) => {
    const base = estimateCommute(dijkstraResult, station.stationGroupId);
    if (!base) return [];
    return [
      {
        ...base,
        mode: "transit" as const,
        accessWalkMinutes: station.walkMinutes,
        totalMinutes: base.totalMinutes - base.accessWalkMinutes + station.walkMinutes,
        rangeMinutes: { min: 0, max: 0 },
        path: resolvePathNames(base.path, lookups),
      },
    ];
  });
  perStation.sort((a, b) => a.totalMinutes - b.totalMinutes);
  return perStation[0] ?? null;
}

export function localityCommute(
  samples: readonly LocalitySample[],
  destination: Destination,
  dijkstraResult: ReturnType<typeof reverseDijkstra>,
  lookups: NameLookups,
): ReturnType<typeof estimateCommute> {
  if (samples.length === 0) return null;

  const estimates = samples.flatMap((sample) => {
    const walk = estimateWalkCommute(destination, sample);
    const transit = estimateBestTransitCommute(sample, dijkstraResult, lookups);
    const best =
      walk !== null && (transit === null || walk.totalMinutes <= transit.totalMinutes)
        ? walk
        : transit;
    return best ? [{ sampleNumber: sample.sampleNumber, ...best }] : [];
  });
  if (estimates.length === 0) return null;

  const ordered = [...estimates].sort(
    (a, b) => a.totalMinutes - b.totalMinutes || a.sampleNumber - b.sampleNumber,
  );
  const median = ordered[Math.floor(ordered.length / 2)]!;
  const totalMinutesInOrder = ordered.map((estimate) => estimate.totalMinutes);
  return {
    ...median,
    rangeMinutes: {
      min: percentile(totalMinutesInOrder, 0.25),
      max: percentile(totalMinutesInOrder, 0.75),
    },
  };
}

function nearbyStationsFromSamples(
  samples: readonly LocalitySample[],
  nameLookups: NameLookups,
): NonNullable<Candidate["nearbyStations"]> {
  const uniqueByStation = new Map(
    samples
      .flatMap((sample) => sample.stations)
      .map((station) => [station.stationGroupId, station]),
  );
  return [...uniqueByStation.values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((station) => {
      const names = nameLookups.stationNames.get(station.stationGroupId);
      return {
        stationGroupId: station.stationGroupId,
        nameEn: names?.nameEn ?? station.stationGroupId,
        nameJa: names?.nameJa ?? station.stationGroupId,
        walkMinutes: station.walkMinutes,
      };
    });
}

export function buildCandidate(
  row: CandidateRow,
  dijkstraResult: ReturnType<typeof reverseDijkstra>,
  destination: Destination,
  layout: LayoutId,
  currentYear: number,
  nameLookups: NameLookups,
  log: FastifyBaseLogger,
  exclusionCounts: ExclusionCounts,
): Candidate | null {
  if (row.wardCode === null || row.wardNameEn === null || row.wardNameJa === null) {
    log.warn(
      { localityId: row.localityId },
      "excluding candidate from /v1/optimize: no ward assignment",
    );
    return null;
  }

  if (
    row.rentPerSqmYen === null ||
    row.managementFeeYen === null ||
    row.landPriceMultiplier === null ||
    row.landPricePointCount === null ||
    row.landPriceUsedFallback === null ||
    row.rentSource === null ||
    row.rentSourcePeriod === null
  ) {
    log.warn(
      { localityId: row.localityId, wardCode: row.wardCode },
      "excluding candidate from /v1/optimize: incomplete rent inputs (ward likely has no rent_stats row)",
    );
    return null;
  }

  const normScores = readLifestyleNormScores(row);
  if (normScores === null) {
    exclusionCounts.missingLifestyleMetrics += 1;
    log.warn(
      { localityId: row.localityId },
      "excluding candidate from /v1/optimize: incomplete normalized lifestyle metrics",
    );
    return null;
  }

  const rent = recomputeRentForLayout(
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
    currentYear,
  );

  const commute = localityCommute(row.samples, destination, dijkstraResult, nameLookups);

  const lifestyle: LifestyleMetricsInput = {
    ...normScores,
    ...readLifestyleRawCounts(row),
    sourceDate: row.derivedAt.toISOString(),
    confidence: LIFESTYLE_BUNDLE_CONFIDENCE,
  };

  return {
    localityId: row.localityId,
    nameEn: row.nameEn ?? row.nameJa,
    nameJa: row.nameJa,
    wardCode: row.wardCode,
    wardNameEn: row.wardNameEn,
    wardNameJa: row.wardNameJa,
    centroid: { lat: row.lat, lon: row.lon },
    polygon: row.polygon ?? null,
    nearbyStations: nearbyStationsFromSamples(row.samples, nameLookups),
    rent,
    commute,
    lifestyle,
  };
}
