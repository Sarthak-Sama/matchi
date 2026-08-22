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
  accessWalkMinutes: z.number(),
  railMinutes: z.number(),
  waitMinutes: z.number(),
  transferCount: z.number(),
  transferPenaltyMinutes: z.number(),
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
