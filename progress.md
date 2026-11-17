# Matchi agent build — progress

Started 16:42 JST 2026-11-17. Demo 20:45 JST.

| Package | Model | Status | Owned paths |
|---|---|---|---|
| D / P0 recon | fable (wave-1 override) | partial: no SQL, .env points at Neon | progress.md (own section only) |
| A / P1 contracts | fable | done 16:48 (typecheck clean; Recommendation not zod) | shared/src/engine/types.ts, rng.ts, features.ts |
| B spec review | fable | done 16:50 (28 errata, 4 blocking) | docs/plans/engine-spec-errata.md |
| C grounding + sql-guard | fable | done 16:49 (53 tests pass; guard regex-based, needs RO txn) | api/src/agent/grounding*.ts, sql-guard*.ts |
| E engine core | fable | waiting on A | shared/src/engine/belief.ts, evidence.ts |
| F engine decisions | fable | waiting on A | shared/src/engine/recommend.ts, explain.ts |
| G harness | fable | waiting on A | tools.ts, prompt.ts, loop.ts |

## Orchestrator log
- 16:42 docs/plans/engine-spec.md and docs/plans/agent-harness-plan.md do not exist: not in the working tree, git history, stashes, or under ~. Only D (recon) is spec-independent; launched it. A/B/C held pending the user.

## P0 recon: partial
Stopped before any SQL: `DATABASE_URL` (and `DATABASE_URL_POOLED`) in `.env` point at Neon (host contains "neon", db `neondb`). No connection was made to any database. Everything below comes from migrations and source; anything needing live data (row counts, null rates, min/median/max, model_params live values) is NOT measured. A Postgres is listening on localhost:5432 (`pg_isready`, no login attempted); `.env.example` documents a local `tokyo` database for it. I did not log in to it because the env var route was the one specified; whether it has migrations 0011 to 0018 applied and derived data loaded is unknown.

- Built:

### 1. agent.area_features (a VIEW, not a table)
Grain: one row per locality (town, chome combined) in the 23 wards. Key: `locality_id` (text; "ward code, colon, hash of the Japanese name"), PK of `public.localities`. Source: `localities l JOIN locality_metrics lm JOIN wards w LEFT JOIN locality_access la`. No geometry. 53 columns. Row count / null rates / min / median / max: not measured (see above). Nullability below is from DDL only.

| Column | Type | Added | Nullable (DDL) | COMMENT (abridged from migration text) |
|---|---|---|---|---|
| locality_id | text | 0011 | no | Stable locality id: ward code, colon, hash of Japanese name |
| name_en | text | 0011 | yes | Romanized name (Japan Post file) |
| name_ja | text | 0011 | no | Japanese name, chome suffix removed (e-Stat 2020 census) |
| ward_code | text | 0011 | no | Five-digit municipality code, 13101 to 13123 |
| ward_name_en / ward_name_ja | text | 0011 | type not checked | Ward name |
| lat / lon | double | 0011 | no | Point inside the locality, WGS84 |
| rent_per_sqm_yen | double | 0011 | yes | WARD-level average rent per m2 per month, yen; same for every locality in a ward (e-Stat) |
| management_fee_yen | double | 0011 | yes | Ward-level typical monthly management fee, yen |
| land_price_multiplier | double | 0011 | yes | Multiplier used by /v1/optimize: (local / ward median land price)^0.25, clamped 0.85 to 1.15; 1.0 on fallback |
| land_price_used_fallback | boolean | 0011 | yes | True when multiplier fell back to 1.0 (under 3 land price points). Low confidence |
| rent_source | text | 0011 | yes | estat or reins |
| rent_source_period | text | 0011 | yes | Survey period, e.g. 2023 |
| supermarket_count | integer | 0011 | no (default 0) | Supermarket-equivalents within 800 m (supermarkets + weighted groceries and konbini). OSM |
| restaurant_count | integer | 0011 | no | Restaurants within 800 m. OSM, coverage varies |
| cafe_count | integer | 0011 | no | Cafes within 800 m |
| convenience_count | integer | 0011 | no | Convenience stores within 800 m |
| cuisine_variety_count | integer | 0011 | no | Distinct OSM cuisine tags among restaurants and cafes within 800 m |
| late_night_count | integer | 0011 | no | Restaurants, cafes, bars within 800 m open to 23:00 or later; only places with tagged hours |
| health_count | integer | 0011 | no | Clinics, hospitals, pharmacies within 800 m |
| green_space_share | double | 0011 | no | Share of 800 m catchment that is park / green, 0 to 1 |
| land_value_yen_per_sqm | double | 0012 | yes | IDW mean of 5 nearest residential land price points, yen per m2 (MLIT L01) |
| land_value_nearest_m | double | 0012 | yes | Distance to nearest of those points, m; over ~1000 m means borrowed from neighbours |
| rent_local_multiplier | double | 0012 | yes | (land value / ward median)^elasticity, clamped; params in model_params. Low confidence (fit on 23 wards) |
| rent_per_sqm_local_yen | double | 0012 | yes | Modelled locality rent per m2 per month: rent_per_sqm_yen * rent_local_multiplier |
| residential_zoning_share | double | 0013 | yes | Share of 800 m catchment zoned residential, 0 to 1 (MLIT A55) |
| road_rail_exposure_share | double | 0013 | yes | Share of catchment within 100 m of major road or rail, 0 to 1. Higher is noisier |
| bar_count | integer | 0013 | yes | Bars, pubs, nightclubs within 800 m. Positive for lively, negative for quiet |
| quietness_raw | double | 0013 | yes | Fixed blend 0 to 1: 0.5 residential + 0.3 (1 - exposure) + 0.2 (1 - capped bar density) |
| centrality_minutes | double | 0014 | yes (LEFT JOIN) | Mean of the min_to_* columns. Lower is more central |
| min_to_shinjuku, _shibuya, _ikebukuro, _tokyo, _shinagawa, _ueno, _otemachi, _roppongi | double (8 cols) | 0014 | yes | PEAK door-to-door minutes to that hub: walk to one of 3 nearest stations + rail, median over 9 sample points. Modelled, not timetabled |
| line_count | double | 0014 | yes | Distinct rail lines at the 3 nearest stations, median over 9 points |
| direct_reach_stations | double | 0014 | yes | Stations reachable with no transfer within 30 rail minutes |
| stations_within_30_min | double | 0014 | yes | Stations reachable within 30 peak minutes, transfers allowed |
| nearest_station_walk_min | double | 0014 | yes | Walk to nearest station, min (straight line * 1.3 at 80 m/min) |
| access_confidence | text | 0014 | yes | Lowest rail edge confidence behind hub times: high / medium / low |
| reach_restaurant | double | 0015 | yes | Rail-reachable restaurants and cafes, time-discounted: sum of station 800 m count * exp(-offpeak door-to-station min / reach_decay_minutes). Index, not a head count |
| reach_cuisine_variety | double | 0015 | yes | Same weighting on station distinct cuisine count |
| reach_late_night | double | 0015 | yes | Same weighting on station late-night count |
| reach_green | double | 0015 | yes | Same weighting on station green share; "station-equivalents of full green cover" |
| population | integer | 0016 | yes | Residents, 2020 census |
| households | integer | 0016 | yes | Households, 2020 census |
| area_sqm | double | 0016 | yes | Area of the census polygons, m2 |
| population_density_per_km2 | double | 0016 | yes | Residents per km2. Low in business districts = few residents, not few people |
| persons_per_household | double | 0016 | yes | Lower = more single-person homes. Null when households is 0 |

View comment: "Counts are medians over 9 sample points, each with an 800 m catchment, unless a column says otherwise."

Proposed column-to-feature mapping (grouping and direction are my proposal; rows marked GUESS are not stated by any comment):

| Engine feature | Columns | Unit | Direction |
|---|---|---|---|
| Rent / cost | rent_per_sqm_local_yen (preferred, locality-level, modelled); rent_per_sqm_yen (ward-level fallback); management_fee_yen | yen per m2 per month; yen per month | higher = worse (costlier) |
| Rent confidence (not a preference feature) | land_price_used_fallback, land_value_nearest_m, rent_source, rent_source_period | bool; m; text | fallback true / larger distance = less trustworthy |
| Land value | land_value_yen_per_sqm | yen per m2 | GUESS: a cost / prestige proxy, higher = pricier. Already baked into rent_local_multiplier, so using both double counts |
| Legacy, avoid | land_price_multiplier | ratio | superseded by rent_local_multiplier; kept for /v1/optimize |
| Commute / access (generic) | centrality_minutes, min_to_* (8 hubs), nearest_station_walk_min | minutes (peak, door to door) | lower = better |
| Connectivity | line_count, direct_reach_stations, stations_within_30_min | counts (medians, so fractional) | higher = better |
| Access confidence | access_confidence | high / medium / low | metadata |
| Quiet / noise | residential_zoning_share (higher = quieter), road_rail_exposure_share (higher = noisier), bar_count (higher = livelier), quietness_raw (higher = quieter) | share 0 to 1; count; 0 to 1 | per comment: use the three parts, not the blend, when the preference is not plain quiet |
| Lively / nightlife | bar_count, late_night_count, reach_late_night | counts; index | higher = livelier (good or bad by person) |
| Greenery | green_space_share, reach_green | share 0 to 1; index | higher = better |
| Daily amenities | supermarket_count, convenience_count, health_count | counts within 800 m | higher = better; GUESS: saturating (shared has LIFESTYLE_SUFFICIENCY_TARGETS) |
| Food scene | restaurant_count, cafe_count, cuisine_variety_count, reach_restaurant, reach_cuisine_variety | counts; index | higher = better; reach_* does not saturate |
| People / demographics | population_density_per_km2, persons_per_household, population, households, area_sqm | per km2; ratio; counts; m2 | no intrinsic direction. GUESS: low persons_per_household = singles area, high = family area |
| Safety | none | | no column exists (flood was removed in migration 0009; no crime data) |
| Identity / geo | locality_id, name_en, name_ja, ward_code, ward_name_*, lat, lon | | |

### 2. station_travel_times
`public.station_travel_times` (table, migration 0014) and `agent.station_travel_times` (view over it without `derived_at`).

| Column | Type | Notes |
|---|---|---|
| from_station_group_id | text NOT NULL, FK station_groups | origin |
| to_station_group_id | text NOT NULL, FK station_groups | destination |
| period | text NOT NULL, CHECK in ('peak','offpeak') | peak = arrive 07:30 to 10:00 per comment |
| minutes | double NOT NULL, >= 0 | fastest rail time incl. first wait and 5-minute transfer penalties. Modelled |
| transfers | smallint NOT NULL | transfers on that path |
| confidence | text, high / medium / low | lowest edge confidence on the path |
| derived_at | timestamptz | public table only |

Grain / PK: (from_station_group_id, to_station_group_id, period). Extra index on (to_station_group_id, period). Self pairs are 0; a missing pair means disconnected. Station to station only: no walk at either end. Row count: not measured; the view comment says "about 240,000 rows per period: always filter by station". Filled by `pnpm derive --only=access`.

Lookup: `SELECT minutes, transfers, confidence FROM agent.station_travel_times WHERE from_station_group_id = $1 AND to_station_group_id = $2 AND period = $3`. Period value comes from `resolvePeriod("HH:MM")` in `api/src/domain/transit/period.ts`, which returns `"peak" | "offpeak"` (type `TransitPeriod` from shared) using `PEAK_WINDOW` in `shared/src/config/scoring.ts`; the strings match the CHECK constraint. Station ids and names: `agent.stations` (station_group_id, name_en, name_ja, ward_code, lat, lon, line_count, direct_reach_stations, stations_within_30_min). Several groups can share a name (Tokyo, Ikebukuro).

### 3. model_params
`public.model_params` (table) and `agent.model_params` (view, same columns): key text PK, value double NOT NULL, unit text NOT NULL, fitted_at timestamptz (null = chosen by hand), sample_size integer, notes text.

| key | value | unit | Origin |
|---|---|---|---|
| reach_decay_minutes | 10 | minutes | seeded by 0011; weight = exp(-minutes / value); not fitted |
| rent_local_multiplier_min | 0.85 | ratio | seeded by 0011 |
| rent_local_multiplier_max | 1.15 | ratio | seeded by 0011 |
| rent_land_elasticity | not measured | elasticity | upserted by `scripts/src/derive/land-value.ts` (OLS across wards) |
| rent_land_elasticity_ci_low / _ci_high | not measured | elasticity | same script |

The first three are the migration seed values; live values could differ if someone updated them. The fitted three exist only if the derive step has run.

### 4. Other agent.* objects (all views or functions; none are tables). Row counts not measured.

| Object | Kind | Migration | What it is |
|---|---|---|---|
| agent.model_params | view | 0011 | see 3 |
| agent.data_vintages | view | 0011 | latest successful import per source from import_runs: source, source_updated_at, imported_at, rows_imported |
| agent.area_features | view | 0011, extended by 0012 to 0016 | see 1 |
| agent.stations | view | 0014 | one row per station group |
| agent.station_travel_times | view | 0014 | see 2 |
| agent.locality_poi_count(p_category, p_cuisine default null, p_radius_m default 800) | function, SECURITY DEFINER | 0015 | returns (locality_id, poi_count): median over 9 sample points; categories supermarket, grocery, convenience, restaurant, cafe, bar, health, landmark; radius clamped 50 to 2000 |
| agent.ward_rent_bands | view | 0017 | rented dwellings per ward per monthly rent band, with share_of_ward; 2023 survey; includes public and company housing |
| agent.rent_size_curve | view | 0017 | median rent per tatami by size class, 23 wards as one unit; relative_to_all multiplier |
| agent.commute_error_model | view | 0018 | model minus reference error per confidence class; comment says empty until reference journeys are loaded |

Per migration: 0011 creates the schema, model_params, `grant_agent_read_access()` and the first three views. 0012 land value + local rent. 0013 quietness parts. 0014 access tables (station_travel_times, station_access, locality_access) + stations views. 0015 reach_* columns, pois cuisine trigram index, poi count function. 0016 census people columns. 0017 rent_bands, rent_size_curve, census_ward_totals. 0018 commute_reference, commute_error_model. The schema name is a psql-style variable `:"agent_schema"` substituted by `scripts/src/migrate.ts` ("agent" by default). The read-only role `matchi_agent_ro` is created outside migrations (comment names `pnpm db:agent-role`; no such script is in root package.json).

### 5. Shared exports (`@tokyo/shared`, source in shared/src, built to dist)
`shared/src/index.ts` re-exports everything from: config/lifestyle-axes, config/scoring, contracts/index, domain/geo, domain/rent, domain/transit/graph, domain/transit/dijkstra, config/access. A second entry `@tokyo/shared/server` exports only `databaseSslFor(connectionString)`. There is no shared/src/engine yet.

| Area | Exports worth reusing |
|---|---|
| domain/geo | `haversineMeters(aLat, aLon, bLat, bLon): number` (metres) |
| domain/transit/graph | types `TransitPeriod` ("peak" / "offpeak"), `GraphNode`, `GraphEdge`, `RailEdgeRow`, `TransitGraph`, `TransitGraphs`; `buildGraph(edges, period)`, `buildGraphs(edges)` |
| domain/transit/dijkstra | `reverseDijkstra(graph, seeds: {node, walkMinutes}[]) -> DijkstraResult` (search runs backwards from the destination; `.get(node)` gives totalMinutes, railMinutes, waitMinutes, transferCount, confidence), `reconstructPath(result, fromStationGroupId)`. `api/src/domain/transit/graph.ts` and `dijkstra.ts` are now thin re-exports of these |
| config/scoring | `Confidence`, `lowerConfidence`, `LAYOUTS`, `LAYOUT_IDS`, `PEAK_WINDOW`, `TRANSFER_PENALTY_MINUTES` (5), `PEAK_WAIT_MINUTES` (4), `OFFPEAK_WAIT_MINUTES` (6), `WALK_SPEED_M_PER_MIN` (80), `WALK_DETOUR_FACTOR` (1.3), `CATCHMENT_RADIUS_M` (800), `LOCALITY_SAMPLE_COUNT` (9), `LIFESTYLE_SUFFICIENCY_TARGETS`, `OVERALL_WEIGHTS`, `IMPORTANCE_VALUES`, `QUIETNESS_WEIGHTS`, `AMENITY_WEIGHTS`, `RESULTS_LIMIT`, `TOKYO_23_WARDS_BBOX`, others |
| config/lifestyle-axes | `LIFESTYLE_AXIS_IDS` (supermarkets, restaurants, quietness, konbini, cuisineVariety, greenSpace, lateNight, health), `LIFESTYLE_AXES` (label, normColumn, metricsKey), `mapLifestyleAxes` |
| config/access | `ACCESS_HUBS` (8 hubs: key, nameJa, nameEn; keys match the min_to_* columns), `DIRECT_REACH_MINUTES` (30), `DEFAULT_REACH_DECAY_MINUTES` (10) |
| domain/rent | `estimateRent`, `computeLandPriceMultiplier`, `pickRentStat`, `rentStatBaseConfidence`, `LayoutId` |
| contracts (zod) | common: `importanceSchema` (low / medium / high / essential), `layoutSchema`, `confidenceSchema`. request: `optimizationRequestSchema` + `OptimizationRequest`. response: `optimizeResponseSchema`, `neighborhoodResultSchema`, `rentEstimateSchema`, `commuteEstimateSchema`, `factorEvidenceSchema`, `stationsResponseSchema`, `placesResponseSchema`, `dataStatusSchema`, each with a `z.infer` type |

Zod style: `import { z } from "zod"`, `z.object({...}).strict()`, `.refine`, types via `z.infer`. Imports inside shared use `.js` extensions (ESM).

### 6. Commands
| What | Command |
|---|---|
| Typecheck all | `pnpm typecheck` (root; runs `pnpm -r typecheck`) |
| Typecheck one package | `pnpm --filter @tokyo/shared typecheck` (also `@tokyo/api`, `@tokyo/web`, `@tokyo/scripts`); each is `tsc --noEmit` |
| All tests | `pnpm test` (root; `vitest run`). No per-package test scripts |
| One project | `pnpm vitest run --project shared` (projects: shared, api, scripts, web) |
| One file | `pnpm vitest run shared/src/domain/geo.test.ts` (not executed here; standard vitest path filter from the root config) |
| Lint | `pnpm lint` |
| Build shared | `pnpm --filter @tokyo/shared build`. api and web resolve `@tokyo/shared` through `dist`, and their build scripts build shared first. Whether api typecheck needs a fresh shared build after adding exports was not tested |

- Vitest 4.1.11, single root `vitest.config.ts`, `fileParallelism: false`. Test globs: `src/**/*.test.ts` for shared, api, scripts; `lib/**/*.test.ts` for web (no component tests).
- A global setup file (`vitest.setup.database-guard.ts`) throws in every test file if `DATABASE_URL` is set and its database name does not end in `_test` (override `ALLOW_DESTRUCTIVE_TESTS=1`). DB suites TRUNCATE and re-seed. Vitest does not load `.env`, and `DATABASE_URL` was not set in my shell.
- Result of the single run, with `DATABASE_URL` explicitly unset: 48 files passed, 508 tests passed, 69 skipped, 0 failed. The 14 failures the user mentioned did NOT reproduce in this mode. They are presumably in the 69 skipped DB-backed tests (13 test files use skipIf / runIf) and would need a local `*_test` database to see. I cannot list them by file.
- zod: `^4.4.3` in api and shared (zod 4). web does not depend on zod directly.
- web: Next.js `^15.5.23`, React 19, App Router (`web/app/layout.tsx`, `page.tsx`, `find/page.tsx`; no `pages/` dir), Tailwind 4, `transpilePackages: ["@tokyo/shared"]`. A new page goes at `web/app/agent/page.tsx`. API client lives in `web/lib/api.ts`; browser base URL env var is `NEXT_PUBLIC_API_BASE_URL`.

### 7. API to DB, and routes
- Env var: `DATABASE_URL` (validated by zod in `api/src/config.ts` `loadConfig`; also `DATABASE_POOL_MAX`, `DATABASE_POOL_IDLE_TIMEOUT_MS`). `DATABASE_URL_POOLED` exists in `.env` but the code does not read it.
- Client: `pg` `Pool`. Module: `api/src/db.ts` exports `createPool(databaseUrl, {maxConnections, idleTimeoutMs})`, the `DbPool` interface (`query(text, params?)`) and a `query()` helper that logs slow queries. SSL policy from `databaseSslFor` in `@tokyo/shared/server`. Statement timeout is 10 s. Default pool max is 2.
- The pool is created in `api/src/server.ts` `main()` (local dev) and `api/src/app.ts` (Vercel entry), then passed as `AppDeps { config, pool, graphs }`. Routes use `deps.pool.query(sql, params)`; there is no ORM. The API uses the same full-privilege connection for everything; nothing in api/ uses the `matchi_agent_ro` role yet.
- Framework: Fastify 5 with helmet, cors, rate-limit. Routes are registered in `api/src/application.ts` `buildApp()`, inside one `app.register` block that calls `registerXRoute(instance, deps)` for each route file in `api/src/routes/`. Example: `api/src/routes/stations.ts` exports `registerStationsRoute(app: FastifyInstance, deps: AppDeps)` and defines `app.get("/v1/stations", ...)`, validating with `parseOrThrow(schema, request.query)` from `api/src/routes/lib/validation.ts`. Errors: throw `ApiError(statusCode, code, message, details?)` from `application.ts`; ZodError is mapped to 400.
- To add a route: create `api/src/routes/agent.ts` exporting `registerAgentRoute(app, deps)`, import it in `application.ts` and add one call in the register block. That edit to `application.ts` is a shared file, so one package should own it.
- Existing routes: /health, /v1/stations, /v1/places, /v1/optimize, neighborhoods, localities, data-status. The in-memory transit graph (`deps.graphs.peak` / `.offpeak`) is loaded at boot from `rail_edges` via `api/src/domain/transit/loader.ts`.

- Files: progress.md (this section only). Test log kept outside the repo at /private/tmp/claude-501/-Users-yato-sar-projects-matchi/bc94c4f1-92f3-4153-9026-a3e7a106fd4c/scratchpad/test.log
- Verified:
  - host check on `.env` (prints booleans only) -> DATABASE_URL neon: true, local: false; same for DATABASE_URL_POOLED
  - `pg_isready -h localhost -p 5432` -> accepting connections (no login)
  - `env -u DATABASE_URL -u DATABASE_URL_POOLED pnpm test` -> 48 files passed, 508 passed, 69 skipped, 0 failed
  - `pnpm typecheck` -> not run
- Deviations from spec:
  - No SQL was run, so items 1 to 4 have schema and comments from migration files rather than the pg catalog, and no row counts, null rates or min / median / max. If a migration was not applied, or was applied to a schema other than `agent`, the live database differs from this.
  - The working tree is on branch `feat/db-improvement-plan`, not `feat/tokyo-optimizer-mvp` as the brief says. Migrations 0011 to 0018 and shared/src/domain/transit come from the WIP commit bbcea11 on this branch; I did not check whether they exist on feat/tokyo-optimizer-mvp.
  - The 14 failing tests could not be listed (see 6).
- Blockers or needs from other packages:
  - Need a local connection decision from the user / orchestrator: either point `DATABASE_URL` at the local database, or approve using the local `tokyo` database documented in `.env.example`. With that, the measured half of items 1 to 4 is about five minutes of SELECTs.
  - Until then, engine packages should treat value ranges, null rates and the fitted `rent_land_elasticity` as unknown, and should not assume `agent.*` exists locally.
  - Running `pnpm dev:api` as configured would connect the API to Neon; any package that wants to exercise routes against data needs the same decision.
- 16:45 both spec files appeared in docs/plans/ (untracked). 16:47 launched A, B, C on Fable with a hard stop at 16:56 (user: stop work at 16:57).
- Branch is feat/db-improvement-plan (user checked it out 16:37, committed bbcea11), not feat/tokyo-optimizer-mvp as in the brief. Staying on it.
- DATABASE_URL and DATABASE_URL_POOLED in .env both point at Neon. Nobody connected. pnpm dev:api would hit Neon as configured. Local Postgres is on :5432 (.env.example documents a local `tokyo` db). Needs a user decision.

## P1 contracts: done
- Built: zod schemas + types for Profile, Evidence (9-type discriminated union on `type`), SessionState, AgentStreamEvent; plain TS types for Recommendation, ShortlistItem, Breakdown, WhyNot, RelaxOption, Comparison, BeliefSummary, ProfileResult, ObserveResult, AreaFeatures, TravelMatrix, ModelParams, EngineDefaults; signature types for every module (CreateRng/Rng; Saturate, ModelledRent, AnchorMinutes, MonthlyHours, BuildAreaContext/AreaContext; SamplePrior, EffectiveSampleSize, Replay, SummarizeBelief; Likelihood, Predictive, SurpriseThreshold; BuildUtilities/UtilityMatrix, GreedyShortlist, PBest, RiskOfSet, Recommend; BreakdownAt, ExplainWhyNot, ExplainCompare, ExplainRelax; Engine, CreateEngine). rng.ts implemented (mulberry32 + Box-Muller): `createRng(seed)` -> next/normal/lognormal/int. No tests written for rng.ts.
- Files: shared/src/engine/types.ts, shared/src/engine/rng.ts
- Verified: `pnpm --filter @tokyo/shared typecheck` (tsc --noEmit) -> clean, no errors. Nothing was run beyond the typecheck.
- Deviations from spec / choices where it is silent:
  - Recommendation and other engine outputs are TS interfaces, not zod schemas (only model/network inputs have schemas: Profile, Evidence, SessionState, stream events). The `state` stream event payload is `z.custom<AgentStateView>()`, i.e. not validated at runtime.
  - ObserveResult is a union `{ok:true,...} | {ok:false,error}` (spec shows only the success fields) to carry the "typed error, nothing applied" case.
  - TravelMatrix is an interface I invented (stationMinutes, localityAccess, stationsNear); the spec names it but gives no shape. feature-store must implement it.
  - ModelParams = { rentElasticity, layoutAreaSqm: Record<layoutId, m2> }; Profile.layout is a free string, not checked against LAYOUTS ids.
  - Feature keys are my names (supermarkets, dining, konbini, cuisine_variety, late_night, health, green_space, residential_calm, road_rail_exposure, bars, dining_reach, connectedness); PARAM_KEYS order = c_t, the 12 features, lambda_b, gamma.
  - Belief theta is a packed Float64Array (n x 15); utilities Float32Array [i * nAreas + a] per spec.
  - Profile: first anchor is the main anchor; commuteCap is one-way minutes; anchor period is peak | offpeak (default peak) instead of an arrival time; "raise enough" is `enoughMultipliers`.
  - SessionState adds `questionsAsked` (needed for the 6-question stop). time_tradeoff adds optional `tripsPerWeek`. Evidence `id` optional on input, engine assigns.
  - AreaFeatures covers only the columns the engine reads (not all 53); nullability from DDL as listed in P0 recon, not measured.
- Blockers or needs from other packages: shared/src/index.ts needs `export * from './engine/types.js';` and `export { createRng } from './engine/rng.js';` (not added, per rules). E/F/G should annotate exports with the signature types (e.g. `export const samplePrior: SamplePrior = ...`). G/feature-store owns the TravelMatrix implementation and LAYOUTS -> layoutAreaSqm mapping.

## C grounding + sql-guard: done
- Built: `checkGrounding({ reply, toolResults, profile })` -> `{ pass: true }` or `{ pass: false, unmatched: Figure[] }` (plus `collectNumbers`, `extractFigures`); `guardAgentSql(sql)` -> `{ ok: true, sql }` (wrapped as `SELECT * FROM (<query>) q LIMIT 50`) or `{ ok: false, code, reason }`. Neither imports engine types or touches a database.
- Files: api/src/agent/grounding.ts, api/src/agent/grounding.test.ts, api/src/agent/sql-guard.ts, api/src/agent/sql-guard.test.ts
- Verified:
  - `pnpm vitest run api/src/agent/grounding.test.ts api/src/agent/sql-guard.test.ts` -> 2 files, 53 tests passed
  - `pnpm --filter @tokyo/api typecheck` -> clean
- Deviations from spec:
  - Grounding matches a figure against any collected number regardless of its field (an id or count of 24 would ground "24 minutes"). It catches invented figures, not figures attached to the wrong label.
  - Grounding area counts match a collected number or any array length in the results. Only "N areas / neighbourhoods / options / candidates / エリア" is read as a count; "3 feasible areas" and the first number of a range ("10-15 minutes") are not extracted.
  - SQL guard is stricter than the plan: also rejects double quotes, `$`, backslashes, non-ASCII outside string literals, extra words (`into`, `truncate`, `merge`, `call`, `do`, `execute`, `explain` ...), `pg_*` / `information_schema` / `public`, three-part names, comma joins, and any unqualified function not on a small allowlist of builtins (count, sum, avg, round, coalesce, window functions ...). `extract(...)`, `date_trunc`, `IS DISTINCT FROM x` and similar are refused; widen `SAFE_FUNCTIONS` if the model needs them.
  - Semicolons and comment markers are refused even inside string literals, as the plan's rule 2 says.
  - Step 5 (read-only transaction, 5 s timeout) is the caller's job; the guard only validates and wraps.
  - Known gap: the guard is regex-based, not a parser. A comma join after a subquery alias to an unqualified table (`from (select ...) q, listings`) is not caught, so the read-only transaction and the `matchi_agent_ro` role still matter.
- Blockers: none.

## B spec review: done
- Built: errata for docs/plans/engine-spec.md, 28 items (4 blocking, 14 should-fix, 10 minor), plus a short list of formulas checked and found consistent.
- Files: docs/plans/engine-spec-errata.md
- Verified: n/a (reading only; nothing was run, and column facts rest on the P0 recon, which came from migrations, not a live database)
- Deviations: none. Spec not edited.
- Blockers: none for the review. Blocking spec items: E01 (input noise puts a floor under Risk, stop rule cannot fire), E02 (no travel-access input for user anchors in createEngine), E03 (outcome probabilities sum above 1, EVOI negative), E04 (nullable columns give NaN utilities).
- 16:50 wave 1 complete (A, B, C, D). Wave 2 (E, F, G) not dispatched: user asked to stop work at 16:57.
- Errata to forward to E/F when wave 2 starts: E01 (noise-free U for EUS/Risk/Regret/P_best), E02 (no anchor-to-locality travel input; contracts' TravelMatrix is A's invention), E04 (null feature handling). E03 only affects the full EVOI path. Rest stay in docs/plans/engine-spec-errata.md.
- Open: C's sql-guard is regex-based with a known comma-join gap; query_areas must run in a read-only transaction with a 5 s timeout and the matchi_agent_ro role.
