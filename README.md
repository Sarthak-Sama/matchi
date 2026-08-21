# Tokyo Neighborhood Optimizer

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
- A PostGIS-enabled PostgreSQL instance, started either way below.

## 1. Start PostGIS

Pick one:

**Docker Compose**

```bash
docker compose up -d
```

This starts a single `postgis/postgis:16-3.4` container (`tokyo-postgis`)
with user/password/db all set to `tokyo`, exposed on `localhost:5432`.

**Homebrew (local install, no Docker)**

```bash
brew install postgresql@17 postgis
brew services start postgresql@17
createuser tokyo --superuser --pwprompt   # set password: tokyo
createdb tokyo --owner=tokyo
psql tokyo -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

Either way, the app expects `DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo`
(see `.env.example`). Integration tests use a second database, `tokyo_test`,
with the same credentials:

```bash
createdb tokyo_test --owner=tokyo   # Homebrew install only; Docker Compose
                                     # only provisions `tokyo` — create this
                                     # database inside the container instead
psql tokyo_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql tokyo_test -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

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

`pnpm db:migrate` also supports `--dry-run`, which prints which migration
files would be applied without running them:

```bash
DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo pnpm db:migrate --dry-run
```

## Data sources

- Map data: © OpenStreetMap contributors
- MLIT (Ministry of Land, Infrastructure, Transport and Tourism) — real
  estate transaction and land price data
- e-Stat — official Japanese government statistics
- ODPT (Open Data Platform for Transportation) — Tokyo-area transit data
