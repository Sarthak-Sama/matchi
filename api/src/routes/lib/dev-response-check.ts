/**
 * A cheap, dev/test-only response-shape safety net. Every `/v1` route
 * builds its response by hand from several joined queries plus pure-domain
 * function calls — nothing enforces at compile time that the assembled
 * object still matches its shared Zod schema. Running a `safeParse` in
 * development and test (never in production, so this never costs a
 * production request anything) turns a shape mismatch into a loud, early
 * 500 instead of a client-visible contract violation slipping through
 * silently.
 */

import type { FastifyBaseLogger } from "fastify";
import type { ZodType } from "zod";

import type { Config } from "../../config.js";

/**
 * Throws a plain `Error` (caught by the global error handler and mapped to
 * `500 INTERNAL_ERROR` — this is a server bug, not a client-facing
 * validation failure) when `data` doesn't match `schema` and
 * `config.NODE_ENV !== "production"`. No-op in production.
 */
export function assertDevResponseShape<T>(
  config: Config,
  log: FastifyBaseLogger,
  schema: ZodType<T>,
  data: unknown,
  routeName: string,
): void {
  if (config.NODE_ENV === "production") return;

  const result = schema.safeParse(data);
  if (!result.success) {
    log.error(
      { routeName, issues: result.error.issues },
      "response failed shared-schema validation (dev/test-only check)",
    );
    throw new Error(
      `${routeName}: assembled response does not match its shared Zod schema — see logged issues`,
    );
  }
}
