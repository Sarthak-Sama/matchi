import { z } from "zod";

import {
  isValidSelectedAxisCount,
  LIFESTYLE_AXIS_IDS,
  mapLifestyleAxes,
  MAX_SELECTED_LIFESTYLE_AXES,
  MIN_SELECTED_LIFESTYLE_AXES,
} from "../config/lifestyle-axes.js";
import { importanceSchema, layoutSchema } from "./common.js";

/**
 * Every lifestyle axis, each optional — omitting an axis means "not
 * selected", which is materially different from rating it `low`: an
 * unselected axis is left out of the scoring loop entirely rather than
 * weighted down (see `scoreLifestyle`).
 *
 * Built from `LIFESTYLE_AXIS_IDS` rather than `z.record`: the object form
 * keeps per-field error paths (`preferences.floodSafety`, which
 * `routes/lib/validation.ts` exists to surface) and, with `.strict()`,
 * rejects unknown axis keys instead of silently dropping them.
 *
 * `.strict()` must come before any `.refine` — refining returns a schema
 * that is no longer a `ZodObject`.
 */
const preferencesSchema = z
  .object(mapLifestyleAxes(() => importanceSchema.optional()))
  .strict()
  .refine(
    (preferences) =>
      isValidSelectedAxisCount(
        LIFESTYLE_AXIS_IDS.filter((id) => preferences[id] !== undefined).length,
      ),
    {
      message:
        `Rate between ${MIN_SELECTED_LIFESTYLE_AXES} and ${MAX_SELECTED_LIFESTYLE_AXES} ` +
        `lifestyle priorities.`,
    },
  );

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
    preferences: preferencesSchema,
  })
  .strict();

export type OptimizationRequest = z.infer<typeof optimizationRequestSchema>;
