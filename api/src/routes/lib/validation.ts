/**
 * Shared request-validation helper for `/v1` routes.
 *
 * The global error handler (`app.ts`) already maps an escaping `ZodError`
 * to `400 VALIDATION_ERROR` via `err.flatten()` — but `flatten()`'s
 * `fieldErrors` is keyed only by each error's TOP-LEVEL field name, so a
 * nested path like `preferences.floodSafety` collapses to the key
 * `"preferences"` and loses which nested field actually failed. The task
 * brief requires a `details` array that NAMES the offending path (e.g.
 * `"preferences.floodSafety"` for an unknown importance, `"arrivalTime"`
 * for a bad time string) — so route handlers call `parseOrThrow` instead of
 * letting a raw `ZodError` bubble up, giving each issue its own
 * `{ path, message }` entry with the full dotted path.
 */

import type { ZodType } from "zod";

import { ApiError } from "../../app.js";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Parses `input` against `schema`, returning the parsed value on success or
 * throwing `ApiError(400, "VALIDATION_ERROR", ..., issues)` on failure,
 * where `issues` is a `ValidationIssue[]` naming every offending field.
 */
export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
      message: issue.message,
    }));
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", issues);
  }
  return result.data;
}
