# Matchi

**Meet your Matchi.** Find the Tokyo neighborhood that fits your life.

A tool for scoring and ranking Tokyo neighborhoods against a person's
commute, budget, and lifestyle preferences. Fastify API + PostGIS backend,
minimal Next.js frontend. See `docs/plans/spec.md` for the full product spec.

## Stack

- pnpm workspaces (`web`, `api`, `shared`, `scripts`) — no Turborepo.
- TypeScript everywhere, strict, ESM, Node 22.
- PostgreSQL + PostGIS for spatial storage and queries.
- Fastify for the API, Next.js (App Router) for the frontend.
- `pg` with plain SQL — no ORM.

## Prerequisites

- Node.js >= 22, pnpm 11.5.1 (see `packageManager` in `package.json`).
- A PostGIS-enabled PostgreSQL database. The project runs against a hosted
  Neon database by default; a local instance is still supported for offline
  work and is required for the destructive integration suites.

## 1. Connect a database

**Neon (hosted) — the default**

The project runs against a Neon Postgres 18 database with PostGIS 3.6
installed — there is nothing to start. `.env.example` carries the shape of
the two connection strings with placeholders; fill them in from the Neon
console (Connection Details) and keep them in `.env`, which is gitignored.
Never commit a real connection string: it contains the password.

- `DATABASE_URL` — the **direct** endpoint, without `-pooler` in the
  hostname. This is what everything uses.
- `DATABASE_URL_POOLED` — the same database behind Neon's PgBouncer. Not
  used by default.

**Use the direct endpoint.** The API is a long-running server with a bounded
pool of its own (max 10), so PgBouncer buys it nothing — and the pooler
shares server connections between clients, which leaks session state. A
`pg_dump` restore leaves `search_path` set to `''`, and every later pooled
client inherits it, at which point every unqualified table name in this
codebase stops resolving. Pinning `options=-c search_path=public` does not
help: Neon's pooler rejects that startup parameter and tells you to use an
unpooled connection. The pooled endpoint becomes the right choice only for a
serverless deployment with many short-lived connections, and only once every
query schema-qualifies its tables.

Both strings use `sslmode=require`, not `verify-full`: libpq (`psql`,
`pg_dump`) refuses `verify-full` without an explicit `sslrootcert`, so it
would break every command-line tool. Certificate verification is pinned in
code instead — see `shared/src/server/database-ssl.ts`, which sets
`rejectUnauthorized` for any non-loopback host regardless of what the
connection string says.

**Local PostGIS — for offline work and the integration tests**

Pick one:

```bash
docker compose up -d
```

This starts a single `postgis/postgis:16-3.4` container (`tokyo-postgis`)
with user/password/db all set to `tokyo`, exposed on `localhost:5432`.

```bash
brew install postgresql@17 postgis
brew services start postgresql@17
createuser tokyo --superuser --pwprompt   # set password: tokyo
createdb tokyo --owner=tokyo
psql tokyo -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

Then point `DATABASE_URL` at
`postgresql://tokyo:tokyo@localhost:5432/tokyo` and run `pnpm db:migrate`.

The destructive integration suites refuse to run against any database whose
name does not end in `_test` (see
`scripts/src/test-support/database-url.ts`), which is what keeps them away
from the hosted database. They need a local one:

```bash
createdb tokyo_test --owner=tokyo   # Homebrew install only; Docker Compose
                                     # only provisions `tokyo` — create this
                                     # database inside the container instead
psql tokyo_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql tokyo_test -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

### Moving data between the two

The schema and all imported data move with a plain dump and restore. Two
things bite:

- **Strip `COMMENT ON EXTENSION`.** On managed Postgres the database owner
  does not own the extensions, and those statements fail.
- **`pg_dump` must be at least the server's major version.** Neon runs
  Postgres 18; a Homebrew `postgresql@17` client refuses to dump from it
  ("aborting because of server version mismatch"). Dumping _to_ Neon from a
  local 17 server is fine — it is reading from 17 — but dumping _from_ Neon
  needs `brew install postgresql@18`.

```bash
pg_dump "postgresql://tokyo:tokyo@localhost:5432/tokyo" --no-owner --no-privileges \
  --exclude-table=public.spatial_ref_sys -f tokyo.sql
grep -v "^COMMENT ON EXTENSION" tokyo.sql > tokyo.neon.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f tokyo.neon.sql
pnpm data:validate
```

Note that the restore sets `search_path` to `''` on its connection, which is
one of the reasons the pooled endpoint is not the default.

## 2. Install dependencies

```bash
pnpm install
cp .env.example .env
```

## 3. Load and derive data

```bash
pnpm db:migrate   # apply SQL migrations in db/migrations
pnpm db:seed      # load imported source data
pnpm derive       # compute derived neighborhood metrics
```

## 4. Run the app

```bash
pnpm dev:api   # Fastify API
pnpm dev:web   # Next.js frontend
```

## Testing

`pnpm test` runs the Vitest suite. Most tests are pure unit tests and need
no setup. Database integration tests (e.g. `scripts/src/migrate.test.ts`)
read `DATABASE_URL` directly from the environment — no `.env` loading — and
`describe`/`it.skip` themselves with an explicit message when it's unset, so
they never silently pass. Point `DATABASE_URL` at `tokyo_test` (not the dev
database) to run them:

```bash
DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test
```

With `DATABASE_URL` unset — or pointing at the hosted database, whose name
does not end in `_test` — those suites skip rather than run, and `pnpm test`
still exercises everything that does not need a database.

`pnpm db:migrate` also supports `--dry-run`, which prints which migration
files would be applied without running them:

```bash
pnpm db:migrate --dry-run
```

## Data sources

- Map data: © OpenStreetMap contributors
- MLIT (Ministry of Land, Infrastructure, Transport and Tourism) — real
  estate transaction and land price data
- e-Stat — official Japanese government statistics
- ODPT (Open Data Platform for Transportation) — Tokyo-area transit data
