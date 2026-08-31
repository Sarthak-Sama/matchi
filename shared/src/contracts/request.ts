import { z } from "zod";

import {
  isValidSelectedAxisCount,
  LIFESTYLE_AXIS_IDS,
  mapLifestyleAxes,
  MAX_SELECTED_LIFESTYLE_AXES,
  MIN_SELECTED_LIFESTYLE_AXES,
} from "../config/lifestyle-axes.js";
import { importanceSchema, layoutSchema } from "./common.js";

const preferencesSchema = z
  .object({
    ...mapLifestyleAxes(() => importanceSchema.optional()),

    floodSafety: importanceSchema.optional(),
  })
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

const destinationPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),

    label: z.string().min(1).optional(),
  })
  .strict();

export type DestinationPoint = z.infer<typeof destinationPointSchema>;

export const optimizationRequestSchema = z
  .object({
    destinationStationGroupId: z.string().min(1).optional(),

    destinationPoint: destinationPointSchema.optional(),

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
      path: ["destinationStationGroupId"],
      message:
        "Provide exactly one destination: either destinationStationGroupId or destinationPoint.",
    },
  );

export type OptimizationRequest = z.infer<typeof optimizationRequestSchema>;
