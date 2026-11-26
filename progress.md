# Matchi agent build — progress

Started 16:42 JST 2026-11-17. Demo 20:45 JST.

| Package | Model | Status | Owned paths |
|---|---|---|---|
| D / P0 recon | fable (wave-1 override) | partial: no SQL, .env points at Neon | progress.md (own section only) |
| A / P1 contracts | fable | done 16:48 (typecheck clean; Recommendation not zod) | shared/src/engine/types.ts, rng.ts, features.ts |
| B spec review | fable | done 16:50 (28 errata, 4 blocking) | docs/plans/engine-spec-errata.md |
| C grounding + sql-guard | fable | done 16:49 (53 tests pass; guard regex-based, needs RO txn) | api/src/agent/grounding*.ts, sql-guard*.ts |
| P2 engine (was E; absorbed F) | fable | done 17:13 (64/64 incl. 10 invariants + 937x4000; synthetic data only) | shared/src/engine/** except types.ts, rng.ts |
| F engine decisions | fable | stopped by user; scope moved into P2 | — |
| P4 harness (was G) | opus | done 17:11 (25 tests; e2e turn + grounding retry pass on fake model) | api/src/agent/{model-client,tools,prompt,loop}.ts, api/src/routes/agent.ts, 1 line in application.ts |
| P3 plumbing | sonnet | done 17:04 (24 pass, 2 DB-skips; engine placeholder → 503 until P2 lands) | api/src/agent/{feature-store,session,anchor-times}.ts, api/src/routes/agent-direct.ts, 2 export lines in shared/src/index.ts, 1 line in application.ts |
| P5 page | sonnet | done 17:09 (web typecheck clean; not browser-tested) | web/app/agent/** |
| P0b schema check | sonnet | done 16:55 (columns match the recon; nulls measured) | progress.md |
| P8 stop-rule tuning | fable | done 18:22 (67 engine tests; minQuestions=2) | shared/src/engine/{recommend,index,types?}.ts DEFAULTS + tests |
| P6 eval | sonnet | partial 18:18 (simulate on real data ok; baseline not done; personas not run live) |
| P7 integration | opus | done 18:20 (engine-only /agent verified in Chrome; 179 tests pass) | shared/src/index.ts exports, application.ts wiring, vitest web include, minimal fixes in agent files | scripts/src/eval/** |

## Orchestrator log
- 16:42 docs/plans/engine-spec.md and docs/plans/agent-harness-plan.md do not exist: not in the working tree, git history, stashes, or under ~. Only D (recon) is spec-independent; launched it. A/B/C held pending the user.

## P0 recon: partial (schema map since verified against the local DB, see "P0b schema check" at the end)
Stopped before any SQL: `DATABASE_URL` (and `DATABASE_URL_POOLED`) in `.env` point at Neon (host contains "neon", db `neondb`). No connection was made to any database. Everything below comes from migrations and source; anything needing live data (row counts, null rates, min/median/max, model_params live values) is NOT measured. A Postgres is listening on localhost:5432 (`pg_isready`, no login attempted); `.env.example` documents a local `tokyo` database for it. I did not log in to it because the env var route was the one specified; whether it has migrations 0011 to 0018 applied and derived data loaded is unknown.

- Built:

### 1. agent.area_features (a VIEW, not a table)
Grain: one row per locality (town, chome combined) in the 23 wards; 937 rows, 937 distinct `locality_id`, 23 distinct `ward_code` (verified local DB 2026-11-17). Key: `locality_id` (text; "ward code, colon, hash of the Japanese name"), PK of `public.localities`. Source: `localities l JOIN locality_metrics lm JOIN wards w LEFT JOIN locality_access la`. No geometry. 53 columns (confirmed: 43 numeric, 10 text/boolean) (verified local DB 2026-11-17). It is a view (`relkind v`), so the catalog marks every column nullable; the "Nullable (DDL)" column below is the base-table DDL, and measured null counts are in the "Measured" block after the table (verified local DB 2026-11-17). Column names, order, types and comment text all match the live view (wording of comments differs slightly from the abridged column below; not material).

| Column | Type | Added | Nullable (DDL) | COMMENT (abridged from migration text) |
|---|---|---|---|---|
| locality_id | text | 0011 | no | Stable locality id: ward code, colon, hash of Japanese name |
| name_en | text | 0011 | yes; measured NULL in all 937 rows, i.e. empty locally (verified local DB 2026-11-17) | Romanized name (Japan Post file) |
| name_ja | text | 0011 | no | Japanese name, chome suffix removed (e-Stat 2020 census) |
| ward_code | text | 0011 | no | Five-digit municipality code, 13101 to 13123 |
| ward_name_en / ward_name_ja | text | 0011 | no nulls measured; type text (verified local DB 2026-11-17) | Ward name |
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
| bar_count | integer | 0013 | yes in DDL; 0 nulls measured (verified local DB 2026-11-17) | Bars, pubs, nightclubs within 800 m. Positive for lively, negative for quiet |
| quietness_raw | double | 0013 | yes | Fixed blend 0 to 1: 0.5 residential + 0.3 (1 - exposure) + 0.2 (1 - capped bar density) |
| centrality_minutes | double | 0014 | yes (LEFT JOIN); 11 nulls (verified local DB 2026-11-17) | Mean of the min_to_* columns. Lower is more central |
| min_to_shinjuku, _shibuya, _ikebukuro, _tokyo, _shinagawa, _ueno, _otemachi, _roppongi | double (8 cols) | 0014 | yes | PEAK door-to-door minutes to that hub: walk to one of 3 nearest stations + rail, median over 9 sample points. Modelled, not timetabled |
| line_count | double | 0014 | yes | Distinct rail lines at the 3 nearest stations, median over 9 points |
| direct_reach_stations | double | 0014 | yes | Stations reachable with no transfer within 30 rail minutes |
| stations_within_30_min | double | 0014 | yes | Stations reachable within 30 peak minutes, transfers allowed |
| nearest_station_walk_min | double | 0014 | yes | Walk to nearest station, min (straight line * 1.3 at 80 m/min) |
| access_confidence | text | 0014 | yes; 11 nulls; the only non-null value present is `low` (926 rows), no `high`/`medium` locally (verified local DB 2026-11-17) | Lowest rail edge confidence behind hub times: high / medium / low |
| reach_restaurant | double | 0015 | yes | Rail-reachable restaurants and cafes, time-discounted: sum of station 800 m count * exp(-offpeak door-to-station min / reach_decay_minutes). Index, not a head count |
| reach_cuisine_variety | double | 0015 | yes | Same weighting on station distinct cuisine count |
| reach_late_night | double | 0015 | yes | Same weighting on station late-night count |
| reach_green | double | 0015 | yes | Same weighting on station green share; "station-equivalents of full green cover" |
| population | integer | 0016 | yes | Residents, 2020 census |
| households | integer | 0016 | yes | Households, 2020 census |
| area_sqm | double | 0016 | yes | Area of the census polygons, m2 |
| population_density_per_km2 | double | 0016 | yes | Residents per km2. Low in business districts = few residents, not few people |
| persons_per_household | double | 0016 | yes; 26 nulls (verified local DB 2026-11-17) | Lower = more single-person homes. Null when households is 0 |

Measured (local `tokyo` DB, 937 rows, 2026-11-17; read-only SELECTs; null count / min / median / max):
- Zero nulls, all rows: lat, lon, area_sqm (3039 / 485006 / 15251659), population (0 / 7720 / 62708), households (0 / 4154 / 33156), population_density_per_km2 (0 / 18212 / 53814), rent_per_sqm_yen (1930 / 2775 / 4504), management_fee_yen (3049 / 4306 / 9667), land_price_multiplier (0.85 / 1 / 1.15), land_value_yen_per_sqm (233997 / 786708 / 4667537), land_value_nearest_m (7.9 / 386 / 5506), rent_local_multiplier (0.85 / 1 / 1.15), rent_per_sqm_local_yen (1640.5 / 2740 / 5180), supermarket_count (0 / 14 / 68), restaurant_count (0 / 39 / 716), cafe_count (0 / 9 / 273), convenience_count (0 / 17 / 100), cuisine_variety_count (0 / 16 / 115), late_night_count (0 / 2 / 84), health_count (0 / 17 / 140), bar_count (0 / 12 / 632), green_space_share (0 / 0.030 / 0.343), residential_zoning_share (0 / 0.616 / 0.998), road_rail_exposure_share (0 / 0.393 / 0.895), quietness_raw (0.034 / 0.504 / 0.944). Text/bool with zero nulls: locality_id, name_ja, ward_code, ward_name_en, ward_name_ja, land_price_used_fallback, rent_source, rent_source_period.
- 10 nulls (no access data): line_count (1 / 3 / 10), direct_reach_stations (1 / 33 / 139), stations_within_30_min (1 / 91 / 243), nearest_station_walk_min (1 / 8 / 25), reach_restaurant (3.19 / 806.6 / 10459), reach_cuisine_variety (2.26 / 159.7 / 1594.5), reach_late_night (0.26 / 57.6 / 747.8), reach_green (0.011 / 0.285 / 2.556).
- 11 nulls: centrality_minutes (17.4 / 43.2 / 79.2) and the 8 min_to_* hubs: shinjuku (9.8 / 39.4 / 84.3), shibuya (7.2 / 41.2 / 91.7), ikebukuro (9.8 / 40.8 / 85.9), tokyo (5 / 39.9 / 77.6), shinagawa (10 / 48.5 / 96.1), ueno (4 / 43.1 / 81.4), otemachi (7 / 40.7 / 76.2), roppongi (8 / 45.7 / 82.7). access_confidence also 11 nulls.
- 26 nulls: persons_per_household (1 / 1.82 / 3.62). 937 nulls (all): name_en.
- Other objects: `agent.station_travel_times` (view, 480,208 rows; backed by table `public.station_travel_times`, 480,208 rows) and `agent.model_params` (view, 7 rows; backed by `public.model_params`, 7 rows) exist. model_params keys: reach_decay_minutes 10, rent_local_multiplier_min 0.85, rent_local_multiplier_max 1.15, rent_land_elasticity 0.3555 (n=23, CI 0.3067 to 0.4044, R2 0.916), plus the _ci_low, _ci_high and rent_land_fit_r2 rows.

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

### User rulings 16:51 (override the spec)
- DB: local Postgres localhost:5432/tokyo only, connection string set per command; .env unchanged. Never start the API or run a script without that override.
- Branch: stay on feat/db-improvement-plan.
- E01 accepted: EUS, Risk, regret, the stop rule and question choice all use noise-free U. Noise is used only for P_best (over the top 20 areas by EU) and for compare's "a beats b".
- E02: the engine does no routing. TravelMatrix is removed from createEngine. setProfile takes per-anchor one-way minutes per area (NaN = unreachable), computed in api/src/agent/anchor-times.ts (P3) with reverseDijkstra/localityCommute.
- E03 deferred: shortcut path only, with a TODO.
- E04: null rent inputs, lifestyle columns or access values: area excluded, counted in `excluded` with its reason. Null land value is allowed (multiplier 1.0, wider rent noise).
- query_areas: read-only transaction, 5 s timeout, behind an env flag that is off by default.
- Grounding: accepted for tonight. KNOWN GAP: a real figure attached to the wrong label passes the check.
- Non-blocking errata: E/F apply one-line fixes in code they are already writing; log the rest.
- Orchestrator: model-client.ts moves from P3 to G (the harness owns the model interface and the scripted fake), to avoid two packages defining it.

### P1 contracts: revision 1 (errata E01 to E04), done
- Verified: `pnpm --filter @tokyo/shared typecheck` -> clean (typecheck only). This supersedes the TravelMatrix lines above.
- Removed: TravelMatrix, SamplePointAccess, AnchorMinutes.
- Added: AnchorTimes (Record<anchorId, Float64Array | number[]>, aligned to createEngine's areas order, NaN = unreachable), ComputeAnchorTimes ((anchors, areas) => Promise<{times, refused}>), NoisyUtilities.
- Changed: CreateEngine(areas, params, seed); Engine.setProfile(p, anchorTimes); Engine.restore(s, anchorTimes) (times are not in SessionState); BuildAreaContext(areas, params, profile, anchorTimes); ExplainRelax(areas, params, profile, anchorTimes, belief, seed); ExcludedSummary adds nullRent, nullLifestyle (missingAccess = null access columns, disconnected = NaN anchor minutes); RefusedAnchor.reason adds 'no_times'; WhyNot fails_firm_limit.limit adds 'null_rent' | 'null_lifestyle'; UtilityMatrix.u is noise-free and gains `noisy: {areaIdx, u}` (top 20, E01); AgentStateView adds riskYen, excluded and is also the direct-route view type.
- Comments only: E04 null-land-value note on AreaFeatures; TODO(E03) on NextQuestion.
- Not done: AgentStateView is still z.custom in AgentStreamEventSchema (a real schema needs zod schemas for Recommendation and all its parts; not cheap).

## P0b schema check: done
- Built: nothing in code; progress.md only (P0 recon table annotated in place, measured block added).
- Files: /Users/yato_sar/projects/matchi/progress.md
- Verified: pg_class/pg_attribute/col_description on agent.area_features -> view, 53 columns, names/types/comments match P0 recon exactly (no missing, no extra columns; grain locality, key locality_id, 937 rows, 937 distinct ids, 23 wards). count(*) filter (where col is null), min, percentile_cont(0.5), max for all 43 numeric columns plus null counts for the 10 text/bool -> measured block in P0 recon. agent.station_travel_times -> 480,208 rows; agent.model_params -> 7 rows (both views over public tables of the same name). Connection: localhost:5432/tokyo only, SELECT/catalog only.
- Deviations: (1) the recon's DDL nullability does not hold at view level: the view marks all 53 columns nullable, so non-null engine types rest on current data only. (2) name_en is NULL in all 937 rows locally. (3) access_confidence is `low` in 926 rows and NULL in 11; no `high`/`medium` present. (4) 10 localities have no access data (line_count, direct_reach, stations_within_30, nearest_station_walk_min, reach_*), 11 lack hub times/centrality, 26 lack persons_per_household. (5) bar_count has 0 nulls despite nullable DDL.
- Blockers or needs: none blocking. AreaFeatures (shared/src/engine/types.ts) field-name mismatches against real columns: NONE; all 28 interface fields exist with the same name and a compatible base type. Type/nullability observations for the types.ts owner: (a) name_en typed `string | null` is right but is always null locally; (b) access_confidence typed 'high'|'medium'|'low'|null: only 'low' or null occur locally; (c) non-null number fields (lat, lon, the 7 *_count, green_space_share) have 0 nulls locally but the view does not enforce it; (d) fields typed nullable that are never null locally: ward_name_en, ward_name_ja, land_price_used_fallback, rent_per_sqm_yen, management_fee_yen, land_value_*, residential_zoning_share, road_rail_exposure_share, bar_count (harmless, looser); (e) real columns not in the interface (intentional subset): rent_per_sqm_local_yen, rent_local_multiplier, land_price_multiplier, quietness_raw, centrality_minutes, min_to_* (8), direct_reach_stations, stations_within_30_min, reach_cuisine_variety, reach_late_night, reach_green, rent_source, rent_source_period, population, households, area_sqm, population_density_per_km2, persons_per_household.
- 16:56 wave 2 dispatched: E, F and G on Fable (wave override); P3 and P5 on Sonnet (original routing). Direct-route contract fixed in the P3/P5 briefs. The engine is injected into SessionStore; createEngine is wired after E+F.
- 16:57 usage limit reached. Told E, F, G, P3 and P5 to checkpoint (typecheck-safe, partial section in progress.md) and stop. Resume the same packages, with their context, when the limit lifts. Nothing from wave 2 is committed yet.
- 17:02 resumed after the usage interruption, on the original routing. E and P3/P5 resumed with their context. The user stopped F; F's scope (recommend, explain, index) folded into E, now P2 per the original plan. G wrote nothing before failing, so P4 harness was relaunched fresh on Opus.

## P3 plumbing: done
- Built: feature store (`loadFeatureStore(pool)`), in-memory `SessionStore`, `createComputeAnchorTimes({pool, graphs})`, the nine direct routes exactly as briefed, and a lazy shared runtime (`createAgentRuntimeGetter`) so P4's route can reuse the same store, sessions and anchor-times.
- Files: api/src/agent/{feature-store,session,anchor-times}.ts, api/src/routes/agent-direct.ts, tests api/src/agent/{feature-store,session,anchor-times}.test.ts, api/src/agent/feature-store.integration.test.ts, api/src/routes/agent-direct.test.ts. Edited: shared/src/index.ts (2 export lines appended), api/src/application.ts (imports, a placeholder createEngine, 1 registration line). Rebuilt shared/dist (`pnpm --filter @tokyo/shared build`) so api sees the new exports.
- Verified: `pnpm vitest run <5 own files>` -> 24 passed, 2 skipped (no DATABASE_URL); with the local DATABASE_URL (+ ALLOW_DESTRUCTIVE_TESTS=1, needed only to pass the repo-wide vitest DB-name guard; the test is read-only) the integration file -> 2 passed (937 areas, elasticity in 0.3-0.4, >40 column comments, a Shinjuku anchor reaches >80% of areas, no refusals). `pnpm --filter @tokyo/api typecheck` and `@tokyo/shared typecheck` -> clean.
- Interfaces (for P4/P5):
  - `SessionStore(createEngine, {areas, params}, opts?)`: `create()`, `get(id)`; CreateEngine is (areas, params, seed) so the store needs the feature store. Oldest session evicted past 1000.
  - `createAgentRuntimeGetter({pool, graphs}, createEngine)` -> `() => Promise<{features, sessions, computeAnchorTimes}>`; loads the feature store on first call (buildApp is sync), memoised, retried after failure. `registerAgentDirectRoute(app, { getRuntime })`. P4's route should take the same `getRuntime`; application.ts currently builds one getter for the direct route only, so P4 must share it (create the getter once in buildApp and pass it to both).
  - Response shapes beyond the brief: why-not -> `{ result: WhyNot }`, compare -> `{ result: Comparison }`, relax -> `{ result: RelaxOption[] }` (no view). Errors use the existing `{error:{code,message,details?}}`: 400 VALIDATION_ERROR, 404 SESSION_NOT_FOUND / EVIDENCE_NOT_FOUND / AREA_NOT_FOUND (compare only), 503 GRAPH_UNAVAILABLE. Send `{}` (not an empty body) on POST /recommend and /relax with a JSON content type.
- Deviations from spec:
  - ModelParams: rentElasticity <- model_params `rent_land_elasticity` (0.3555, not the rounded 0.356); layoutAreaSqm <- LAYOUTS[id].midSqm. Other model_params rows are unused by the engine.
  - Anchor minutes = localityCommute (as /v1/optimize): median over a locality's 9 sample points of the best of walk or rail+walk; walk has no distance cap, so NaN only arises for localities with no samples or no route and no walk point. `outside_coverage` therefore fires only when no area at all is reachable. Both stationId and point given: stationId wins; neither: refused as `unknown_station`. Results cached per (areas array, target, period).
  - PUT profile refusals: the API's refusal replaces the engine's duplicate `no_times` for the same anchor.
  - view.recommendation is null if engine.recommend() throws (swallowed); DELETE evidence checks the id against the snapshot and 404s rather than relying on removeEvidence.
  - application.ts: `createEngine` is a placeholder that throws ApiError 503 ENGINE_UNAVAILABLE (TODO(engine-wiring) comment); replace with the import from @tokyo/shared when shared/src/engine/index.ts exists and is exported. Until then POST /v1/agent/session answers 503 (tested).
- Blockers or needs: createEngine from shared (E+F wiring). Nothing run against the real engine yet.
- 17:05 P3 committed. NOTE: its integration test was run against local tokyo with ALLOW_DESTRUCTIVE_TESTS=1 to pass the vitest DB-name guard; the test is read-only. The direct routes return 503 ENGINE_UNAVAILABLE until TODO(engine-wiring) in application.ts is swapped for the real createEngine.

## P5 page: done
- Built: /agent page (web/app/agent/**). Engine-only mode (profile form with /v1/places anchor search, budget, commute cap, layout; quieter / cheaper / closer, feature more/less, per-card prefer / like / not this / why-not, why-not by locality id, compare, relax, answer buttons for nextQuestion) and chat mode (POST /v1/agent/turn SSE: text deltas, state updates the panels, tool_call/tool_result/grounding/error in Trace; a failed grounding check marks the rejected message and starts a new one for the retry; an error event or non-SSE reply switches chat off with a notice and keeps the engine controls). Panels: Shortlist (chance of being best, regret, role, yen breakdown, confidence labels, excluded counts, risk line, alternative), BeliefPanel, EvidenceChips (quote on chip, delete, put back), Trace. 503 ENGINE_UNAVAILABLE / GRAPH_UNAVAILABLE show as a readable session error with retry.
- Files: web/app/agent/page.tsx; components/{Chat,Shortlist,BeliefPanel,EvidenceChips,Trace,ProfileForm,EngineControls,ui}; lib/{types,client,sse,useAgent,evidence,explain,profile,trace,format}; lib/agent.test.ts (13 tests, mock data labelled).
- Verified: `pnpm --filter @tokyo/web typecheck` -> clean; `pnpm exec eslint web/app/agent` -> clean; `vitest run` with a scratch config (root web, include app/agent/**/*.test.ts) -> 13 passed. Not run in a browser or against the API (not allowed).
- Deviations from spec: (1) engine types are imported type-only by relative path (../../../../shared/src/engine/types) because @tokyo/shared's index does not export them; one line to change in lib/types.ts once it does. (2) "cheaper"/"closer" use time_tradeoff (pay 10,000 yen a month to save 10 min each way: declined / accepted) since the Evidence union has no rent term; "quieter" = direction residential_calm +1. (3) Card "Prefer this" = prefer_area against the neighbouring card. (4) Anchor from a station place sends stationId = place.id (the stationGroupId from /v1/places); other places send a point. Assumed this is the id `lookup` accepts. (5) Budget and commute cap default to firm in the form (checkbox). (6) Removed chips are kept client-side only for Put back (lost on reload).
- Blockers or needs from other packages: (a) web vitest project only includes lib/**/*.test.ts, so root `pnpm test` skips web/app/agent tests; add "app/agent/**/*.test.ts" to the web project include in vitest.config.ts. (b) @fastify/cors defaults to GET/HEAD/POST, so browser PUT /profile and DELETE /evidence will fail preflight unless P3 sets `methods` in the cors registration; CORS_ORIGIN must also include the web origin (default is the prod URL only; local dev needs http://localhost:3000). (c) Export engine types from shared/src/index.ts. (d) No area-name lookup route: why-not by typing needs a locality id; cards cover shortlisted areas only. (e) Assumed /turn replies with content-type text/event-stream and `data: {json}` frames.
- 17:09 P5 committed. Integration todo list:
  - (a) CORS methods PUT/DELETE: given to P4, which already edits application.ts.
  - (b) Add web/app/agent/**/*.test.ts to the vitest web project include.
  - (c) Area-name lookup for why-not.
  - (d) Verify that a station anchor's stationId = /v1/places id.
  - (e) "cheaper"/"closer" buttons map to time_tradeoff; review once the engine lands.
- 17:10 P2 interim committed (engine core). Wiring of createEngine into shared/src/index.ts + application.ts goes to the integration package after P4.
- 17:12 P6 dispatched early, ahead of the plan's 'last' slot: the engine is ready and P6 is independent of P4.

## P4 harness: done
- Built: ModelClient interface + OpenAI-compatible streaming client (fetch; AGENT_MODEL_BASE_URL/API_KEY/MODEL) + createScriptedModel; nine zod-validated tools with typed errors and rounded, labelled results (names in untrusted_text); system prompt + JSON state summary + column comments; turn loop (6 tool calls, 4 model calls incl. one grounding retry, harness auto-recommend after set_profile/observe/remove_evidence, grounding check + one correction, state, done; last 8 turns, no old tool results; 40 turns/session); POST /v1/agent/turn SSE route (rate limit 20/min). query_areas only with AGENT_QUERY_AREAS=1, run as BEGIN READ ONLY / SET LOCAL statement_timeout = 5000 / guarded SQL / ROLLBACK on one pool client.
- Files: api/src/agent/model-client.ts, tools.ts, prompt.ts, loop.ts, tools.test.ts, loop.test.ts; api/src/routes/agent.ts, agent.test.ts; api/src/application.ts (import + registration; getter hoisted to `getAgentRuntime` and shared with registerAgentDirectRoute, as the coordinator allowed; cors `methods: GET,HEAD,POST,PUT,DELETE,OPTIONS` added).
- Verified: `pnpm vitest run api/src/agent/tools.test.ts api/src/agent/loop.test.ts api/src/routes/agent.test.ts` -> 3 files, 25 tests passed; `pnpm --filter @tokyo/api typecheck` -> clean.
- Deviations from spec:
  - Route deps are `{ getRuntime, pool, model?, queryAreasEnabled? }` (on-disk AgentRuntime holds sessions/features/computeAnchorTimes); model undefined = read env, null = "no model configured".
  - No model: SSE `error` (code MODEL_NOT_CONFIGURED, message "no model configured") then `done`. Bad body -> 400 JSON; unknown session / runtime failure (e.g. 503 ENGINE_UNAVAILABLE) -> JSON `{ error: { code, message } }` before streaming, like the direct routes. Errors mid-turn -> SSE `error` (TURN_FAILED) then `done`.
  - Text is not streamed token by token: each model answer is buffered, grounded, and emitted as one `text` event, so a failed draft never reaches the page.
  - One `grounding` event per check: a failure emits grounding(pass:false) before the retry, then grounding with the final outcome. If the retry also fails, sentences with unmatched figures are dropped (plan's fallback).
  - Harness-run recommend does not count against the 6 tool calls; it is added to the assistant's tool_calls so the model sees it. Calls past 6 get a typed `budget_exceeded` result and the next model call is offered no tools.
  - "Last 8 turns" = last 8 user/assistant exchanges (16 messages).
  - Rounding: rent nearest 1,000 yen; other yen (regret, risk, breakdown, gaps) nearest 100 yen; percents whole; minutes whole; hours 1 decimal.
  - lookup: places/stations SQL is not exported from those routes, so tools.ts reuses the same text-ranking helpers with equivalent queries (limit 5). kind "area" searches the feature store in memory.
  - set_profile: anchors given replace the list; missing anchor ids become anchor_1..; layout validated against params.layoutAreaSqm keys; refusal merge copied from agent-direct.ts. Reuses agent-direct's exported buildView.
  - Engine throws with code unknown_area map to a typed `unknown_area` result; other throws -> `engine_error`.
  - No test against the real createEngine: it is not exported from @tokyo/shared's index, and api typecheck cannot import shared/src directly.
- Blockers or needs from other packages:
  - CORS: origin is still `deps.config.CORS_ORIGIN`; .env has no CORS_ORIGIN key, so the default (https://matchi-web-ten.vercel.app) applies and a localhost dev web origin is NOT allowed. Set CORS_ORIGIN locally (.env.example uses `*`).
  - Integration: wire the real createEngine into application.ts (export it from shared/src/index.ts); until then /v1/agent/turn on a real session returns 503 ENGINE_UNAVAILABLE via the session route.
- 17:13 P4 committed. P7 integration dispatched on Opus: wire createEngine, run dev:api against local DB with CORS_ORIGIN=localhost, smoke-test direct + turn routes, run dev:web /agent engine-only.

## E / P2 engine (whole engine): done
- Built: features.ts (feature table, saturate, modelledRent, monthlyHours, buildAreaContext with E04 exclusions and one scale per E08), belief.ts (samplePrior, ESS, replay in log space, summarizeBelief, weightedMoments, distinguishingParam), evidence.ts (all 9 evidence types, predictive, surpriseThreshold, validateEvidence, bindLikelihood), recommend.ts (noise-free U, util.noisy top 20, greedy EUS, P_best, regret, risk, stop rule, next question via the shortcut, alternative, DEFAULTS), explain.ts (breakdownAt, whyNot, compare, relax), index.ts (createEngine with all 10 Engine methods), synthetic-fixtures.ts (seeded, labelled SYNTHETIC).
- Files: shared/src/engine/{features,belief,evidence,recommend,explain,index,synthetic-fixtures}.ts and {features,belief,evidence,recommend,explain,invariants}.test.ts
- Verified: `pnpm vitest run shared/src/engine` -> 6 files, 64/64 pass, including all ten spec invariants (invariants.test.ts) and a 937-area x 4000-sample synthetic run. `pnpm --filter @tokyo/shared typecheck` -> clean. Nothing has been run on real DB rows.
- Errata applied: E01, E04, E05 (log-sum-exp, log weights), E06, E07 (magnitude/like/dislike exempt from surprise), E08 (one scale; prior is a deterministic rescale), E09 (mean-preserving rent noise, travel clamped at 1 min), E10 (typed errors), E11 (V adds back rent and budget penalty; ranks over scorable areas; q=(rank-0.5)/n), E12 (firm limits on point estimates; T_C formula), E13 (role and wins_for_some by z-score; rent excluded in step 3), E15, E16, E17 (replay in id order), E18 (ward median computed in engine), E20, E22, E23 (means everywhere in breakdowns), E27 (unset limits skipped). Not applied: E03 (deferred), E14 (no redraw, no degenerate flag; lowConfidence badge only), E19, E24-E26, E28 (partly: whyNot returns unknown_area; compare throws).
- Choices where the spec is silent: missing or unknown layout uses the median configured size, and 'layout' is reported missing. Next question: missing profile fact first (anchor, layout, budget), then pick_from_shortlist when questionsAsked=0, else the shortcut pair (P_best>0.05, falls back to the top two). questionsAsked goes up by one on each observed pick_from_set/prefer_area/reject_area. Top pick for whyNot = feasible argmax of expected U. Breakdowns use mean gamma x mean c_T. Relax yen gain uses the exact expected U from parameter moments, with the belief held fixed. Evidence naming a non-scorable area -> invalid_evidence. An observe with an existing id replaces that item (edit). Engine.compare throws Error{code:'unknown_area'}. similarNearby is not built.
- Finding (needs a decision, not a bug): on synthetic data one area is the best in about 95% of prior samples (60 areas: 2 distinct winners; 937 areas: 6). Risk starts below 1% of budget, so recommend() can set shouldStop on the first turn. Rent and travel differences outweigh the amenity weights (2 to 5% of budget each). Check this on real rows before the demo; the levers are the archetype percents or stopRiskShare.
- Blockers or needs: shared/src/index.ts needs `export * from './engine/types.js'; export { createEngine, DEFAULTS } from './engine/index.js';` (not my file). Caller must pass layoutAreaSqm from LAYOUTS midSqm and rentElasticity (0.356 fallback).
- 17:15 P2 committed. OPEN: on synthetic data, P_best of one area is ~95% and risk starts under 1%, so recommend() may stop on turn 1 without asking. That would break demo step 2. P7 to measure on real rows before tuning (levers: archetype shares, stopRiskShare).
- 18:16 P7 was cut off around 17:2x by a network error (ENOTFOUND), leaving uncommitted edits to application.ts and shared/src/index.ts and dev servers on :4000/:3000. Resumed with a report deadline of 18:45. The 19:15 cut-line check still stands.

## P6 eval: partial
- Built: `simulate.ts` (200 hidden people drawn from the engine prior, softmax/Gumbel choice at the engine's own BETA_SHARE x scale, answers fed back as pick_from_set, true regret in yen per month after 0 to 6 answers, median/p90/mean table, JSON). Real-data mode (loadFeatureStore + createComputeAnchorTimes from the local DB, anchor = Shinjuku station group, peak, 5 trips/week, 1K, soft budget 100,000, firm 60 min cap) and `--synthetic`. `personas.ts`: seven personas as data, checks applied to every transcript, SSE runner (session create, /v1/agent/turn, probes via the compare route), CLI. Check functions unit-tested on hand-built synthetic transcripts.
- Files: scripts/src/eval/{simulate.ts, personas.ts, engine-loader.ts, simulate.test.ts, personas.test.ts, out/.gitignore}. Output JSON goes to scripts/src/eval/out/ (gitignored by out/.gitignore; `git add -f` if it must ship).
- Verified: `pnpm vitest run scripts/src/eval` -> 2 files, 24 tests pass. `pnpm --filter @tokyo/scripts typecheck` (tsc --noEmit in scripts) -> clean. `npx tsx scripts/src/eval/simulate.ts --synthetic` -> 200 people, 33s; mean regret 831 yen at 0 questions to 364 at 6; median 0 throughout (synthetic data, smoke only). Real run with the local-only DATABASE_URL override, 200 people, 937 areas (768 feasible), 107.6s: median/p90 yen per month by questions 0..6 = 4,757/23,516; 404/6,699; 120/3,709; 85/3,853; 33/3,570; 24/3,427; 0/3,138. Personas runner NOT run (needs a live model and API).
- Deviations from spec: (1) Baseline vs /v1/optimize NOT DONE: the logic is inside the route handler (own candidate SQL, rent and commute model, 8 importance-level axes); reusing it means duplicating the handler and inventing a 12-weight to 8-axis mapping. No baseline number is reported; the JSON says so. (2) The raw synthetic fixtures have one area best for ~94% of prior draws (187 of 200 in my check), so `--synthetic` imposes a seeded urban/quiet trade-off on top (withUrbanTradeoff). (3) Hidden people answer every round regardless of the engine's shouldStop, always with the current shortlist. (4) The engine is loaded by dynamic import of shared/src/engine/*.ts (engine-loader.ts) because @tokyo/shared does not export createEngine and a static import breaks the scripts rootDir. (5) The DB has no locality named Shimokitazawa (only 北沢, 代沢, 上北沢), so the persona matches those names. (6) Persona heuristics (keyword checks for "agent raises it", late-night mention) are labelled severity 'expected'.
- Blockers or needs from other packages: export createEngine from @tokyo/shared (also needed by P7) so engine-loader.ts can become a plain import. Optional root package.json lines: `"eval:simulate": "tsx scripts/src/eval/simulate.ts"` and `"eval:personas": "tsx scripts/src/eval/personas.ts"` (no --env-file, so no .env is loaded; real-data mode needs DATABASE_URL pointing at local Postgres, and refuses non-local hosts). Personas default base URL http://localhost:4000 (the API PORT default); override with --base-url or AGENT_BASE_URL.

## P7 integration: done (todo (c) area-name lookup skipped, optional)
- Built: createEngine + DEFAULTS exported from shared (shared/dist rebuilt); placeholder in application.ts replaced by the real createEngine. API run against the LOCAL db (env override verified with a tsx one-off using the same --env-file flag: DATABASE_URL and DATABASE_URL_POOLED host = localhost:5432; no "neon" in the server log). Port 4000 was held by an unrelated app (pid 36106, not ours, left alone), so the API ran on PORT=4100 with CORS_ORIGIN=http://localhost:3000 (plain string, passed straight to @fastify/cors) and web on :3000 with NEXT_PUBLIC_API_BASE_URL=http://localhost:4100.
- Files: shared/src/index.ts (1 export line), api/src/application.ts (import createEngine, placeholder removed), api/src/routes/agent-direct.test.ts (wiring test now expects 200 + sessionId instead of the placeholder 503), vitest.config.ts (web include + app/agent/**/*.test.ts), web/app/agent/components/ProfileForm.tsx (budget/commute inputs step="any": min=1 step=1000/5 made 100000 and 40 invalid, so the browser blocked Set profile), web/app/agent/components/Shortlist.tsx (round the commute band; it showed "± 5.959357622340737 min").
- Verified:
  - curl smoke (新宿 anchor, 100k firm, 40 min firm, 1K): session 200 (CORS header http://localhost:3000); PUT profile 200, 382 feasible, no refusals; evidence x2 200; DELETE 200 (evidence back to 1); put back 200; why-not 200 (wins_for_some; unknown id -> 200 {kind: unknown_area}); compare 200; compare unknown -> 404 AREA_NOT_FOUND; relax 200; GET session 200 (15 belief params); POST /v1/agent/turn with no key -> 200 text/event-stream, `error` MODEL_NOT_CONFIGURED then `done`.
  - (d) stationId mapping is correct: /v1/places station id = station_groups.station_group_id = the id anchor-times looks up; a 新宿 place id gave 382 feasible areas.
  - Latency, 937 areas, DEFAULTS.samples 4000 (ess 4000 on a fresh profile): recommend 32-55 ms per call (9 calls over 3 profiles); PUT profile 118-305 ms; evidence POST 42-64 ms. Well under 2 s.
  - Real Chrome (Claude in Chrome) on http://localhost:3000/agent: session created; profile set via form (anchor search 新宿 -> station, 100000, 40, 1K) -> "382 areas pass your firm limits"; Quieter, Cheaper, Closer -> 3 chips; removed "cheaper" chip -> moved to Removed; Put back -> back; shortlist (5 cards with pBest, regret, breakdown) and belief bars rendered; trace logged every step; no console errors. Not clicked in the browser: Like/Not this/Prefer, why-not, compare, relax, More/Less, chat send (these were checked by curl only, apart from chat).
  - `pnpm --filter @tokyo/shared typecheck` -> exit 0; `@tokyo/api typecheck` -> exit 0; `@tokyo/web typecheck` -> exit 0.
  - `pnpm vitest run api/src/agent api/src/routes/agent.test.ts api/src/routes/agent-direct.test.ts shared/src/engine web/app/agent` -> 16 files passed, 1 skipped; 179 tests passed, 2 skipped. `vitest run --project web` now runs the 13 app/agent tests (54 total pass).
- Stop-rule measurement on real rows (layout 1K, firm limits; ev1 = direction residential_calm +1, ev2 = time_tradeoff ¥10,000 / 10 min declined):
  | profile | stage | top pBest | riskYen | risk/budget | shouldStop | nextQuestion |
  |---|---|---|---|---|---|---|
  | 新宿, 100k, 40 min (382 feasible) | profile | 0.123 (梅里) | 159 | 0.16% | true (risk_below_threshold) | null |
  | | +ev1 | 0.123 | 161 | 0.16% | true | null |
  | | +ev2 | 0.128 (光が丘) | 89 | 0.09% | true | null |
  | 渋谷, 100k, 40 min (335) | profile | 0.114 (大宮, Suginami) | 290 | 0.29% | true | null |
  | | +ev1 | 0.118 | 298 | 0.30% | true | null |
  | | +ev2 | 0.136 | 256 | 0.26% | true | null |
  | 渋谷, 130k, 30 min (186) | profile | 0.093 | 225 | 0.17% | true | null |
  | | +ev2 | 0.116 (駒沢) | 144 | 0.11% | true | null |
  | 新宿, 80k, 45 min (256) | profile | 0.131 (光が丘) | 128 | 0.16% | true | null |
  | | +ev2 | 0.141 | 71 | 0.09% | true | null |
  Reading: on real rows the top pBest is low (9-14%; 5th card often 0%), but riskYen is 70-300 yen (<0.3% of budget), so shouldStop is true from the first recommend and no question is ever asked. Same with no profile at all (page showed risk ¥76, "Stopping"). Engine code and DEFAULTS untouched.
- Deviations from spec: API on :4100, not :4000 (port taken by another app). Feature store does not fall back to 0.356: it throws if model_params has no rent_land_elasticity row (local has 0.3555).
- Blockers or needs from other packages:
  - Engine/coordinator: stop rule fires immediately on real data (table above); tuning decision needed for the demo to show questions.
  - Data: local station_groups.name_en holds Japanese names (新宿), so searching "Shinjuku" in /v1/places finds no stations, only POIs; type 新宿/渋谷 in the demo.
  - API (not changed): a POST/DELETE with Content-Type: application/json and an empty body answers 500 INTERNAL_ERROR (fastify FST_ERR_CTP_EMPTY_JSON_BODY), should be 400. The web client never sends that.
  - Page: why-not by typing still needs a locality id (todo (c) not built).
  - All my dev servers stopped (:3000, :4100 and both tsx watchers); :4000 is the unrelated app and was left running.
- 18:21 P7 committed. Engine-only /agent works end to end against the local DB.
- DECISION 18:21 (orchestrator, deviation from spec): on real rows riskYen is only Y71-298 (<0.3% of budget) while top pBest is just 9-14%, so the 1% stop rule fires on turn 1 and the agent never asks. For a conversational product, I'm adding minQuestions=2: should_stop requires questionsAsked >= minQuestions (or maxQuestions reached, or no feasible pair), and nextQuestion is produced whenever should_stop is false. Risk is still reported truthfully, which also fits demo step 5 ("worth under 1,000 yen a month"). Dispatched to Fable (engine routing).
- Demo notes: local station names are Japanese only. Type 新宿 / 渋谷, not "Shinjuku". Port 4000 is taken by an unrelated app, so run the API on 4100 with NEXT_PUBLIC_API_BASE_URL=http://localhost:4100 and CORS_ORIGIN=http://localhost:3000. Not browser-tested yet: chat mode (needs a model key), Like/Prefer/compare/relax clicks.
- Logged, not fixed: an empty JSON body returns 500 instead of 400; the feature store throws if the rent_land_elasticity row is missing (it exists locally); P6's engine-loader still imports by dynamic path and could switch to the @tokyo/shared export; area-name lookup for why-not was skipped.

## P8 stop-rule tuning: done
- Built: `minQuestions: 2` in EngineDefaults/DEFAULTS. Stop = questionsAsked >= maxQuestions, OR (risk < stopRiskShare*scale AND questionsAsked >= minQuestions), OR no question can be formed (no missing fact and < 2 shortlisted areas). When not stopping a question is always produced: q=0 shortlist pick (unchanged), q>=1 closest-to-half pair; if < 2 areas pass pBest > 0.05, falls back to the top two shortlist items by expected utility (was: top two by pBest). riskYen and all figures unchanged.
- Files: shared/src/engine/recommend.ts, shared/src/engine/types.ts (minQuestions only), shared/src/engine/recommend.test.ts. index.ts unchanged (already passes DEFAULTS and questionsAsked).
- Verified: `pnpm vitest run shared/src/engine` -> 6 files, 67 passed (64 existing + 3 new); `pnpm --filter @tokyo/shared typecheck` -> clean; `pnpm --filter @tokyo/shared build` -> clean; `pnpm vitest run api/src/agent api/src/routes/agent-direct.test.ts api/src/routes/agent.test.ts` -> 9 files passed, 1 skipped; 102 passed, 2 skipped.
- Changed test: recommend.test.ts "recommend returns an ordered shortlist..." previously allowed shouldStop at q=0; now asserts shouldStop=false and a pick_from_shortlist question. No invariants.test.ts expectation changed.
- Deviations from spec: risk stop gated on minQuestions=2 (orchestrator decision). At q=0 the question is still the shortlist pick (spec step 2), not a pair; the pair comes from q=1. When stopping because no question can be formed and risk is not low, stopReason is null (the stopReason union in types.ts has no "no_question" value; adding one is outside my paths).
- Blockers: none. Follow-up suggestion: add a 'no_question' stopReason in types.ts and api tools mapping.
- 18:23 P8 committed. All packages are done or partial and committed: 182 tests pass (2 DB-skips); shared, api and web typecheck clean.
- Remaining "done tonight" item: a full chat conversation with a real model. No AGENT_MODEL* variables exist in .env or the shell, so it can't be verified until the user provides them. The harness is tested only against the scripted fake model.
- Follow-ups (not blocking): a 'no_question' stopReason; a 400 for empty JSON bodies; the elasticity fallback in the feature store; area-name lookup for why-not; the P6 baseline vs /v1/optimize; a live personas run.

### Demo run commands (local DB only; never without the override)
  LOCAL_DB="$(grep -E '^# DATABASE_URL=postgresql://tokyo' .env.example | sed 's/^# DATABASE_URL=//')"
  DATABASE_URL="$LOCAL_DB" DATABASE_URL_POOLED="$LOCAL_DB" PORT=4100 CORS_ORIGIN=http://localhost:3000 \
    AGENT_MODEL_BASE_URL=... AGENT_MODEL_API_KEY=... AGENT_MODEL=... pnpm dev:api
  NEXT_PUBLIC_API_BASE_URL=http://localhost:4100 pnpm dev:web   # then open http://localhost:3000/agent
  (PORT is read by api/src/config.ts; default 4000 is taken locally by an unrelated app.)
- 19:03 The ai& model keys are now in .env (names checked only). E2E live-model test dispatched (sonnet; test-and-report only, no code edits; report by 19:40).
- 19:07 USER-APPROVED: in .env the two Neon DATABASE_URL lines are commented out for tonight and replaced with the local localhost:5432/tokyo URL (backup in the session scratchpad). Verified via node --env-file: both URLs resolve to localhost:5432/tokyo; psql current_database=tokyo, 937 area_features rows, 7 model_params. No active .env line mentions neon. Restore the Neon lines after the demo.

## E2E test (live model): partial
Tested 19:07-19:20 JST against the LOCAL DB (both URLs verified localhost:5432/tokyo; no "neon" in the log), API :4100, web :3000, model ai& deepseek-v4.1-flash. No `reasoning_effort` sent. Read-only DB. All processes stopped, browser tab closed; :4000 left alone. Not run: Like/Prefer/relax clicks in the browser, the full-length "stop rule fires and the agent says it is done" conversation.
- Works:
  - Live model reaches the API: no MODEL_NOT_CONFIGURED; first event ~0.8-1.9 s, `done` 2-6 s per turn (tool turns), see Latency.
  - Browser step a (messy sentence, English): 2 lookups (parallel), set_profile (Waseda peak 5/wk, Shibuya offpeak 3/wk lateReturn=true, budget 85,000 not firm), observe (4 items), harness recommend, reply, grounding pass, state. Chips, shortlist (5 cards), belief bars all rendered. Console: no errors (only Vercel analytics debug logs). API log: no 4xx/5xx.
  - Step b: the engine's next question is relayed. Turn 1 asked the layout ("what layout do you need"), turn 2 (after "1K is fine") asked to pick among 5 areas, turn 3 (after answering "I'd pick 中村南. A quiet street matters more...") asked a pair: "光が丘 or 西新小岩". Belief bars moved: Road and rail noise -3.7% -> -6.8%, Residential calm 4.0% -> 4.6%, Green space 3.7% -> 2.6%; ESS 1327 -> 273; risk line 402 -> 225 -> 143 yen/month.
  - Step d: removing all four "I hate noise." chips changed the shortlist (中村南/光が丘 swapped, 関町北 entered, 西新小岩 left; noise weight -6.8% -> -5.6%); "Put back" x4 restored exactly the earlier shortlist and ESS 273. Removing only ONE of the four chips changed nothing visible (same cards, ESS 273 -> 277).
  - Step e: trace lists every call/return, "grounding check: pass", the state line. The risk figure ("What I still don't know about you is worth about ¥143 a month") is in the shortlist panel, not in the trace.
  - Japanese input is fast and good: 「新宿で週5日…静かさが絶対条件」 gave lookup -> set_profile + 3 observe items (magnitude residential_calm essential, direction road_rail_exposure -1, bars -1) in 3.5 s, and a Japanese reply; with a contradiction ("the lively one, 亀有") the agent said "「静かさが絶対条件」と「lively」はぶつかりますが、どちらが正しいですか".
  - Grounding: 0 failures and 0 retries in all 7 personas + browser; 0 tool-validation errors in the personas (all tool_result ok).
- Works badly (with evidence):
  - Reply figures are rounded to 1,000 yen while the cards are exact: reply "西新小岩 ... ¥79,000", card ¥79,171; reply "光が丘 ¥86,000", card ¥85,645; "road/rail exposure −¥4,000" vs card −¥3,971/−¥4,021. Grounding accepts it (the tool result is rounded), but a viewer comparing chat and cards will see differences.
  - Evidence chips are indistinguishable: four chips all read “I hate noise.” (observe items use the whole sentence as quote). Demo step d ("delete the noise chip") is ambiguous, and deleting one does nothing visible.
  - "I hate noise." became bars -1 AND late_night -1 for a night-shift worker (late_night -1 is a questionable proxy); the model also invented tripsPerWeek=5 for the Waseda anchor (user never said it).
  - 下北沢 is not an area in this DB (areas are 町 names: 代田, 北沢, 上北沢; 下北沢 exists only as a station, id mlit-下北沢-35.662-139.667). So "Why not 下北沢?" can never succeed through lookup(area). (Todo (c) area-name lookup.)
  - query_areas is advertised to the model but disabled ("query_areas is turned off on this server."); the model tries it (rounds wasted): seen in "Why not 代田?" and in the 亀有 turn.
  - Replies run long for the "stay brief" goal: 4-6 sentences plus all 5 areas listed in the question each turn.
  - Chat panel trace shows only "call lookup / lookup returned" with no inputs or results.
- Broken (with evidence):
  1. **DSML tool-call markup leaks into the chat as the reply (the headline bug).** The loop gives the model MAX_MODEL_CALLS_PER_TURN=4 calls, 3 in the tool phase, and the third (`lastToolCall`) is offered NO tools. When the model still wants a tool (any turn needing 3 sequential tool rounds) it writes DeepSeek's native call syntax as text, and that text is emitted as the reply. Browser: "Why not 下北沢?" -> GUIDE shows `<｜DSML｜ calls> <｜DSML｜ invoke name="query_areas"> <｜DSML｜ parameter name="area_ids"...`; "Why not 代田?" -> same with `invoke name="lookup"` (even though why_not had already run). Event sequence for "Why not 下北沢?" (curl): tool_call lookup(area) -> result matches [] -> tool_call lookup(station) -> text DSML -> grounding pass:true -> done. all 7 personas had it on at least one turn (student T1, school_late_shift T1+T2, two_commutes T1, like_shimokitazawa T1+T2, contradictor T1, out_of_coverage T1, impossible_limits T1); every English first message does lookup("Shinjuku") then lookup("新宿") sequentially and runs out of rounds. The grounding check passes it (no figures). The leaked text is also stored in session.turns, which feeds the next prompt.
  2. **Polluted history then stalls the model for 60 s.** After the DSML turn, the next turns of the same session ended in `error TURN_FAILED "The operation was aborted due to timeout"` (contradictor persona turns 2 and 3; reproduced by curl: turn 2 returned more DSML (with a zero-width joiner inside "<｜‍DSML｜"), turn 3 = error at 60.1 s). The page would show a failed turn after a minute.
  3. Because the final round has no tools, the model's DSML calls are guesses at parameter shapes (`set_profile` with `profile`, `days_per_week`, `budget_hard`...) that would fail validation if executed.
  4. Persona checks fail mostly as a consequence of 1 (no set_profile ever ran: "0 anchor(s)", "no like_area evidence", "5 shortlisted, 0 relax option(s)"), plus the persona set is English-name based on a Japanese-only DB.
- Latency figures (curl and browser, JST, reasoning model, no reasoning_effort):
  - First event 0.8-1.9 s; `done`: 4.8 s (messy first message, 5 tool calls), 3.4 s (set_profile + why_not + recommend), 3.5 s and 5.7 s (Japanese, with observe), 2.0-2.7 s for the DSML leaks. Browser turns: API logged 2.7-4.8 s per chat turn (the page showed the reply within the 8-10 s I waited). Engine calls 90-260 ms.
  - Worst case 60.1 s (model timeout) on a polluted session. Acceptable for a live demo when the model behaves (3-6 s).
- Personas results table (7 of 7 ran, whole run 149 s incl. two 60 s timeouts; the runner records no per-turn latency; checks every transcript: stream ok / grounding / firm limits / tool validity / tool budget):
  | persona | result | tool calls (turns) | tool-call errors | grounding fail/retry | failed checks |
  |---|---|---|---|---|---|
  | student | FAIL | 6 (2) | 0 | 0 / 0 | no shortlisted area over 70,000 (74,603 / 75,671 / 73,290 shown; the budget is firm=true in the stored profile, so the engine let over-budget areas into the shortlist or the profile was set after; not investigated further); warn: evidence lacks konbini, late_night |
  | school_late_shift | FAIL | 8 (2) | 0 | 0 / 0 | both anchors in profile (0 anchors); late-night flag |
  | two_commutes | FAIL | 4 (1) | 0 | 0 / 0 | reachable from both anchors (0 anchors) |
  | like_shimokitazawa | FAIL | 8 (2) | 0 | 0 / 0 | like_area item; compare probe |
  | contradictor | FAIL | 2 (3) | 0 | 0 / 0 | stream error TURN_FAILED timeout x2; surprising item flagged |
  | out_of_coverage | PASS | 4 (1) | 0 | 0 / 0 | none (vacuously: profile never set) |
  | impossible_limits | FAIL | 2 (1) | 0 | 0 / 0 | empty shortlist with relax options |
  Every persona had a DSML reply on at least one turn; the verdicts therefore say more about bug 1 than about the model's judgement.
- Quality notes: observe use is sensible in Japanese and in the messy English sentence (strength/quote fields filled; magnitude essential used for "絶対条件"); life facts go to set_profile (anchors, budget, layout, late return) not observe; figures: always from tool results, but rounded (see above); the contradiction was caught in prose, but the engine's `surprising` flag stayed false for like_area at 7% "how expected"; next_question is relayed faithfully (layout, pick of 5, pair); grounding never needed a retry.
- Top 5 fixes ranked by demo impact (NOT made):
  1. api/src/agent/loop.ts: stop the DSML leak. Raise MAX_MODEL_CALLS_PER_TURN (4 -> 7) and/or keep tools offered on the last tool-phase call; and add a guard on finalText: if it contains `DSML` / `<｜` (match with an optional zero-width char) or is empty, do not emit or store it: re-ask once with tools and a "answer in plain text now" message, else fall back to a fixed sentence built from the last recommend result. Also never push such text into session.turns.
  2. api/src/agent/prompt.ts (+ tools.ts lookup): tell the model the local names are Japanese only (search 新宿 not Shinjuku), or make lookup(kind=station/area) try a Japanese/English fallback itself, so the first message needs 1 lookup round instead of 2.
  3. api/src/agent/tools.ts: do not advertise query_areas when queryAreasEnabled is false (filter it out of tools.specs); add a station-to-area fallback in why_not/lookup(area) so "Why not 下北沢?" resolves (or make the demo use a real area such as 代田/光が丘/中村南).
  4. api/src/agent/prompt.ts and web/app/agent/components (evidence chips): make observe quotes short per item (the specific words) or have the chip label show feature + direction ("Road and rail noise: less"), so four chips are not all “I hate noise.”; tell the model not to set late_night/bars for a plain "noise" statement.
  5. api/src/agent/prompt.ts / tool result formatting: have the model quote money exactly as on the cards (the tool rounds to 1,000; the cards show exact yen), or round the cards to match; shorten replies (max 3 sentences, name only the two areas of the question). Also set a shorter model timeout (e.g. 20 s) with one retry so a stall does not cost 60 s.
- Verified: node --env-file=.env check -> localhost:5432/tokyo for both URLs; curl POST /v1/agent/session 200; POST /v1/agent/turn SSE (messy sentence) 200, 4.8 s to done; browser flow on http://localhost:3000/agent (Claude in Chrome, a, b, c, d, e; console clean); `pnpm exec tsx scripts/src/eval/personas.ts --base-url http://localhost:4100 --out <scratchpad>/personas.json` -> 1 PASS / 6 FAIL, 149 s (output written to the scratchpad, not the repo); curl reproductions of "Why not 下北沢?" (DSML), "Why not 代田?" with profile set (works in one round: needs_weight_change, late_night x5.1, ¥3,600 behind), Japanese contradictor (works) and English contradictor (DSML then 60 s timeout). GIF "agent_demo_flow.gif" (31 frames, 7 MB) was exported to the browser's Downloads folder; it includes the DSML failure at the why-not step.

## Fix DSML leak: done
- Built: sanitizeReply (strips DSML/tool-call markup incl. fullwidth bar/＜, zero-width, <tool_call>, <function_calls>, tool▁calls▁begin; cuts to end) on the final and retry text; fallbackReply from the current AgentStateView (top area name_en ?? name_ja, whole-percent pBest via toPercent, next question as one sentence, else "The cards show the details."), grounded with the percent added as an extra source; MAX_MODEL_CALLS_PER_TURN 4 -> 7; tools always offered, unrun tool calls on the last tool-phase call -> fallback; model throw after a tool ran -> fallback + grounding + state + done (before any tool: TURN_FAILED as before); stored turns only sanitized/fallback text; polluted stored assistant turns dropped from context; DEFAULT_TIMEOUT_MS 25 s (+ optional AGENT_MODEL_TIMEOUT_MS); createAgentTools(layouts, { queryAreasEnabled }) hides query_areas from specs (still callable -> disabled); prompt: Japanese-names rule and max 3 sentences.
- Files: api/src/agent/{loop,model-client,tools,prompt}.ts, loop.test.ts, tools.test.ts, api/src/routes/agent.ts. Commit 48c0d94.
- Verified: pnpm vitest run api/src/agent api/src/routes/agent.test.ts api/src/routes/agent-direct.test.ts -> 9 files passed, 1 skipped; 119 tests passed, 2 skipped; pnpm --filter @tokyo/api typecheck -> clean. No live-model check run.
- Deviations from plan: createAgentTools option defaults to enabled when omitted (keeps existing callers). Polluted assistant turns are dropped alone (their user message stays). progress.md left out of the commit (it holds other agents' uncommitted edits).
- Blockers: none.

## DSML fix retest: FIXED
Retest of commit 48c0d94, live model deepseek-ai/deepseek-v4.1-flash-1017, local DB only (localhost:5432/tokyo verified), API on :4100. Raw SSE and scripts in the session scratchpad (.../scratchpad/rt/).
- Per-test table (every turn: no markup, no error event, state event then done last; "grounding" is the final event)

| test | run | turn | markup? | fallback? | tools (count) | anchor? | grounding | errors | secs |
|---|---|---|---|---|---|---|---|---|---|
| 1 JA setup / why-not 代田 / cheaper | 1 | 1 | no | no | lookup,lookup,set_profile,observe,recommend (5) | yes (2 anchors) | pass | none | 4.4 |
| | | 2 | no | no | lookup,why_not (2) | - | fail(2) then pass | none | 2.6 |
| | | 3 | no | no | recommend,relax (2) | - | pass | none | 1.5 |
| | 2 | 1 | no | no | lookup x2,set_profile,observe,recommend (5) | yes | fail(1) then pass | none | 3.9 |
| | | 2 | no | no | lookup,why_not,observe,recommend (4) | - | pass | none | 3.0 |
| | | 3 | no | no | relax,recommend (2) | - | pass | none | 1.7 |
| | 3 | 1 | no | no | lookup x2,observe,recommend,set_profile,recommend (6) | yes | pass | none | 3.3 |
| | | 2 | no | no | lookup,why_not (2) | - | pass | none | 1.9 |
| | | 3 | no | no | recommend,relax (2) | - | pass | none | 1.8 |
| 2 EN first msg / why not Daita / cheaper | 1 | 1 | no | no | lookup x2,set_profile,observe,recommend (5) | yes | pass | none | 2.5 |
| | | 2 | no | no | lookup,why_not (2) | - | pass | none | 2.1 |
| | | 3 | no | no | recommend (1) | - | pass | none | 1.5 |
| | 2 | 1 | no | no | same 5 | yes | pass | none | 2.7 |
| | | 2 | no | no | lookup,why_not (2) | - | pass | none | 2.2 |
| | | 3 | no | no | recommend (1) | - | pass | none | 1.9 |
| | 3 | 1 | no | no | same 5 | yes | pass | none | 2.8 |
| | | 2 | no | no | lookup,why_not (2) | - | pass | none | 2.0 |
| | | 3 | no | no (text has "0%" but came from tool results, relax ran) | recommend,relax (2) | - | pass | none | 2.0 |
| 3 why not 下北沢 | 1 | 1 | no | no | same 5 | yes | pass | none | 3.1 |
| | | 2 | no | no | lookup x3,why_not (4) | - | pass | none | 2.8 |
| | | 3 | n/a | n/a | none | n/a | n/a | HTTP 429 RATE_LIMITED (my own 20 turns/min limit, not the bug) | 0.05 |
| | 1b rerun | 1 | no | no | same 5 | yes | pass | none | 3.3 |
| | | 2 | no | no | lookup x2,recommend (3): said 下北沢 is not an area in the DB (station only) | - | pass | none | 3.3 |
| | | 3 | no | no | recommend (1) | - | pass | none | 1.5 |
| 5 browser, test 1's 3 turns | 1 | 1-3 | no | no | UI trace: lookup x2,set_profile,observe,recommend; then replies | yes (anchor 大学(早稲田)) | "Grounding check passed" on all 3 | none | each under ~8 s |
| 6 personas (7 personas, 11 turns) | - | - | 0 of 11 replies | not checked | 52 tool calls | 7 of 7 had set_profile with an anchor | all pass | none | ~50 s total |

- Evidence for any failure: none for the DSML bug. grep for U+FF5C, DSML, tool_call>, function_calls, tool▁calls over all 23 saved SSE files: zero hits (also zero in personas.json). No TURN_FAILED or timeout anywhere; slowest turn 4.4 s. Browser chat panel showed clean Japanese/English text.
- Other observations:
  - The fallback path (tool-round exhaustion) never triggered live: max 6 model-driven tool calls in a turn, so the original failure condition was not reproduced; the fix is confirmed by absence of leakage and by unit tests, not by watching the fallback fire. Never saw fallback-style text.
  - Grounding emitted FAIL then pass in 2 turns (t1 r1 turn 2 and t1 r2 turn 1): the loop's retry fixed it, final reply grounded.
  - English first message now works: "Shinjuku" lookup no longer breaks; anchors set via lookup,lookup,set_profile in all 3 runs.
  - Rate limit 20 turns/min caused one 429 in my script (rerun as 1b).
  - Personas (not about markup): 4 pass, 3 fail: student (recommend rent 75-76k over firm budget 70k), school_late_shift ("late-night flag" not mentioned in a reply text), out_of_coverage (anchor not refused with reason). These look unrelated to the DSML fix; not investigated.
  - MISTAKE to disclose: at cleanup I ran `pkill -f "next dev"` to stop my web app; it also killed a Next dev server outside this repo (pid 36104, /Users/yato_sar/hackathon/daytona/liveshot, `next dev --hostname 0.0.0.0 --port 4000`). Port 4000 is now not listening. It needs restarting from that directory by the user.
- Verified: node --env-file=.env URL check -> localhost:5432/tokyo for both; pnpm dev:api on 4100 /health -> ok, db reachable; 8 curl sessions x3 turns -> table above; pnpm dev:web with NEXT_PUBLIC_API_BASE_URL=http://localhost:4100 + Chrome new tab, 3 turns -> clean; AGENT_BASE_URL=http://localhost:4100 pnpm exec tsx scripts/src/eval/personas.ts -> exit 1 (3 persona check failures, 0 markup, 7/7 anchors); API and web stopped, port 4100 and 3000 no longer listening, tab closed. No code or config edited.

## 2026-11-26 — Agent shipped to production

- Sessions now live in `public.agent_sessions` (migration 0019) instead of memory, so chats survive across Vercel instances.
- Neon `neondb` was replaced with a dump of the local DB (all 19 migrations, counts match local, `data:validate` ok). No separate branch.
- Vercel production branch is `main` for matchi-api and matchi-web. Vercel's type check saw an empty `Response` type, fixed in `53eb28f`.
- Prod checks: `/health` ok, agent session create/reload ok, 8 sessions saved on Neon (7 with turns), persona eval 4/7 pass with no markup leaks (fails: school_late_shift off-peak anchor, like_shimokitazawa like_area, contradictor surprising flag — model behaviour, same kind as earlier local runs). Optimizer, stations, places, neighborhood and locality endpoints return 200. Browser flow not yet run on prod.
