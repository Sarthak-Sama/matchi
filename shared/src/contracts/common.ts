import { z } from "zod";

import { LAYOUT_IDS } from "../config/scoring.js";

export const importanceSchema = z.enum(["low", "medium", "high", "essential"]);
export type Importance = z.infer<typeof importanceSchema>;

export const layoutSchema = z.enum(LAYOUT_IDS);
export type Layout = z.infer<typeof layoutSchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
