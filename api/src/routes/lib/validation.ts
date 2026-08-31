import type { ZodType } from "zod";

import { ApiError } from "../../app.js";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

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
