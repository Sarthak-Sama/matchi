/**
 * The one place the DB-backed test suites resolve `DATABASE_URL`.
 *
 * These suites are genuinely destructive: `seed.test.ts` runs `seed.ts`,
 * which issues `TRUNCATE ... RESTART IDENTITY CASCADE` against
 * `DATABASE_URL`'s real `public` schema, and `derive.test.ts` re-derives
 * over whatever it finds. That is fine against a scratch database and
 * catastrophic against a working one — running `pnpm test` with a `.env`
 * that points at the development database wipes it, and `pnpm db:seed`
 * afterwards restores *fixtures*, not whatever real data had been imported
 * into it. That failure has already happened once in this repo.
 *
 * So a destructive suite may only ever run against a database whose name
 * marks it as disposable:
 *
 *   - `DATABASE_URL` unset            -> skip (the pre-existing behaviour)
 *   - database name ends in `_test`   -> run
 *   - anything else                   -> throw, loudly, before connecting
 *
 * Throwing rather than skipping is deliberate. A skip would let a
 * misconfigured run report green while silently exercising none of the
 * integration coverage, which is the same accident wearing a friendlier
 * face. `ALLOW_DESTRUCTIVE_TESTS=1` is the deliberate escape hatch for a
 * scratch database that doesn't follow the naming convention; it has to be
 * typed on purpose, which is the entire point.
 */

const TEST_DATABASE_SUFFIX = "_test";
const OVERRIDE_ENV_VAR = "ALLOW_DESTRUCTIVE_TESTS";

/** The database name from a postgres connection string, or null if unparseable. */
export function databaseNameFrom(connectionString: string): string | null {
  try {
    const path = new URL(connectionString).pathname.replace(/^\//, "");
    return path === "" ? null : decodeURIComponent(path);
  } catch {
    return null;
  }
}

/**
 * Resolves the connection string for a destructive integration suite.
 *
 * Returns `undefined` when `DATABASE_URL` is unset, so callers keep their
 * existing "skip with an explanatory sentinel" behaviour. Throws when
 * `DATABASE_URL` points at a database this suite must not be allowed to
 * reset.
 */
export function destructiveTestDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const connectionString = env["DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") return undefined;
  if (env[OVERRIDE_ENV_VAR] === "1") return connectionString;

  const name = databaseNameFrom(connectionString);
  if (name !== null && name.endsWith(TEST_DATABASE_SUFFIX)) return connectionString;

  const described = name === null ? "an unparseable DATABASE_URL" : `database "${name}"`;
  throw new Error(
    `Refusing to run destructive integration tests against ${described}. These suites TRUNCATE ` +
      `and re-seed DATABASE_URL's public schema, so they must target a disposable database whose ` +
      `name ends in "${TEST_DATABASE_SUFFIX}".\n` +
      `  Run:  DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test\n` +
      `If this database really is disposable, set ${OVERRIDE_ENV_VAR}=1 to override.`,
  );
}
