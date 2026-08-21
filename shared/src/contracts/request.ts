import { z } from "zod";

import { importanceSchema, layoutSchema } from "./common.js";

/**
 * The optimization request submitted by the frontend and validated by the
 * API. Field names and the `Importance`/layout string unions must match the
 * spec's interface exactly.
 */
export const optimizationRequestSchema = z
  .object({
    destinationStationGroupId: z.string().min(1),
    /** 24-hour `HH:MM`. */
    arrivalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    monthlyBudgetYen: z.number().int().positive().max(10_000_000),
    layout: layoutSchema,
    maxCommuteMinutes: z.number().int().min(5).max(180),
    preferences: z.object({
      floodSafety: importanceSchema,
      supermarkets: importanceSchema,
      restaurants: importanceSchema,
      quietness: importanceSchema,
    }),
  })
  .strict();

export type OptimizationRequest = z.infer<typeof optimizationRequestSchema>;
