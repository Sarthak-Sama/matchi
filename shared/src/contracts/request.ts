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
 * A destination expressed as a real point on the map (an office, a
 * campus, a client's building) rather than as a station.
 *
 * `lat`/`lon` are validated HERE, at the schema boundary, and nowhere
 * else: `reverseDijkstra` guards its seeds' walk minutes but has no way to
 * tell a plausible coordinate from a transposed one, and a `NaN` that
 * reaches PostGIS produces an empty result set rather than an error. Zod's
 * `z.number()` already rejects `NaN` and `±Infinity`, so the `min`/`max`
 * bounds below are what remains: the full valid WGS84 ranges.
 *
 * Deliberately NOT narrowed to a Tokyo bounding box. A coordinate far from
 * Tokyo is a perfectly well-formed request that simply has no access
 * station near it, and the honest answer to it is `NO_ACCESS_STATIONS`
 * from the resolver — which names the actual problem — not a validation
 * error about a rectangle the user never agreed to.
 */
const destinationPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    /** What the user picked, echoed back so the UI can title the results ("Shibuya Office"). */
    label: z.string().min(1).optional(),
  })
  .strict();

export type DestinationPoint = z.infer<typeof destinationPointSchema>;

/**
 * The optimization request submitted by the frontend and validated by the
 * API. Field names and the `Importance`/layout string unions must match the
 * spec's interface exactly.
 *
 * The destination is EITHER a station group id or a point — two mutually
 * exclusive optionals with a `.refine` requiring exactly one, rather than a
 * discriminated union. A union would force every existing caller and test
 * to grow a discriminator tag for no behavioural gain; this shape leaves
 * every `destinationStationGroupId` request byte-for-byte valid.
 */
export const optimizationRequestSchema = z
  .object({
    destinationStationGroupId: z.string().min(1).optional(),
    /** A destination that is a place, not a station — see `destinationPointSchema`. */
    destinationPoint: destinationPointSchema.optional(),
    /** 24-hour `HH:MM`. */
    arrivalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    monthlyBudgetYen: z.number().int().positive().max(10_000_000),
    layout: layoutSchema,
    maxCommuteMinutes: z.number().int().min(5).max(180),
    preferences: preferencesSchema,
  })
  .strict()
  .refine(
    (request) =>
      (request.destinationStationGroupId !== undefined) !==
      (request.destinationPoint !== undefined),
    {
      // Reported against `destinationStationGroupId` rather than the object
      // root so a request that simply omits the destination entirely — by
      // far the most common way to trip this — still names a field the
      // caller recognizes instead of "(root)".
      path: ["destinationStationGroupId"],
      message:
        "Provide exactly one destination: either destinationStationGroupId or destinationPoint.",
    },
  );

export type OptimizationRequest = z.infer<typeof optimizationRequestSchema>;
