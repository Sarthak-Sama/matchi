import { z } from "zod";

import { RENT_LABEL } from "../config/scoring.js";
import { confidenceSchema, layoutSchema } from "./common.js";
import { optimizationRequestSchema } from "./request.js";

// ---------------------------------------------------------------------------
// factorEvidenceSchema
// ---------------------------------------------------------------------------

export const factorEvidenceSchema = z.object({
  key: z.string(),
  label: z.string(),
  rawValue: z.number(),
  rawValueLabel: z.string(),
  componentScore: z.number().min(0).max(100),
  effectiveWeight: z.number(),
  pointContribution: z.number(),
  sourceDate: z.string().nullable(),
  confidence: confidenceSchema,
  explanation: z.string(),
  direction: z.enum(["positive", "negative", "neutral"]),
});
export type FactorEvidence = z.infer<typeof factorEvidenceSchema>;

// ---------------------------------------------------------------------------
// rentEstimateSchema
// ---------------------------------------------------------------------------

export const rentEstimateSchema = z.object({
  lowYen: z.number(),
  medianYen: z.number(),
  highYen: z.number(),
  layout: layoutSchema,
  assumedSizeSqmMin: z.number(),
  assumedSizeSqmMax: z.number(),
  assumedSizeSqmMid: z.number(),
  managementFeeYen: z.number(),
  wardRentPerSqmYen: z.number(),
  landPriceMultiplier: z.number(),
  landPricePointCount: z.number(),
  source: z.string(),
  sourcePeriod: z.string(),
  confidence: confidenceSchema,
  /** Always `RENT_LABEL` — every rent value must carry this label. */
  label: z.literal(RENT_LABEL),
});
export type RentEstimate = z.infer<typeof rentEstimateSchema>;

// ---------------------------------------------------------------------------
// commuteEstimateSchema
// ---------------------------------------------------------------------------

export const commuteEstimateSchema = z.object({
  totalMinutes: z.number(),
  /** The origin-side walk: neighborhood to its own station. */
  accessWalkMinutes: z.number(),
  railMinutes: z.number(),
  waitMinutes: z.number(),
  transferCount: z.number(),
  transferPenaltyMinutes: z.number(),
  /**
   * The destination-side walk: the access station this route ends at to
   * the destination point. Already included in `totalMinutes`; reported
   * separately so a client can show the full breakdown ("8 min walk + 24
   * rail + 6 wait + 11 min walk to the office").
   */
  destinationWalkMinutes: z.number(),
  confidence: confidenceSchema,
  label: z.string(),
  path: z.array(
    z.object({
      stationGroupId: z.string(),
      nameEn: z.string(),
      nameJa: z.string(),
      lineName: z.string().nullable(),
    }),
  ),
});
export type CommuteEstimate = z.infer<typeof commuteEstimateSchema>;

// ---------------------------------------------------------------------------
// neighborhoodResultSchema
// ---------------------------------------------------------------------------

export const neighborhoodResultSchema = z.object({
  rank: z.number(),
  stationGroupId: z.string(),
  nameEn: z.string(),
  nameJa: z.string(),
  wardCode: z.string(),
  wardNameEn: z.string(),
  wardNameJa: z.string(),
  centroid: z.object({
    lat: z.number(),
    lon: z.number(),
  }),
  overallScore: z.number().min(0).max(100),
  rent: rentEstimateSchema,
  commute: commuteEstimateSchema,
  factors: z.array(factorEvidenceSchema),
  reasonsFor: z.array(z.string()),
  reasonsAgainst: z.array(z.string()),
  catchmentLabel: z.string(),
  /**
   * True when this area's own station is one of the destination's access
   * stations — i.e. living here means walking to the destination rather
   * than riding to it. The commute estimate for such an area is honest but
   * pessimistic (a fixed 8-minute walk to the station plus 0 rail minutes
   * plus the walk from that station), so the UI should mark it rather than
   * present its total as directly comparable to a rail commute.
   */
  isDestinationAccessStation: z.boolean(),
});
export type NeighborhoodResult = z.infer<typeof neighborhoodResultSchema>;

// ---------------------------------------------------------------------------
// optimizeResponseSchema
// ---------------------------------------------------------------------------

export const optimizeResponseSchema = z.object({
  results: z.array(neighborhoodResultSchema),
  diagnostics: z.object({
    candidatesConsidered: z.number(),
    excludedByRent: z.number(),
    excludedByCommute: z.number(),
    excludedByDisconnected: z.number(),
    feasibleCount: z.number(),
    suggestion: z.string().nullable(),
  }),
  request: optimizationRequestSchema,
  dataVintages: z.array(
    z.object({
      source: z.string(),
      sourceUpdatedAt: z.string().nullable(),
      importedAt: z.string().nullable(),
    }),
  ),
});
export type OptimizeResponse = z.infer<typeof optimizeResponseSchema>;

// ---------------------------------------------------------------------------
// stationSuggestionSchema
// ---------------------------------------------------------------------------

export const stationSuggestionSchema = z.object({
  stationGroupId: z.string(),
  nameEn: z.string(),
  nameJa: z.string(),
  aliases: z.array(z.string()),
  lines: z.array(z.string()),
  lat: z.number(),
  lon: z.number(),
});
export type StationSuggestion = z.infer<typeof stationSuggestionSchema>;

/** `GET /v1/stations`'s full response envelope. */
export const stationsResponseSchema = z.object({
  results: z.array(stationSuggestionSchema),
});
export type StationsResponse = z.infer<typeof stationsResponseSchema>;

// ---------------------------------------------------------------------------
// placeSuggestionSchema
// ---------------------------------------------------------------------------

/**
 * One `GET /v1/places` suggestion. The endpoint searches named `pois` AND
 * `station_groups` in one ranked list, because a user typing a destination
 * is thinking of a PLACE ("Shibuya Hikarie") and should not have to
 * translate it into a station themselves.
 */
export const placeSuggestionSchema = z.object({
  kind: z.enum(["station", "poi"]),
  /**
   * Unique within a response. For `kind: "station"` this IS the
   * `station_group_id` — send it back as `destinationStationGroupId`. For
   * `kind: "poi"` it is `poi:<pois.id>`, opaque to the API: send the
   * suggestion's `lat`/`lon`/`name` back as `destinationPoint` instead.
   */
  id: z.string(),
  name: z.string(),
  /** A station's Japanese name. Always `null` for a POI — `pois` has one name column. */
  nameJa: z.string().nullable(),
  /** A POI's category (`supermarket`, `cafe`, ...). Always `null` for a station. */
  category: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
});
export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

/** `GET /v1/places`'s full response envelope. */
export const placesResponseSchema = z.object({
  results: z.array(placeSuggestionSchema),
});
export type PlacesResponse = z.infer<typeof placesResponseSchema>;

// ---------------------------------------------------------------------------
// dataStatusSchema
// ---------------------------------------------------------------------------

export const dataStatusSchema = z.object({
  sources: z.array(
    z.object({
      source: z.string(),
      status: z.string(),
      sourceUpdatedAt: z.string().nullable(),
      importedAt: z.string().nullable(),
      rowsImported: z.number().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type DataStatus = z.infer<typeof dataStatusSchema>;
