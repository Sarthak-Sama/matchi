import { z } from "zod";

import { LAYOUT_IDS } from "../config/scoring.js";

/**
 * Preference importance levels used throughout the optimization request and
 * scoring engine. Mirrors the keys of `IMPORTANCE_VALUES` in
 * `config/scoring.ts`.
 */
export const importanceSchema = z.enum(["low", "medium", "high", "essential"]);
export type Importance = z.infer<typeof importanceSchema>;

/** Apartment layout id, constrained to the ids defined in `LAYOUTS`. */
export const layoutSchema = z.enum(LAYOUT_IDS);
export type Layout = z.infer<typeof layoutSchema>;

/** Zod counterpart of the `Confidence` type exported from `config/scoring.ts`. */
export const confidenceSchema = z.enum(["high", "medium", "low"]);
