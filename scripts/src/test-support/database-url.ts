const TEST_DATABASE_SUFFIX = "_test";
const OVERRIDE_ENV_VAR = "ALLOW_DESTRUCTIVE_TESTS";

export function databaseNameFrom(connectionString: string): string | null {
  try {
    const path = new URL(connectionString).pathname.replace(/^\//, "");
    return path === "" ? null : decodeURIComponent(path);
  } catch {
    return null;
  }
}

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
