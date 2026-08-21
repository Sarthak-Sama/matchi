# Implementation Plan — Tokyo Neighborhood Optimizer (Lean Portfolio MVP)

Spec: `docs/plans/spec.md` (binding authority). Where this plan and the spec
disagree, the spec wins.

## Global Constraints

These bind every task. Reviewers must check them on every diff.

**Stack and layout (exact).** One repository, pnpm workspaces, no Turborepo.
Directories exactly:

```text
/web                 Next.js application
/api                 Fastify application
/shared              Zod contracts and shared TypeScript types
/scripts             Import and derived-data scripts
/db/migrations       SQL migrations
/data                Gitignored downloaded source files
/docker-compose.yml  Local PostGIS only
```

**Language.** TypeScript everywhere, `strict: true`, ESM (`"type": "module"`),
Node 22. Target `ES2022`, module resolution `bundler` for web and
`NodeNext`/`node16`-compatible for api/scripts. No `any` in exported
signatures. No default exports except where Next.js requires them.

**Database.** PostgreSQL 15+ with PostGIS 3. SRID 4326 for all stored
geometry. Distance and area work uses `geography` casts or
`ST_Transform(..., 6677)` (JGD2011 / Japan Plane Rectangular CS IX, the
correct plane for Tokyo) — never raw degrees for metres.

**Do NOT add:** Redis, BullMQ, a worker service, object storage, dataset
versioning/snapshots, RAPTOR, full GTFS persistence, generated API clients,
enterprise monitoring, a general-purpose UI component library, an ORM
(use `pg` with plain SQL), or any auth/accounts system.

**Single source of truth for constants.** Every formula constant, threshold,
weight, layout size, speed, penalty, and clamp bound lives in exactly one
module: `shared/src/config/scoring.ts`. API code, scripts, and the frontend
methodology text all import from it. A numeric literal from the spec
appearing anywhere else is a defect.

**Rent language.** Every rent value produced or displayed is labelled
"modeled area rent" (or "estimate"/"range"). The strings "available rent",
"listing", "for rent", or anything implying real inventory must never appear
in user-facing output.

**Confidence.** Anything derived from fallback assumptions (no land-price
points, speed-model rail edges, stale rent vintage) carries an explicit
lowered confidence value that reaches the API response.

**Testing.** Vitest for unit and integration tests. Every task that adds
logic adds tests in the same commit. Tests must assert real values — a test
that only asserts "no throw" or `expect(true).toBe(true)` is a defect.
Integration tests that need PostGIS read `DATABASE_URL` from the environment
and skip with a clear message when it is unset; they must never silently pass.

**Frontend effort (user directive, binding).** The backend is the
deliverable. The frontend is minimal and functional only: no MapLibre map,
no visual polish, no Playwright suite, no design system. Ship a working
three-step form plus a ranked results list. Do not spend effort on styling
beyond plain Tailwind utility classes.

**Environment reality (controller ruling, see ledger).** Docker is not
installed on this machine; `docker-compose.yml` is still written exactly as
the spec requires, and PostGIS is additionally available locally via
Homebrew for running integration tests. Never assume network access to
MLIT/e-Stat/ODPT/Overpass at test time — all import tests run from
committed fixtures.

**Commits.** Conventional-commit style messages, one logical commit per
coherent chunk. Never commit `/data`. Never commit secrets.

---

## Task 1: Repository scaffolding and toolchain

Create the monorepo skeleton. No application logic in this task.

**Files to create**

- `package.json` (root): `"private": true`, `"type": "module"`,
  `"packageManager": "pnpm@11.5.1"`, `engines.node: ">=22"`.
  Scripts (placeholders that will be filled by later tasks are fine, but
  every name below must already exist and resolve):
  - `"dev:api": "pnpm --filter @tokyo/api dev"`
  - `"dev:web": "pnpm --filter @tokyo/web dev"`
  - `"build": "pnpm -r build"`
  - `"typecheck": "pnpm -r typecheck"`
  - `"lint": "eslint ."`
  - `"format": "prettier --write ."`
  - `"test": "vitest run"`
  - `"db:migrate": "tsx scripts/src/migrate.ts"`
  - `"db:seed": "tsx scripts/src/seed.ts"`
  - `"derive": "tsx scripts/src/derive.ts"`
  - `"import:mlit": "tsx scripts/src/import-mlit.ts"`
  - `"import:rent": "tsx scripts/src/import-rent.ts"`
  - `"import:osm": "tsx scripts/src/import-osm.ts"`
  - `"import:transit": "tsx scripts/src/import-transit.ts"`
  For this task only, the five `tsx` targets may be one-line stub files that
  `console.log("not implemented")` and `process.exit(1)`. `migrate`/`seed`/
  `derive` stubs likewise.
- `pnpm-workspace.yaml` listing `web`, `api`, `shared`, `scripts`.
- `tsconfig.base.json` with `strict: true`, `target: "ES2022"`,
  `lib: ["ES2022"]`, `moduleDetection: "force"`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: false`, `skipLibCheck: true`,
  `verbatimModuleSyntax: true`, `isolatedModules: true`.
- `shared/package.json` (`@tokyo/shared`), `api/package.json` (`@tokyo/api`),
  `scripts/package.json` (`@tokyo/scripts`), `web/package.json` (`@tokyo/web`).
  Each with its own `tsconfig.json` extending the base and a `typecheck`
  script (`tsc --noEmit`). `@tokyo/shared` is consumed by the others via
  `"@tokyo/shared": "workspace:*"`. `@tokyo/shared` exports from
  `./src/index.ts` — configure `exports` so `import { x } from "@tokyo/shared"`
  works under Node ESM and under Next.js. Prefer publishing TypeScript source
  through `exports` plus a `build` script emitting `dist/` with declarations;
  whichever you choose must make `pnpm -r typecheck` and `pnpm -r build` pass.
- `web/` — Next.js 15 App Router app, TypeScript, Tailwind v4, created by hand
  (not `create-next-app` interactive). Minimum: `next.config.ts`,
  `app/layout.tsx`, `app/page.tsx` rendering the literal text
  `Tokyo Neighborhood Optimizer`, `app/globals.css` with the Tailwind import,
  `postcss.config.mjs`. `pnpm --filter @tokyo/web build` must succeed.
- `api/src/index.ts` — a one-line stub for now (Task 4 replaces it).
- `db/migrations/.gitkeep`.
- `data/.gitkeep`.
- `docker-compose.yml` — exactly one service, PostGIS only:
  image `postgis/postgis:16-3.4`, container name `tokyo-postgis`,
  env `POSTGRES_USER=tokyo`, `POSTGRES_PASSWORD=tokyo`,
  `POSTGRES_DB=tokyo`, port mapping `5432:5432`, named volume
  `tokyo-pgdata:/var/lib/postgresql/data`, and a `pg_isready` healthcheck.
- `.gitignore` — must ignore `node_modules`, `.next`, `dist`, `.env`,
  `.env.local`, `data/*` (with `!data/.gitkeep`), `coverage`, `*.log`,
  `.DS_Store`.
- `.env.example` — documents `DATABASE_URL`, `PORT`, `API_BASE_URL`,
  `NEXT_PUBLIC_API_BASE_URL`, `LOG_LEVEL`, and placeholders for
  `MLIT_API_KEY`, `ESTAT_APP_ID`, `ODPT_ACCESS_TOKEN` with a comment that all
  three are optional and only needed for live imports.
- `vitest.config.ts` at root — projects/workspace covering `shared`, `api`,
  `scripts`; `environment: "node"`; `globals: false` (import from `vitest`
  explicitly).
- `eslint.config.js` (flat config) with `typescript-eslint` recommended and
  `prettier` config, ignoring `dist`, `.next`, `node_modules`.
- `.prettierrc` — 2-space indent, double quotes, semicolons, trailing commas
  `all`, print width 100.
- `README.md` — short: what the project is, how to start PostGIS
  (`docker compose up -d` OR local Homebrew PostGIS), how to run
  `pnpm db:migrate`, `pnpm db:seed`, `pnpm derive`, `pnpm dev:api`,
  `pnpm dev:web`. Include the OpenStreetMap attribution line
  `© OpenStreetMap contributors` and note MLIT / e-Stat / ODPT as sources.

**Also add** a single trivial test (e.g. `shared/src/index.test.ts`) that
imports the workspace package and asserts a real exported value, so
`pnpm test` is green and wired up.

**Verification (must all pass and be reported with output)**

```bash
pnpm install
pnpm -r typecheck
pnpm lint
pnpm test
pnpm --filter @tokyo/web build
```

**Out of scope:** any domain logic, any SQL, any real API route.

---

## Task 2: Shared contracts and the single scoring-config module

Everything in `/shared`. This task defines the vocabulary the whole system
uses, so exact names and values matter more than anything else here.

### 2a. `shared/src/config/scoring.ts` — the only home for constants

Export these as `const` objects with `as const` where useful, all typed:

**Layouts** — id, label, min m², max m², midpoint m². Exact table:

| id | label | min | max | mid |
|---|---|---:|---:|---:|
| `1R` | `1R` | 18 | 25 | 21 |
| `1K` | `1K` | 20 | 28 | 24 |
| `1DK` | `1DK` | 25 | 35 | 30 |
| `1LDK` | `1LDK` | 32 | 45 | 38 |
| `2K_2DK` | `2K/2DK` | 35 | 50 | 43 |
| `2LDK` | `2LDK` | 45 | 65 | 55 |
| `3LDK` | `3LDK` | 60 | 80 | 70 |

Export `LAYOUTS` as a record keyed by id and `LAYOUT_IDS` as a readonly tuple
in the order above.

**Rent estimator constants**
- `LOW_ESTIMATE_FACTOR = 0.90` (applied to layout min m²)
- `HIGH_ESTIMATE_FACTOR = 1.10` (applied to layout max m²)
- `LAND_PRICE_MULTIPLIER_EXPONENT = 0.25`
- `LAND_PRICE_MULTIPLIER_MIN = 0.85`
- `LAND_PRICE_MULTIPLIER_MAX = 1.15`
- `MIN_LAND_PRICE_POINTS = 3` (below this, multiplier is exactly `1.0` and
  confidence drops)

**Catchment**
- `CATCHMENT_RADIUS_M = 800`
- `CATCHMENT_LABEL = "approximate 10-minute station area"`

**Commute constants**
- `ACCESS_WALK_MINUTES = 8` (fixed neighborhood-to-station walk)
- `TRANSFER_PENALTY_MINUTES = 5`
- `PEAK_WAIT_MINUTES = 4`
- `OFFPEAK_WAIT_MINUTES = 6`
- `PEAK_WINDOW = { startMinutes: 7 * 60 + 30, endMinutes: 10 * 60 }`
  (07:30–10:00 inclusive of start, exclusive of end)
- `FALLBACK_SPEEDS_KMH = { subway: 28, local_rail: 28, commuter_rail: 35, monorail: 30 }`
- `DWELL_SECONDS_PER_INTERMEDIATE_STATION = 45`

**Scoring weights**
- `OVERALL_WEIGHTS = { affordability: 0.30, commute: 0.30, lifestyle: 0.40 }`
  (must sum to 1; assert this in a test)
- `IMPORTANCE_VALUES = { low: 1, medium: 2, high: 4, essential: 8 }`

**Quietness proxy weights**
- `QUIETNESS_WEIGHTS = { residentialZoningShare: 0.50, inverseRoadRailExposure: 0.30, inverseNightlifeDensity: 0.20 }`
  (must sum to 1; assert this in a test)

**Amenity weights** (supermarket-equivalent weighting)
- `AMENITY_WEIGHTS = { supermarket: 1.0, grocery: 0.5, convenience: 0.25 }`

**Labels**
- `RENT_LABEL = "modeled area rent"`
- `COMMUTE_LABEL = "typical weekday estimate"`
- `QUIETNESS_LABEL = "quietness proxy"`

Also export a `Confidence` type `"high" | "medium" | "low"` and a helper
`lowerConfidence(c: Confidence): Confidence` that steps high→medium→low→low.

### 2b. `shared/src/contracts/` — Zod schemas + inferred types

Use Zod v4. Define and export both the schema and the inferred type for each.

- `importanceSchema` = `z.enum(["low","medium","high","essential"])`;
  `type Importance`.
- `layoutSchema` = `z.enum(LAYOUT_IDS)`; `type Layout`.
- `optimizationRequestSchema` matching the spec exactly:
  - `destinationStationGroupId: z.string().min(1)`
  - `arrivalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)` — 24h `HH:MM`
  - `monthlyBudgetYen: z.number().int().positive().max(10_000_000)`
  - `layout: layoutSchema`
  - `maxCommuteMinutes: z.number().int().min(5).max(180)`
  - `preferences: z.object({ floodSafety, supermarkets, restaurants, quietness })`
    each `importanceSchema`
  - `.strict()` so unknown keys are rejected.
  - `type OptimizationRequest = z.infer<...>` — it must be structurally
    assignable to the interface written in the spec §4.
- Response schemas (define these; they are the API's public shape):
  - `factorEvidenceSchema`: `{ key: string, label: string, rawValue: number,
    rawValueLabel: string, componentScore: number (0-100),
    effectiveWeight: number, pointContribution: number,
    sourceDate: string | null, confidence: Confidence,
    explanation: string, direction: "positive" | "negative" | "neutral" }`
  - `rentEstimateSchema`: `{ lowYen, medianYen, highYen, layout,
    assumedSizeSqmMin, assumedSizeSqmMax, assumedSizeSqmMid,
    managementFeeYen, wardRentPerSqmYen, landPriceMultiplier,
    landPricePointCount, source: string, sourcePeriod: string,
    confidence, label: string }` — `label` is `RENT_LABEL`.
  - `commuteEstimateSchema`: `{ totalMinutes, accessWalkMinutes, railMinutes,
    waitMinutes, transferCount, transferPenaltyMinutes, confidence,
    label: string, path: Array<{ stationGroupId, nameEn, nameJa, lineName: string | null }> }`
  - `neighborhoodResultSchema`: `{ rank, stationGroupId, nameEn, nameJa,
    wardCode, wardNameEn, wardNameJa, centroid: { lat, lon },
    overallScore (0-100), rent: rentEstimateSchema,
    commute: commuteEstimateSchema, factors: factorEvidenceSchema[],
    reasonsFor: string[], reasonsAgainst: string[],
    catchmentLabel: string }`
  - `optimizeResponseSchema`: `{ results: neighborhoodResultSchema[],
    diagnostics: { candidatesConsidered, excludedByRent, excludedByCommute,
      excludedByDisconnected, feasibleCount, suggestion: string | null },
    request: optimizationRequestSchema, dataVintages: Array<{ source, sourceUpdatedAt: string | null, importedAt: string | null }> }`
  - `stationSuggestionSchema`: `{ stationGroupId, nameEn, nameJa,
    aliases: string[], lines: string[], lat, lon }`
  - `dataStatusSchema`: `{ sources: Array<{ source, status, sourceUpdatedAt: string | null,
    importedAt: string | null, rowsImported: number | null, error: string | null }> }`
- `shared/src/index.ts` re-exports everything from `config/scoring.ts` and
  `contracts/`.

### 2c. Tests (`shared/src/**/*.test.ts`)

- `OVERALL_WEIGHTS` values sum to exactly 1.
- `QUIETNESS_WEIGHTS` values sum to exactly 1.
- Every entry in `LAYOUTS`: `min < mid < max`, and the seven ids match
  `LAYOUT_IDS` exactly with the exact numbers in the table above (assert the
  literal numbers, not a re-derivation).
- `IMPORTANCE_VALUES` equals `{low:1, medium:2, high:4, essential:8}`.
- `lowerConfidence` steps correctly, and `lowerConfidence("low") === "low"`.
- `optimizationRequestSchema` accepts a valid request; rejects: bad
  `arrivalTime` (`"25:00"`, `"9:00"`), non-integer budget, zero/negative
  budget, `maxCommuteMinutes` of 4 and 181, an unknown layout, an unknown
  importance value, and an extra unknown top-level key.

**Verification:** `pnpm -r typecheck`, `pnpm lint`, `pnpm test`.

---

## Task 3: PostGIS schema and migration runner

### 3a. Migration runner — `scripts/src/migrate.ts`

Plain SQL migrations, applied in filename order, tracked in a
`schema_migrations` table (`filename text primary key, applied_at timestamptz
not null default now()`). Behaviour:

- Reads `DATABASE_URL`; exits 1 with a clear message if unset.
- Creates `schema_migrations` if absent.
- Applies each unapplied `db/migrations/*.sql` in lexicographic order, each
  file inside its own transaction, recording the filename on success.
- Logs `applied <filename>` per file and `up to date` when nothing to do.
- Supports `--dry-run` printing what would be applied.
- Idempotent: running twice applies nothing the second time.

Add a small shared DB helper `scripts/src/lib/db.ts` exporting a `pg.Pool`
factory reading `DATABASE_URL`, plus `withTransaction(pool, fn)`.

### 3b. `db/migrations/0001_init.sql`

`CREATE EXTENSION IF NOT EXISTS postgis;` then all tables below. All geometry
columns are SRID 4326. Use `timestamptz` for all timestamps. Use
`generated always as identity` or `bigserial` for surrogate keys.

- `import_runs(id, source text not null, source_updated_at timestamptz,
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null check (status in ('running','success','failed')),
  rows_imported integer, error text)`
- `wards(ward_code text primary key, name_ja text not null, name_en text not null,
  geom geometry(MultiPolygon,4326) not null, source text, source_updated_at timestamptz,
  imported_at timestamptz not null default now())`
- `station_groups(station_group_id text primary key, name_ja text not null,
  name_en text not null, aliases text[] not null default '{}',
  point geometry(Point,4326) not null, ward_code text references wards(ward_code),
  source text, source_updated_at timestamptz, imported_at timestamptz not null default now())`
- `station_source_refs(id, station_group_id text not null references station_groups
  on delete cascade, source text not null, source_id text not null,
  source_name text, unique (source, source_id))`
- `rail_lines(rail_line_id text primary key, operator text not null, name_ja text not null,
  name_en text, mode text not null check (mode in ('subway','local_rail','commuter_rail','monorail')),
  geom geometry(MultiLineString,4326), source text, source_updated_at timestamptz,
  imported_at timestamptz not null default now())`
- `rail_edges(id, from_station_group_id text not null references station_groups,
  to_station_group_id text not null references station_groups,
  rail_line_id text references rail_lines, edge_type text not null
  check (edge_type in ('ride','transfer')),
  peak_travel_minutes double precision not null check (peak_travel_minutes >= 0),
  offpeak_travel_minutes double precision not null check (offpeak_travel_minutes >= 0),
  peak_wait_minutes double precision not null default 0,
  offpeak_wait_minutes double precision not null default 0,
  confidence text not null check (confidence in ('high','medium','low')),
  source text, source_updated_at timestamptz, imported_at timestamptz not null default now(),
  unique (from_station_group_id, to_station_group_id, rail_line_id, edge_type))`
  Note: `rail_line_id` is nullable and participates in the unique constraint;
  add a partial unique index for transfer edges where `rail_line_id is null`
  so duplicates are still prevented.
- `station_areas(station_group_id text primary key references station_groups on delete cascade,
  radius_m integer not null, geom geometry(Polygon,4326) not null,
  area_sqm double precision not null, derived_at timestamptz not null default now())`
- `rent_stats(id, ward_code text not null references wards(ward_code),
  period text not null, source text not null,
  rent_per_sqm_yen double precision not null check (rent_per_sqm_yen > 0),
  management_fee_yen double precision not null default 0,
  sample_count integer, source_updated_at timestamptz,
  imported_at timestamptz not null default now(),
  unique (ward_code, period, source))`
- `land_prices(id, point geometry(Point,4326) not null, price_yen_per_sqm double precision not null,
  year integer not null, use_category text, ward_code text references wards(ward_code),
  source text, source_updated_at timestamptz, imported_at timestamptz not null default now())`
- `zoning_areas(id, category text not null, is_residential boolean not null,
  geom geometry(MultiPolygon,4326) not null, source text, source_updated_at timestamptz,
  imported_at timestamptz not null default now())`
- `flood_zones(id, depth_category text not null, depth_rank integer not null,
  geom geometry(MultiPolygon,4326) not null, source text, source_updated_at timestamptz,
  imported_at timestamptz not null default now())`
- `pois(id, category text not null, name text, osm_type text, osm_id bigint,
  point geometry(Point,4326) not null, source text, source_updated_at timestamptz,
  imported_at timestamptz not null default now(), unique (osm_type, osm_id))`
- `major_roads(id, name text, road_class text not null, geom geometry(MultiLineString,4326) not null,
  source text, source_updated_at timestamptz, imported_at timestamptz not null default now())`
- `neighborhood_metrics(station_group_id text primary key references station_groups on delete cascade,
  ward_code text references wards(ward_code),
  rent_low_yen double precision, rent_median_yen double precision, rent_high_yen double precision,
  rent_confidence text, rent_source text, rent_source_period text,
  rent_per_sqm_yen double precision, management_fee_yen double precision,
  land_price_multiplier double precision, land_price_point_count integer,
  supermarket_count integer not null default 0, grocery_count integer not null default 0,
  convenience_count integer not null default 0, amenity_supermarket_equiv double precision not null default 0,
  restaurant_count integer not null default 0, cafe_count integer not null default 0,
  nightlife_count integer not null default 0,
  flood_share_by_category jsonb not null default '{}'::jsonb,
  flood_exposure_score double precision, residential_zoning_share double precision,
  road_rail_exposure_share double precision, quietness_raw double precision,
  norm_amenity_supermarket double precision, norm_amenity_restaurant double precision,
  norm_flood_safety double precision, norm_quietness double precision,
  source_dates jsonb not null default '{}'::jsonb,
  derived_at timestamptz not null default now())`
  The `norm_*` columns hold 0–100 normalized scores computed in `pnpm derive`.

**Indexes.** GiST on every geometry column
(`wards.geom`, `station_groups.point`, `rail_lines.geom`, `station_areas.geom`,
`land_prices.point`, `zoning_areas.geom`, `flood_zones.geom`, `pois.point`,
`major_roads.geom`). B-tree on `station_source_refs.station_group_id`,
`rail_edges.from_station_group_id`, `rail_edges.to_station_group_id`,
`rent_stats.ward_code`, `land_prices.ward_code`, `pois.category`,
`flood_zones.depth_rank`, `import_runs(source, started_at desc)`. A trigram or
`lower()` index on `station_groups.name_en` and `name_ja` for autocomplete
(use `pg_trgm`: `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and GIN trigram
indexes on `name_en`, `name_ja`).

### 3c. Tests

`scripts/src/migrate.test.ts` — an integration test guarded on `DATABASE_URL`:
runs the migrations against a scratch schema/database, asserts every table
above exists with the expected columns, asserts the PostGIS extension is
present, asserts the GiST indexes exist, and asserts a second run is a no-op.
When `DATABASE_URL` is unset the test must `skip` with an explicit message,
never pass silently.

**Verification:** run the migration against a real PostGIS instance and paste
`\dt` / `\di` output (or the equivalent query result) in the report.

---

## Task 4: Fastify API skeleton, config, DB pool, health

Everything in `/api`.

- `api/src/config.ts` — parse and validate environment with Zod:
  `DATABASE_URL` (required), `PORT` (default 4000), `HOST` (default
  `0.0.0.0`), `LOG_LEVEL` (default `info`), `CORS_ORIGIN` (default `*`),
  `NODE_ENV`. Fail fast with a readable message listing missing vars.
- `api/src/db.ts` — a `pg.Pool` with sensible `max` and timeouts, plus a
  `query` helper that logs slow queries (>500 ms) at `warn`.
- `api/src/app.ts` — exported `buildApp(deps)` returning a configured Fastify
  instance. Registers `@fastify/cors`, sets a request-id, uses Fastify's pino
  logger with `LOG_LEVEL`, and installs a global error handler that returns
  `{ error: { code, message, details? } }` — Zod validation failures map to
  HTTP 400 with `code: "VALIDATION_ERROR"` and flattened issue details;
  unexpected errors map to 500 with `code: "INTERNAL_ERROR"` and never leak a
  stack trace to the client (log it instead). `buildApp` must take its
  dependencies (pool, and later the transit graph) as arguments so tests can
  inject fakes — do not reach for module-level singletons.
- `api/src/server.ts` — the entrypoint: builds config, pool, app; listens;
  handles `SIGTERM`/`SIGINT` with graceful shutdown (close server, then pool).
- `api/src/routes/health.ts` — `GET /health` returning
  `{ status: "ok" | "degraded", uptimeSeconds, database: { reachable: boolean, latencyMs: number | null }, version }`.
  Returns 200 when the DB responds to `select 1`, 503 with
  `status: "degraded"` when it does not.
- `api/package.json` scripts: `dev` (tsx watch `src/server.ts`),
  `build` (`tsc`), `start` (`node dist/server.js`), `typecheck`.

**Tests** — `api/src/routes/health.test.ts` using `app.inject()` with an
injected fake pool: asserts 200 + `status: "ok"` on a healthy pool, and
503 + `status: "degraded"` when the pool query rejects. Also a test that the
error handler returns the documented 400 shape for a Zod failure and does not
include a stack trace in the body.

**Out of scope:** all `/v1` routes.

---

## Task 5: Vertical-slice seed data (~20 stations)

`scripts/src/seed.ts` plus fixture data under `scripts/src/fixtures/seed/`.
This gives every later task real data to test against without network access.

Seed, inside one transaction, truncating the tables it owns first:

- **4 wards** with realistic simplified polygons (`ward_code`, `name_ja`,
  `name_en`): `13113` 渋谷区 / Shibuya, `13104` 新宿区 / Shinjuku,
  `13112` 世田谷区 / Setagaya, `13110` 目黒区 / Meguro. Polygons may be
  simplified rectangles/octagons but must be valid, non-overlapping, in the
  correct real-world location, and large enough to contain their stations.
- **20 station groups** with real names (ja + en), real approximate
  coordinates, and correct ward assignment. Use these:
  Shibuya 渋谷, Ebisu 恵比寿, Daikanyama 代官山, Nakameguro 中目黒,
  Yutenji 祐天寺, Gakugei-daigaku 学芸大学, Toritsu-daigaku 都立大学,
  Jiyugaoka 自由が丘, Sasazuka 笹塚, Hatagaya 幡ヶ谷,
  Hatsudai 初台, Shinjuku 新宿, Yoyogi 代々木, Sangenjaya 三軒茶屋,
  Komazawa-daigaku 駒沢大学, Sakura-shinmachi 桜新町, Yoga 用賀,
  Meguro 目黒, Nakano 中野, Shimokitazawa 下北沢.
  `station_group_id` is a stable slug (e.g. `sg-shibuya`).
  Include at least three `aliases` across the set and at least four
  `station_source_refs` rows.
- **rail_lines**: at least 5 with correct `mode` values covering `subway`,
  `commuter_rail`, and `local_rail`.
- **rail_edges**: a connected graph over those 20 stations with plausible
  bidirectional `ride` edges along real line adjacency, plus `transfer` edges
  at Shibuya, Shinjuku, Meguro, and Nakameguro. Peak travel minutes must
  differ from off-peak for at least some edges (peak slightly slower).
  Give a handful of edges `confidence = 'low'` so downstream confidence
  reporting is exercised. **At least one station group must be deliberately
  disconnected from the rest** (add a 21st isolated station,
  `sg-isolated-test` / テスト孤立駅 / "Isolated Test", inside Setagaya, with
  no edges) so the disconnected hard filter has a fixture.
- **rent_stats**: one row per ward, `source = 'estat'`, `period = '2023'`,
  plausible `rent_per_sqm_yen` (Shibuya highest, Setagaya lowest) and
  `management_fee_yen`. Add one `source = 'reins'`, `period = '2026Q2'` row
  for Shibuya only, so source-preference logic has a fixture.
- **land_prices**: at least 60 points spread so that some catchments have
  ≥3 points and at least two catchments have <3 points (to exercise the
  `MIN_LAND_PRICE_POINTS` fallback). Prices must vary meaningfully within and
  between wards.
- **zoning_areas**: polygons covering the wards with a mix of residential and
  non-residential categories, such that residential share differs clearly
  between stations.
- **flood_zones**: at least 3 polygons with distinct `depth_category` /
  `depth_rank`, overlapping some catchments and not others.
- **pois**: at least 200 points across categories `supermarket`, `grocery`,
  `convenience`, `restaurant`, `cafe`, `bar`, distributed so counts differ
  clearly per station.
- **major_roads**: at least 3 multilinestrings passing near some stations and
  not others.

Fixtures may be committed as GeoJSON or as a TypeScript data module —
your choice, but the data must be readable and reviewable, and the geometry
must be genuinely valid (`ST_IsValid`).

`pnpm db:seed` must be idempotent (re-running yields the same row counts) and
must print a per-table row-count summary.

**Tests** — `scripts/src/seed.test.ts`, guarded on `DATABASE_URL`: runs
migrate + seed, then asserts the expected row counts per table, asserts every
geometry is valid via `ST_IsValid`, asserts every station falls inside its
declared ward via `ST_Contains`, asserts the rail graph is connected except
for `sg-isolated-test`, and asserts a second seed run leaves counts unchanged.

---

## Task 6: Rent estimator

`shared/src/domain/rent.ts` — pure functions, no database access, no
dependencies beyond `@tokyo/shared`'s own config module. Re-export it from
`shared/src/index.ts`.

**Placement note (controller ruling):** the spec placed this in `api/`, but
Task 7's `derive` script (package `@tokyo/scripts`) must call the exact same
functions, and `scripts` depending on `api` inverts the dependency graph. The
rent estimator is pure and therefore belongs in `@tokyo/shared` alongside the
constants it uses. Both `api` and `scripts` import it from there. Do not
duplicate the formula anywhere.

Implement exactly the spec formula:

```text
ward rent/m2 x assumed layout size x station land-price multiplier + ward management fee
```

- `computeLandPriceMultiplier({ catchmentMedianLandPrice, wardMedianLandPrice, pointCount })`
  returns `{ multiplier, usedFallback }`. When `pointCount < MIN_LAND_PRICE_POINTS`
  or either median is missing/non-positive, return `{ multiplier: 1.0,
  usedFallback: true }`. Otherwise
  `clamp((catchment / ward) ** 0.25, 0.85, 1.15)`.
- `estimateRent(input)` where input carries `layout`, `wardRentPerSqmYen`,
  `managementFeeYen`, `landPriceMultiplier`, `landPricePointCount`,
  `source`, `sourcePeriod`, `baseConfidence`. Returns the
  `rentEstimateSchema` shape:
  - `medianYen = round(wardRentPerSqm * layout.mid * multiplier + managementFee)`
  - `lowYen = round(wardRentPerSqm * layout.min * LOW_ESTIMATE_FACTOR * multiplier + managementFee)`
  - `highYen = round(wardRentPerSqm * layout.max * HIGH_ESTIMATE_FACTOR * multiplier + managementFee)`
  - The management fee is added to all three (it is NOT scaled by the
    multiplier or by area).
  - Round to the nearest yen (`Math.round`).
  - `confidence`: start from `baseConfidence`; call `lowerConfidence` once if
    the land-price fallback was used; call it again if the rent source period
    is older than the current year by more than 2 years (pass the current year
    in, do not read the clock inside the function).
  - `label` is always `RENT_LABEL`.
  - Assert `lowYen <= medianYen <= highYen` and throw a descriptive error if
    the invariant is violated by bad inputs.
- `pickRentStat(stats, { currentYear })` — given rows for one ward, prefer the
  most recent `reins` row if one exists and is not older than 2 years,
  otherwise the most recent `estat` row. Returns the row plus a
  `baseConfidence` (`high` for a `reins` row within 2 years, `medium` for a
  recent `estat` row, `low` for anything older than 5 years).

**Tests** — `shared/src/domain/rent.test.ts`, with hand-computed expected values
written as literals (do not re-implement the formula in the test):

- A worked example per layout for one fixed ward rent/m² and fee.
- Multiplier clamping at both bounds, and the exact `0.25` exponent
  (e.g. ratio 16 → 2.0 → clamped to 1.15; ratio 1.1 → `1.1**0.25`).
- `pointCount = 2` yields multiplier exactly 1.0 and a lowered confidence.
- `pointCount = 3` uses the real multiplier.
- Management fee added to low, median, and high — verify by differencing two
  runs with different fees.
- `low <= median <= high` for every layout.
- `pickRentStat` prefers a recent REINS row, falls back to e-Stat, and
  downgrades confidence for a stale vintage.

---

## Task 7: Derive script — catchments, metrics, normalization, rent

`scripts/src/derive.ts` plus `scripts/src/derive/*.ts` steps. This is where
PostGIS does the heavy lifting. Runs in one transaction per step, logs each
step's duration and row counts, and is fully idempotent (re-running produces
identical results).

**Step 1 — station catchments → `station_areas`.**
For every `station_groups` row, build an 800 m circular catchment. Use
`ST_Buffer(point::geography, CATCHMENT_RADIUS_M)::geometry` (or the
equivalent via `ST_Transform` to EPSG:6677, buffer, transform back) so the
radius is genuine metres. Store `radius_m = 800`, the polygon (SRID 4326),
and `area_sqm` computed with `ST_Area(geom::geography)`. Delete-and-rebuild.

**Step 2 — amenity counts.** For each station area, count `pois` within the
catchment using `ST_DWithin(point::geography, station.point::geography, 800)`
(this must use the GiST index — verify with `EXPLAIN` and report the plan).
Populate `supermarket_count`, `grocery_count`, `convenience_count`,
`restaurant_count`, `cafe_count`, `nightlife_count` (nightlife = `bar`), and
`amenity_supermarket_equiv = supermarket*1.0 + grocery*0.5 + convenience*0.25`
using `AMENITY_WEIGHTS`.

**Step 3 — flood exposure.** For each catchment, compute the share of its
area intersecting each `flood_zones.depth_category`, stored as a JSON object
in `flood_share_by_category` (`{ "<category>": <share 0..1> }`). Compute
`flood_exposure_score` as the area-weighted sum of
`share * depth_rank`, normalized later. Areas must be computed on
`geography` (or EPSG:6677), never in degrees. Overlapping polygons of the
same category must be unioned before measuring so shares cannot exceed 1.

**Step 4 — zoning and road/rail exposure.**
- `residential_zoning_share` = catchment area intersecting
  `zoning_areas WHERE is_residential` divided by catchment area (union first).
- `road_rail_exposure_share` = share of the catchment within 100 m of a
  `major_roads` geometry or a `rail_lines` geometry (union the two buffers
  before measuring). Add `ROAD_RAIL_BUFFER_M = 100` to
  `shared/src/config/scoring.ts` in this task.

**Step 5 — quietness raw.** `quietness_raw` = weighted combination per
`QUIETNESS_WEIGHTS` of: `residential_zoning_share`,
`1 - road_rail_exposure_share`, and `1 - normalized nightlife density`,
where nightlife density is nightlife count per catchment km² min-max
normalized across all station areas.

**Step 6 — rent.** For each station group: median residential land price
inside its catchment (`land_prices` where `use_category` is residential),
median for its ward, then `computeLandPriceMultiplier`, `pickRentStat`, and
`estimateRent` from `@tokyo/shared` (import the same functions — do not
reimplement the formula in SQL or in this package). Write `rent_low_yen`, `rent_median_yen`, `rent_high_yen`,
`rent_confidence`, `rent_source`, `rent_source_period`, `rent_per_sqm_yen`,
`management_fee_yen`, `land_price_multiplier`, `land_price_point_count`.

**Step 7 — normalization.** Min-max normalize across ALL station areas to
0–100 and write `norm_amenity_supermarket` (from
`amenity_supermarket_equiv`), `norm_amenity_restaurant` (from
`restaurant_count + cafe_count`), `norm_flood_safety` (inverted:
higher = safer), and `norm_quietness` (from `quietness_raw`). When min equals
max, every value is 50 (document this in a comment). Also populate
`source_dates` with the `source_updated_at` of each contributing source.

`pnpm derive` prints a summary table: rows written per step and total
duration. Add `--only=<step>` to run a single step.

**Tests** — `scripts/src/derive.test.ts`, guarded on `DATABASE_URL`,
running migrate + seed + derive:

- Catchment area is within 1% of `π · 800²` (≈ 2,010,619 m²) for every
  station — this is the check that catches degree-vs-metre bugs.
- Amenity counts for two named stations match hand-verified counts from the
  seed fixture.
- Every `flood_share_by_category` value is within `[0, 1]` and the shares for
  a station overlapping two zones are both > 0.
- `residential_zoning_share` differs between two named stations, and every
  value is within `[0, 1]`.
- Every `norm_*` column is within `[0, 100]` and at least one station scores
  100 and another 0 on some axis.
- The two deliberately land-price-poor catchments get
  `land_price_multiplier = 1.0` and a lowered `rent_confidence`.
- Running `derive` twice produces byte-identical metric rows (compare a
  checksum of the sorted rows before and after).

---

## Task 8: Transit graph and reverse Dijkstra commute estimator

`api/src/domain/transit/` — pure logic plus a thin loader.

- `graph.ts`
  - `type GraphNode = string` (station group id).
  - `interface GraphEdge { from, to, railLineId: string | null, edgeType: "ride" | "transfer", travelMinutes, waitMinutes, confidence }`
  - `buildGraph(edges: RailEdgeRow[], period: "peak" | "offpeak"): TransitGraph`
    builds an adjacency structure keyed by node, choosing the peak or off-peak
    weights. Build BOTH graphs once at startup (`buildGraphs(edges)` returning
    `{ peak, offpeak }`).
  - `loadRailEdges(pool)` in `loader.ts` reads `rail_edges` joined to
    `rail_lines` for line names.
- `period.ts` — `resolvePeriod(arrivalTime: string): "peak" | "offpeak"`
  using `PEAK_WINDOW` (07:30 inclusive → 10:00 exclusive is peak).
- `dijkstra.ts`
  - `reverseDijkstra(graph, destinationId)` runs ONE search from the
    destination over reversed edges, returning a `Map<stationGroupId,
    { totalMinutes, railMinutes, waitMinutes, transferCount, transferPenaltyMinutes, confidence, previous }>`
    covering every reachable node. Unreachable nodes are absent from the map.
  - Cost model, applied per traversed edge:
    - `ride` edge cost = `travelMinutes + waitMinutes` where `waitMinutes`
      comes from the edge if set, else `PEAK_WAIT_MINUTES` /
      `OFFPEAK_WAIT_MINUTES` per period. The boarding wait is charged once per
      *boarding*, i.e. on the first ride edge of the journey and on the first
      ride edge after each transfer — not on every ride edge of the same line.
      Track the current line in the search state to implement this.
    - `transfer` edge cost = `travelMinutes + TRANSFER_PENALTY_MINUTES` and
      increments `transferCount`.
    - A change of `railLineId` between two consecutive ride edges at the same
      station also counts as a transfer (cost `TRANSFER_PENALTY_MINUTES`,
      `transferCount + 1`) — real networks omit explicit transfer edges within
      a single station complex.
  - Because cost depends on the arriving line, the search state is
    `(node, currentLineId)`; label the priority-queue entries accordingly and
    keep the best cost per state. The result map holds, per node, the best
    cost across its states.
  - Use a binary-heap priority queue (write a small one; no new dependency).
  - `confidence` for a path is the lowest confidence among its edges.
  - `reconstructPath(result, fromStationGroupId)` returns the ordered station
    list from the origin to the destination with the line used on each hop.
- `commute.ts` — `estimateCommute(dijkstraResult, originStationGroupId)`
  returns the `commuteEstimateSchema` shape, adding
  `ACCESS_WALK_MINUTES` to `totalMinutes` and setting
  `label = COMMUTE_LABEL`. Returns `null` when the origin is unreachable.

**Tests** — `api/src/domain/transit/*.test.ts`, on a small hand-built fixture
graph defined in the test file (do not touch the database):

- A direct one-hop journey: exact expected minutes including one boarding
  wait and the 8-minute access walk.
- A two-hop same-line journey charges the boarding wait ONCE, not twice.
- A journey with one explicit `transfer` edge adds exactly
  `TRANSFER_PENALTY_MINUTES` and reports `transferCount === 1`.
- A journey where the line changes between consecutive ride edges without an
  explicit transfer edge is also charged the transfer penalty.
- Peak vs off-peak produce different totals on the same origin/destination.
- A disconnected node is absent from the result map and `estimateCommute`
  returns `null` for it.
- `reconstructPath` returns the correct ordered stations and line names for a
  two-transfer journey.
- Dijkstra picks the genuinely cheapest route when a longer-hop-count path is
  faster than a short one with a transfer.
- Confidence is the minimum over the path's edges.

---

## Task 9: Scoring, hard filters, ranking, explanations

`api/src/domain/scoring.ts` — pure functions over precomputed metrics plus a
commute result. All weights from `@tokyo/shared`.

- `applyHardFilters(candidates, request)` returns
  `{ feasible, diagnostics }` where diagnostics carries
  `candidatesConsidered`, `excludedByRent`, `excludedByCommute`,
  `excludedByDisconnected`, `feasibleCount`, and a `suggestion` string.
  Exclusion rules, in this order (a candidate is counted under the FIRST rule
  it fails, so counts sum to the exclusion total):
  1. disconnected — no commute result for the station
  2. commute — `commute.totalMinutes > request.maxCommuteMinutes`
  3. rent — `rent.medianYen > request.monthlyBudgetYen`
  `suggestion` is `null` when `feasibleCount > 0`. When zero, it names the
  dominant exclusion reason and the relaxation that would help most, e.g.
  `"No areas fit. Rent excluded 41 of 52 areas — try raising the budget to about ¥140,000."`
  Derive the suggested number from the data (e.g. the 25th percentile of
  excluded medians / commute minutes), not a hard-coded guess.
- `scoreAffordability(rentMedianYen, budgetYen)` → 0–100. Score 100 when the
  median is at or below 60% of budget, 0 when it exceeds budget, linear
  between. Add `AFFORDABILITY_FULL_SCORE_RATIO = 0.6` to the shared config in
  this task.
- `scoreCommute(totalMinutes, maxCommuteMinutes)` → 0–100. Score 100 at
  `<= 15` minutes, 0 at `maxCommuteMinutes`, linear between. Add
  `COMMUTE_FULL_SCORE_MINUTES = 15` to the shared config in this task.
- `scoreLifestyle(metrics, preferences)` → `{ score, factors }`. The four
  lifestyle axes map to the precomputed normalized columns:
  `floodSafety → norm_flood_safety`, `supermarkets → norm_amenity_supermarket`,
  `restaurants → norm_amenity_restaurant`, `quietness → norm_quietness`.
  Effective weight for axis *i* is
  `IMPORTANCE_VALUES[pref_i] / sum(IMPORTANCE_VALUES[pref_j] for all j)`.
  Lifestyle score is the weighted sum of the four normalized scores.
  "Essential" is a weight only — it must NOT filter anything out.
- `scoreCandidate(candidate, request)` → the `neighborhoodResultSchema` shape
  minus `rank`. `overallScore = 0.30*affordability + 0.30*commute + 0.40*lifestyle`,
  rounded to one decimal place. `factors` contains one `factorEvidence` entry
  per component — affordability, commute, and each of the four lifestyle axes
  — each with its raw metric, a human-readable `rawValueLabel`
  (e.g. `"¥128,000 modeled area rent"`, `"34 min typical weekday estimate"`,
  `"12 supermarkets within 800 m"`), the 0–100 component score, the effective
  weight *within the overall score* (affordability 0.30, commute 0.30, each
  lifestyle axis `0.40 * itsNormalizedShare`), the point contribution
  (`componentScore * effectiveWeight`, so contributions sum to
  `overallScore`), the source date, the confidence, a one-sentence
  `explanation`, and a `direction`.
- `buildReasons(factors)` → `{ reasonsFor, reasonsAgainst }`: up to three each,
  chosen by point contribution relative to what that factor could have
  contributed (`contribution / (100 * effectiveWeight)`), positive above 0.66
  and negative below 0.34, sorted by effective weight then gap size. Reasons
  are short sentences using the same labels (rent phrasing must use
  `RENT_LABEL`).
- `rankCandidates(scored)` → sorted by `overallScore` desc, ties broken by
  commute asc then rent median asc, assigning `rank` starting at 1.

**Tests** — `api/src/domain/scoring.test.ts`, no database:

- Weight normalization: all four prefs `low` → each effective lifestyle share
  is exactly 0.25 (so 0.10 of overall); one `essential` + three `low` → shares
  `8/11, 1/11, 1/11, 1/11`; assert the exact fractions.
- Point contributions sum to `overallScore` (within floating tolerance) for
  several candidates.
- `scoreAffordability` at exactly 60% of budget = 100, at budget = 0, at 80%
  of budget = 50, above budget = 0.
- `scoreCommute` at 15 = 100, at max = 0, midpoint = 50.
- Hard filters: a candidate over budget is excluded and counted under rent; a
  candidate over the commute cap is counted under commute; a disconnected
  candidate is counted under disconnected and NOT double-counted under the
  others; the counts plus `feasibleCount` equal `candidatesConsidered`.
- An `essential` preference does not remove any candidate from `feasible`.
- Empty result: `suggestion` is non-null, names the dominant reason, and its
  suggested value is derived from the excluded candidates.
- `rankCandidates` ordering including both tiebreakers.
- `buildReasons` produces the expected for/against sets on a crafted
  candidate.

---

## Task 10: v1 API routes

`api/src/routes/` — wire Tasks 6–9 to HTTP. Validate every request with the
shared Zod schemas; validate every response against its shared schema in
development/test (a cheap `safeParse` behind `NODE_ENV !== "production"`).

- `GET /v1/stations?query=&limit=` — autocomplete over `station_groups`
  matching `name_en`, `name_ja`, or any entry in `aliases`, case-insensitive,
  using the trigram indexes; ordered by similarity then name. `query` is
  required, min length 1; `limit` defaults to 10, max 50. Returns
  `{ results: stationSuggestion[] }`. Must match "shibuya", "しぶや" is not
  required but "渋谷" must match.
- `POST /v1/optimize` — body validated by `optimizationRequestSchema`.
  Flow: resolve the destination station (404 `STATION_NOT_FOUND` if unknown)
  → pick peak/off-peak from `arrivalTime` → run ONE `reverseDijkstra` from
  the destination on the preloaded in-memory graph → load
  `neighborhood_metrics` joined to `station_groups` and `wards` for all
  candidates → build commute estimates → apply hard filters → score → rank →
  return the top 20 plus full `diagnostics`, the echoed `request`, and
  `dataVintages` from `import_runs`. The destination station itself is
  excluded from results.
- `GET /v1/neighborhoods/:stationGroupId` — returns the station, its ward,
  the catchment polygon as GeoJSON (`ST_AsGeoJSON`), all
  `neighborhood_metrics` columns as structured factor evidence, the modeled
  rent estimate for a `layout` query parameter (default `1LDK`), and the
  source dates. 404 `NEIGHBORHOOD_NOT_FOUND` when unknown or not yet derived.
- `GET /v1/data-status` — the latest `import_runs` row per source plus the
  `source_updated_at` currently reflected in the data. Returns
  `dataStatusSchema`.
- Graph loading: `api/src/server.ts` loads the rail edges and builds both
  graphs once at startup, then passes them into `buildApp`. Add a
  `POST`-free `reloadGraph` function exported for tests. If the graph is
  empty at startup, log a `warn` and still serve (health stays ok,
  `/v1/optimize` returns a clear `GRAPH_UNAVAILABLE` 503).

**Tests** — `api/src/routes/*.test.ts`:

- Unit-level route tests with `app.inject()` and a fake pool/graph:
  - `POST /v1/optimize` happy path returns 200, results sorted by
    `overallScore` desc, every result validating against
    `optimizeResponseSchema`.
  - Validation errors: missing `destinationStationGroupId`, `arrivalTime` of
    `"25:00"`, negative budget, `maxCommuteMinutes` of 200, unknown layout,
    unknown importance — each returns 400 with `code: "VALIDATION_ERROR"` and
    a `details` array naming the offending path.
  - Unknown destination → 404 `STATION_NOT_FOUND`.
  - Empty feasible set → 200 with `results: []` and a non-null
    `diagnostics.suggestion`.
  - `GET /v1/stations` requires `query`, respects `limit`, caps at 50.
  - `GET /v1/neighborhoods/:id` 404 for an unknown id.
- One integration test guarded on `DATABASE_URL` running against the seeded +
  derived database: `POST /v1/optimize` with destination `sg-shibuya`,
  budget ¥200,000, layout `1LDK`, max commute 45, mixed preferences —
  asserts a non-empty ranked list, asserts `sg-isolated-test` is absent and
  counted under `excludedByDisconnected`, and asserts every rent field is
  labelled `modeled area rent`.

---

## Task 11: Import framework and `pnpm import:mlit`

`scripts/src/lib/import-run.ts` — the shared harness every import uses:

- `runImport({ source, pool }, fn)`: inserts an `import_runs` row with
  `status = 'running'`, runs `fn` inside ONE transaction, and on success
  updates the row to `success` with `finished_at`, `rows_imported`, and
  `source_updated_at`; on failure rolls back the data transaction, updates
  the row to `failed` with the error message, and rethrows. The
  `import_runs` bookkeeping must survive the data rollback — use a separate
  connection for it.
- `scripts/src/lib/source-file.ts` — `resolveSource({ url, localPath, env })`:
  if `--file <path>` was given, read that; else if the source URL and any
  required credential are available, download to `data/` and read that; else
  fail with a message naming the missing credential and the manual-download
  URL. Never fetch during tests.
- `scripts/src/lib/validate.ts` — `expectColumns(row, required[])` and
  `expectRowCount(n, { min, max, label })` producing clear errors.

`scripts/src/import-mlit.ts` — imports wards, station groups,
`station_source_refs`, rail lines, land-price points, zoning polygons, and
flood polygons from MLIT data. Accept GeoJSON and shapefile-derived GeoJSON
input via `--file` per dataset (`--wards`, `--stations`, `--rail-lines`,
`--land-prices`, `--zoning`, `--flood`), reading `MLIT_API_KEY` from the
environment only when downloading. Each dataset:

- validates required properties and row-count bounds
- normalizes coordinates to SRID 4326
- merges station complexes: stations whose normalized name matches and whose
  points are within 300 m collapse into one `station_group`, with every
  original id recorded in `station_source_refs` and the representative point
  at the centroid of the members. Add `STATION_MERGE_RADIUS_M = 300` to the
  shared config in this task.
- upserts by natural key, and deletes rows for that source that were not seen
  in this run
- sets `source` and `source_updated_at` on every row

**Tests** — `scripts/src/import-mlit.test.ts` using small committed fixtures
under `scripts/src/fixtures/mlit/` (a handful of features per dataset,
including two stations that must merge and one that must not):

- Parsing and normalization of each dataset produces the expected row shapes
  (pure-function level, no DB).
- Station merging: the two near-identical stations merge into one group with
  two `station_source_refs`; the third stays separate.
- A fixture missing a required column produces a clear validation error.
- A row count below the configured minimum aborts the import.
- Guarded on `DATABASE_URL`: a full run against a scratch DB writes one
  `success` `import_runs` row with the right `rows_imported`, and a
  deliberately corrupt fixture writes one `failed` row and leaves the data
  tables unchanged.

---

## Task 12: `pnpm import:rent` (e-Stat, optional REINS)

`scripts/src/import-rent.ts`.

- Primary source: e-Stat 2023 Housing and Land Survey, ward-level rent and
  management fees. Accept a CSV via `--file`, or download using
  `ESTAT_APP_ID` when present. e-Stat CSVs are Shift-JIS by default — decode
  explicitly (use `iconv-lite`; adding that one dependency is permitted for
  this task) and handle a UTF-8 BOM.
- Maps each row to `rent_stats` with `source = 'estat'`, `period = '2023'`,
  `rent_per_sqm_yen`, `management_fee_yen`, `sample_count` when present, and
  `source_updated_at` from the survey vintage.
- Ward matching is by the 5-digit municipality code where available,
  otherwise by normalized Japanese ward name (strip whitespace, normalize
  full-width/half-width). A ward that cannot be matched is an error naming
  the unmatched value — never a silent skip.
- Optional REINS: `--reins <file>` parses a quarterly ward-level table into
  `source = 'reins'` rows with the quarter as `period` (e.g. `2026Q2`). Only
  runs when the flag is passed. Print a licence reminder line when it does.
- Validates: every one of the 23 ward codes present (when importing the full
  file), `rent_per_sqm_yen` within a sane range (1,000–20,000 ¥/m²),
  `management_fee_yen` within 0–50,000.

**Tests** — `scripts/src/import-rent.test.ts` with a committed Shift-JIS
e-Stat-shaped fixture and a REINS-shaped fixture under
`scripts/src/fixtures/rent/`:

- Shift-JIS decoding produces the correct Japanese ward names.
- Rows map to the expected `rent_stats` shapes with correct numbers.
- An out-of-range rent value aborts with a clear message.
- An unmatched ward name aborts and names the value.
- REINS parsing yields `period = '2026Q2'` and `source = 'reins'`.
- Guarded on `DATABASE_URL`: a run writes the rows and one `success`
  `import_runs` record, and re-running is idempotent.

---

## Task 13: `pnpm import:osm`

`scripts/src/import-osm.ts`.

- Reads an Overpass API JSON response (or an `.osm.json` file) via `--file`,
  or queries Overpass directly when `--download` is passed. The Overpass
  query is built in code, bounded to the Tokyo 23 wards bbox, and requests:
  - `shop=supermarket` → `supermarket`
  - `shop=greengrocer|butcher|bakery|grocery` → `grocery`
  - `shop=convenience` → `convenience`
  - `amenity=restaurant` → `restaurant`
  - `amenity=cafe` → `cafe`
  - `amenity=bar|pub|nightclub` → `bar`
  - `highway=motorway|trunk|primary` → `major_roads` with `road_class`
- Nodes use their own coordinates; ways and relations use their centroid
  (`center` from Overpass `out center`). Roads keep their geometry as
  `MultiLineString`.
- Writes `pois` (upsert on `(osm_type, osm_id)`) and `major_roads`, deleting
  OSM-sourced rows not seen in this run, inside one transaction.
- Sets `source = 'openstreetmap'` and `source_updated_at` from the Overpass
  `osm3s.timestamp_osm_base`.
- Rate-limit politeness when downloading: one request, a descriptive
  `User-Agent`, and a clear error if Overpass returns 429/504.
- Prints the required attribution `© OpenStreetMap contributors` on every
  run, and add that attribution string to `shared/src/config/scoring.ts` as
  `OSM_ATTRIBUTION`.

**Tests** — `scripts/src/import-osm.test.ts` with a committed Overpass JSON
fixture under `scripts/src/fixtures/osm/` containing at least one node, one
way with `center`, one relation with `center`, one road way with geometry,
and one element with an unmapped tag:

- Each element maps to the expected category; the unmapped element is
  skipped without aborting.
- Way/relation centroids are used correctly.
- `source_updated_at` is parsed from `osm3s.timestamp_osm_base`.
- A malformed element (missing coordinates) aborts with a clear message.
- Guarded on `DATABASE_URL`: writes the rows, records one `success`
  `import_runs`, and re-running is idempotent (no duplicate POIs).

---

## Task 14: `pnpm import:transit`

`scripts/src/import-transit.ts` — derive station mappings and rail-edge
weights. **Do not persist trips, calendars, or stop_times.**

Two input modes:

1. **GTFS mode** (`--gtfs <dir-or-zip>`): read `stops.txt`, `routes.txt`,
   `trips.txt`, `stop_times.txt`, `calendar.txt`/`calendar_dates.txt`.
   - Select weekday services only.
   - Map GTFS `stop_id`/`parent_station` to existing `station_groups` via
     `station_source_refs`, falling back to normalized-name + 300 m proximity
     matching (`STATION_MERGE_RADIUS_M`); record new refs with
     `source = 'gtfs'`. Report unmatched stops as a warning summary, not a
     crash, unless more than 20% are unmatched (then abort).
   - For each ordered adjacent stop pair on a route, compute the median
     weekday travel time in minutes, separately for departures inside
     `PEAK_WINDOW` and outside it.
   - Compute average headway per route per period from consecutive departures
     at the first stop; halve it for expected wait, clamped to
     `[1, 15]` minutes. Add `MIN_EXPECTED_WAIT_MINUTES = 1` and
     `MAX_EXPECTED_WAIT_MINUTES = 15` to the shared config in this task.
   - Write `rail_edges` with `edge_type = 'ride'`, `confidence = 'high'`,
     `source = 'gtfs'`, both directions where the route runs both ways.
   - Stream `stop_times.txt` rather than loading it entirely into memory.
2. **Fallback mode** (`--from-topology`, used when GTFS is unavailable):
   derive edges from `rail_lines` geometry and station positions. For each
   line, order its stations along the line geometry
   (`ST_LineLocatePoint`), then for each adjacent pair compute the along-line
   distance (`ST_Length(geography)`) and convert to minutes using
   `FALLBACK_SPEEDS_KMH[mode]` plus
   `DWELL_SECONDS_PER_INTERMEDIATE_STATION` per intermediate station.
   Expected wait is `PEAK_WAIT_MINUTES` / `OFFPEAK_WAIT_MINUTES`.
   Write `confidence = 'low'`, `source = 'mlit-topology'`.

Both modes then generate **transfer edges**: for every pair of station groups
whose representative points are within `STATION_MERGE_RADIUS_M` and that are
not already the same group, write a bidirectional `transfer` edge with
`travelMinutes = 0` (the `TRANSFER_PENALTY_MINUTES` is applied by the router,
not stored) and `confidence = 'medium'`. Do not double-apply the penalty.

Validation: abort if the resulting graph has fewer edges than a configured
minimum, or if more than 10% of station groups end up with no edges (report
which).

**Tests** — `scripts/src/import-transit.test.ts` with a tiny committed GTFS
fixture (5 stops, 2 routes, ~10 trips) under
`scripts/src/fixtures/gtfs/`:

- Median adjacent-stop travel times are computed correctly for a hand-checked
  pair, with peak and off-peak differing.
- Headway → expected wait, including both clamp bounds.
- Weekday service selection excludes a weekend-only trip present in the
  fixture.
- Stop→station-group matching via `station_source_refs` and via the
  name+proximity fallback; an unmatched stop appears in the warning summary.
- Trips/stop_times/calendars are NOT written to any table (assert those
  tables do not exist / nothing was persisted).
- Guarded on `DATABASE_URL`: fallback mode over the seeded rail lines
  produces edges with `confidence = 'low'` and plausible minutes, and
  transfer edges appear at the seeded interchange stations exactly once per
  direction.

---

## Task 15: Minimal frontend

**Read the Global Constraints frontend clause first.** Minimal and functional
only. No map, no Playwright, no design work.

`web/`:

- `web/lib/api.ts` — a small handwritten `fetch` wrapper (`getJson`,
  `postJson`) reading `NEXT_PUBLIC_API_BASE_URL`, typed with the shared
  contracts, throwing a typed error carrying the API's `{ error: { code, message } }`.
  No generated client.
- `app/page.tsx` — a three-step form, all steps on one page is acceptable:
  1. destination station (a text input with a debounced call to
     `/v1/stations` and a plain `<ul>` of suggestions), arrival time
     (`<input type="time">`), max commute minutes
  2. monthly all-in budget, layout (`<select>` from `LAYOUT_IDS`, showing the
     assumed m² range next to each)
  3. the four lifestyle importance selects
  Submitting calls `POST /v1/optimize`.
- Results: a ranked `<ol>`. Per result show rank, station name (en + ja),
  ward, overall score, the modeled rent range with its label and confidence,
  the commute breakdown (access walk / rail / wait / transfers) with the
  `typical weekday estimate` label, the four lifestyle summaries, and
  reasons for/against. Show the assumed layout m² range next to every rent
  figure. Show the `dataVintages` dates and a short methodology note listing
  the weights (imported from `@tokyo/shared`, not retyped) and the
  OpenStreetMap attribution.
- Empty results render the `diagnostics.suggestion` prominently.
- Inputs are URL-encoded into the query string so results are shareable, and
  the page hydrates its form from the query string on load.
- Labels tied to inputs, visible focus states via Tailwind's defaults, and a
  loading and error state. That is the whole accessibility budget for now.

**Tests** — one Vitest test for `web/lib/api.ts` covering a successful
response, a 400 error surfacing `code` and `message`, and a network failure.
No component tests, no Playwright.

**Verification:** `pnpm --filter @tokyo/web build` succeeds, `pnpm -r typecheck`
passes, and the report includes the output of a real `POST /v1/optimize` made
against the running API with the seeded+derived database.

---

## Out of scope for this plan (explicitly deferred)

- Running the full 23-ward live import (requires MLIT/e-Stat/ODPT credentials
  the environment does not have).
- Deploying to Render (requires the user's account). Task 1's README
  documents the intended topology; no `render.yaml` is required.
- Render Cron scheduled imports (spec defers these until two successful
  manual refresh cycles).
- MapLibre, Playwright, visual design, and the methodology page — deferred by
  the user's frontend directive.
