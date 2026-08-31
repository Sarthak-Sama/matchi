import type { FastifyBaseLogger } from "fastify";
import type { ZodType } from "zod";

import type { Config } from "../../config.js";

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
