/**
 * Global vitest setup: runs before every test file, in every project.
 *
 * This exists because the per-file version of this check was not
 * forget-proof. Eight suites were routed through the guard by hand and
 * five more — `scripts/src/derive/amenities.test.ts` and four under
 * `api/src/routes/` — were missed, so a `pnpm test` run with the
 * development `DATABASE_URL` still re-seeded the development database.
 *
 * A setup file cannot be forgotten by a new test file, which is the whole
 * point: the guard now applies to files nobody has written yet.
 *
 * See `scripts/src/test-support/database-url.ts` for the rule and the
 * `ALLOW_DESTRUCTIVE_TESTS=1` escape hatch.
 */

import { destructiveTestDatabaseUrl } from "./scripts/src/test-support/database-url.js";

destructiveTestDatabaseUrl();
