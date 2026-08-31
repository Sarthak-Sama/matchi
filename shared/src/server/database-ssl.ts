const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface DatabaseSslPolicy {
  readonly ssl: { readonly rejectUnauthorized: true } | false;
}

export function databaseSslFor(connectionString: string): DatabaseSslPolicy["ssl"] {
  const host = hostOf(connectionString);
  return host !== null && LOOPBACK_HOSTS.has(host) ? false : { rejectUnauthorized: true };
}

function hostOf(connectionString: string): string | null {
  const match = /^[a-z+]+:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(connectionString);
  return match?.[1]?.toLowerCase() ?? null;
}
