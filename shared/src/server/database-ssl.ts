/**
 * The TLS policy for outbound PostgreSQL connections.
 *
 * `sslmode` in a connection string does not mean the same thing to every
 * client, which makes it the wrong place to express a security decision:
 *
 *   - libpq (`psql`, `pg_dump`) reads `require` as "encrypt, do not verify",
 *     and will only verify with an explicit `sslrootcert`. It rejects
 *     `verify-full` outright unless one is configured.
 *   - `node-postgres` currently treats `require` as a full-verification
 *     alias — and warns that it intends to adopt libpq's meaning in a
 *     future major, which would silently drop certificate verification.
 *
 * So the connection string stays `sslmode=require`, which every client
 * accepts, and Node pins the actual policy here instead: verify the
 * server certificate against the system trust store. A managed provider
 * (Neon, RDS, Supabase) presents a publicly trusted certificate, so this
 * needs no bundled CA file.
 *
 * Local development over a loopback socket gets no TLS, because a local
 * PostGIS container does not serve one.
 *
 * Exported from `@tokyo/shared/server` rather than the package root: the
 * browser bundle imports `@tokyo/shared`, and a database connection policy
 * has no business travelling to it.
 */

/** Hosts for which TLS is neither available nor meaningful. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface DatabaseSslPolicy {
  /** `pg`'s `ssl` option: verified TLS, or none at all. */
  readonly ssl: { readonly rejectUnauthorized: true } | false;
}

/**
 * Resolves the TLS policy for a connection string. Anything that is not a
 * loopback host is treated as remote and must present a valid certificate;
 * an unparseable string is treated as remote, because failing closed is
 * the safe direction.
 */
export function databaseSslFor(connectionString: string): DatabaseSslPolicy["ssl"] {
  const host = hostOf(connectionString);
  return host !== null && LOOPBACK_HOSTS.has(host) ? false : { rejectUnauthorized: true };
}

/**
 * The hostname from a postgres URL, or null if it cannot be read.
 *
 * Hand-rolled rather than `new URL()` so this module depends on no runtime
 * lib types at all, and can therefore live in a package that is type-checked
 * without DOM or Node globals.
 */
function hostOf(connectionString: string): string | null {
  const match = /^[a-z+]+:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(connectionString);
  return match?.[1]?.toLowerCase() ?? null;
}
