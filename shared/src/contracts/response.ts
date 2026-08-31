import { z } from "zod";

import { RENT_LABEL } from "../config/scoring.js";
import { confidenceSchema, layoutSchema } from "./common.js";
import { optimizationRequestSchema } from "./request.js";

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

  label: z.literal(RENT_LABEL),
});
export type RentEstimate = z.infer<typeof rentEstimateSchema>;

export const commuteEstimateSchema = z.object({
  mode: z.enum(["walk", "transit"]),
  totalMinutes: z.number(),

  rangeMinutes: z.object({ min: z.number(), max: z.number() }),

  accessWalkMinutes: z.number(),
  railMinutes: z.number(),
  waitMinutes: z.number(),
  transferCount: z.number(),
  transferPenaltyMinutes: z.number(),

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

export const neighborhoodResultSchema = z.object({
  rank: z.number(),
  localityId: z.string(),

  stationGroupId: z.string().optional(),
  nameEn: z.string(),
  nameJa: z.string(),
  wardCode: z.string(),
  wardNameEn: z.string(),
  wardNameJa: z.string(),
  centroid: z.object({
    lat: z.number(),
    lon: z.number(),
  }),
  polygon: z.unknown().nullable(),
  nearbyStations: z.array(
    z.object({
      stationGroupId: z.string(),
      nameEn: z.string(),
      nameJa: z.string(),
      walkMinutes: z.number(),
    }),
  ),
  overallScore: z.number().min(0).max(100),
  rent: rentEstimateSchema,
  commute: commuteEstimateSchema,
  factors: z.array(factorEvidenceSchema),
  reasonsFor: z.array(z.string()),
  reasonsAgainst: z.array(z.string()),
  catchmentLabel: z.string(),

  isDestinationAccessStation: z.boolean().optional(),
});
export type NeighborhoodResult = z.infer<typeof neighborhoodResultSchema>;

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

export const stationsResponseSchema = z.object({
  results: z.array(stationSuggestionSchema),
});
export type StationsResponse = z.infer<typeof stationsResponseSchema>;

export const placeSuggestionSchema = z.object({
  kind: z.enum(["station", "poi"]),

  id: z.string(),
  name: z.string(),

  nameJa: z.string().nullable(),

  category: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
});
export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

export const placesResponseSchema = z.object({
  results: z.array(placeSuggestionSchema),
});
export type PlacesResponse = z.infer<typeof placesResponseSchema>;

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
