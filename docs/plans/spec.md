# Tokyo Neighborhood Optimizer — Lean Portfolio MVP (SPEC)

This document is the binding authority. The implementation plan argues from it.

## Summary

Build a credible end-to-end optimizer before adding platform infrastructure.

Core flow:

```text
User constraints
      |
Next.js UI
      |
Fastify API
      |
PostgreSQL + PostGIS
 - rent estimates
 - station areas
 - amenities/hazards
 - weighted rail graph
      |
Transparent scoring
      |
Ranked neighborhoods
```

Keep:

- Next.js frontend and one Fastify backend.
- PostgreSQL/PostGIS.
- Four focused import scripts.
- A simple weighted transit graph using Dijkstra.
- Deterministic rent estimation and ranking.
- Basic automated tests, logs, and deployment.

Do not initially add Redis, BullMQ, a worker service, object storage, immutable dataset versioning, custom RAPTOR, full GTFS persistence, generated API clients, or enterprise monitoring.

## 1. Application Architecture and Data

### Project structure

Use one repository without Turborepo or an elaborate package hierarchy:

```text
/web                 Next.js application
/api                 Fastify application
/shared              Zod contracts and shared TypeScript types
/scripts             Import and derived-data scripts
/db/migrations       SQL migrations
/data                Gitignored downloaded source files
/docker-compose.yml  Local PostGIS only
```

Production deployment:

- Next.js web service on Render.
- Fastify API service on Render.
- Managed Render PostgreSQL with PostGIS.
- Basic Render logs and optional Sentry error reporting.
- Run imports manually during development and before releases.
- Add Render Cron only after the import scripts are proven reliable.

### Source policy

- Use MLIT for stations, rail topology, land prices, zoning, and flood data. Prefer directly downloadable data; use an individual API key where it materially simplifies ingestion. https://www.reinfolib.mlit.go.jp/help/apiManual/
- Use e-Stat's 2023 Housing and Land Survey for ward-level rent and management fees. https://www.e-stat.go.jp/stat-search/files?cycle=0&tclass=000001207743
- Use REINS quarterly ward-level rent statistics only if recurring reuse permission is straightforward. Otherwise, the app works entirely from e-Stat and labels the older vintage. https://www.reins.or.jp/pdf/trend/sc/sc_202604-06.pdf
- Use durably licensed ODPT/GTFS feeds for segment-time evidence where individual registration is sufficient. Do not depend on challenge-limited feeds. https://developer.odpt.org/
- Use OpenStreetMap for supermarkets, restaurants, cafes, major roads, and nightlife POIs, with required attribution. https://www.openstreetmap.org/copyright

### Import scripts

Implement four explicit scripts rather than a generic ETL framework:

- `pnpm import:mlit`
  - Import wards, stations, rail lines, land-price points, zoning, and flood polygons.
- `pnpm import:rent`
  - Import e-Stat rent/management fees and optionally REINS quarterly values.
- `pnpm import:osm`
  - Import supermarkets, grocery stores, convenience stores, restaurants, cafes, bars, and major roads.
- `pnpm import:transit`
  - Read available GTFS/ODPT files and derive only station mappings and typical rail-edge times/headways.

Each script:

1. Downloads or reads a local source file.
2. Validates required columns and a few sensible row-count bounds.
3. Replaces/upserts its tables within one database transaction.
4. Writes one `import_runs` record with source, timestamps, status, row counts, and error text.

Store `source_updated_at` and `imported_at` on imported records. Do not build immutable snapshots or active-version pointers. Retain small test fixtures in Git; keep full source files in the ignored `/data` directory.

Run `pnpm derive` after imports to rebuild station catchments, neighborhood metrics, and rent estimates.

## 2. Database Schema and Core Calculations

### Essential tables

- `import_runs`
  - `source`, `source_updated_at`, `started_at`, `finished_at`, `status`, `rows_imported`, `error`.
- `wards`
  - Municipality code, Japanese/English name, PostGIS polygon.
- `station_groups`
  - Station complex ID, Japanese/English names, aliases, representative point.
- `station_source_refs`
  - Maps MLIT/ODPT/GTFS identifiers to a station group.
- `rail_lines`
  - Operator, name, mode, geometry, source.
- `rail_edges`
  - Origin, destination, line, peak/off-peak travel minutes, wait minutes, confidence, source.
- `station_areas`
  - Station group and 800 m PostGIS catchment polygon.
- `rent_stats`
  - Ward, period, source, rent/m2, management fee, sample count where available.
- `land_prices`
  - Residential land-price point and year.
- `zoning_areas`
  - Zoning category and polygon.
- `flood_zones`
  - Flood-depth category and polygon.
- `pois`
  - Category, name, OSM identifier, point geometry.
- `neighborhood_metrics`
  - Precomputed rent range, flood exposure, amenity counts, quietness inputs, and source dates.

Use GiST indexes for geometry and ordinary indexes for station IDs, ward codes, and POI categories.

### Station-anchored neighborhoods

The computational unit is an 800 m radius around a station complex, presented as a neighborhood:

> Sasazuka — around Sasazuka Station

This is described as an approximate 10-minute station area, not a true pedestrian isochrone. Interchanges and duplicate operator stations are merged; neighboring stations remain separate recommendations.

### Layout assumptions

The user chooses a layout rather than entering m2:

| Layout | Assumed range | Midpoint |
| ------ | ------------: | -------: |
| 1R     |      18-25 m2 |    21 m2 |
| 1K     |      20-28 m2 |    24 m2 |
| 1DK    |      25-35 m2 |    30 m2 |
| 1LDK   |      32-45 m2 |    38 m2 |
| 2K/2DK |      35-50 m2 |    43 m2 |
| 2LDK   |      45-65 m2 |    55 m2 |
| 3LDK   |      60-80 m2 |    70 m2 |

Display this assumption next to every estimate.

### Simple rent estimator

Use an explainable formula:

```text
ward rent/m2
x assumed layout size
x station land-price multiplier
+ ward management fee
```

The station multiplier is:

```text
clamp(
  (median residential land price in catchment /
   median residential land price in ward) ^ 0.25,
  0.85,
  1.15
)
```

If fewer than three land-price points fall inside the catchment, use `1.0` and lower the confidence.

Calculate:

- Median from layout midpoint.
- Low estimate from layout minimum x 0.90.
- High estimate from layout maximum x 1.10.
- Add the ward management fee to all three.
- Prefer recent permitted REINS rent/m2; otherwise use e-Stat.
- Label every number "modeled area rent," never "available rent."

The budget hard filter uses the median all-in estimate.

### Amenities, flood risk, and quietness

Precompute with PostGIS:

- Supermarkets within 800 m, with smaller weights for grocery and convenience stores.
- Restaurants and cafes within 800 m.
- Catchment share intersecting each official flood-depth category.
- Residential-zoning share.
- Catchment share close to major roads and rail lines.
- Nightlife POI count.

Quietness remains explicitly labeled as a proxy:

- 50% residential-zoning share.
- 30% inverse major-road/rail exposure.
- 20% inverse nightlife density.

Normalize these metrics against all Tokyo 23-ward station areas during `pnpm derive`.

## 3. Commute and Ranking Engine

### Weighted rail graph

Do not implement timetable routing or RAPTOR.

The transit import creates a compact directed graph:

- Nodes: station groups.
- Ride edges: adjacent stations.
- Transfer edges: interchange connections.
- Weights: typical travel time, expected wait, and transfer penalty.

Where GTFS/ODPT is available:

- Derive median weekday adjacent-stop travel times.
- Derive average peak and off-peak headways.
- Do not persist trips, calendars, or complete stop-time tables after derivation.

Where it is unavailable:

- Use MLIT topology and segment distance.
- Subway/local rail: 28 km/h.
- Surface commuter rail: 35 km/h.
- Monorail: 30 km/h.
- Add 45 seconds dwell per intermediate station.
- Expected wait: four minutes at 07:30-10:00 and six minutes otherwise.
- Apply a five-minute transfer penalty.
- Mark these edges low confidence.

At API startup, load the graph into memory. For every optimization request, run reverse Dijkstra once from the destination, yielding travel estimates from every candidate station. Add a fixed eight-minute neighborhood-to-station walk.

The arrival time only chooses peak or off-peak weights; the UI must say "typical weekday estimate," not scheduled arrival time.

### Hard filters

Exclude a candidate when:

- Median all-in rent exceeds the budget.
- Estimated area-to-destination commute exceeds the maximum.
- The station is disconnected from the selected destination.

If no candidates remain, return counts showing whether rent or commute removed most areas and suggest which constraint to relax. Do not silently rank failed candidates.

### Score

For feasible candidates:

```text
overall =
  30% affordability
+ 30% commute
+ 40% lifestyle preferences
```

Lifestyle importance values are:

- Low: 1
- Medium: 2
- High: 4
- Essential: 8

Normalize those values within the lifestyle portion. "Essential" is a strong ranking weight, not a hidden hard filter.

Each result returns:

- Raw metric.
- Component score.
- Effective weight.
- Point contribution.
- Source date.
- Confidence.
- Short positive or negative explanation.

Keep all formulas and thresholds in one plain TypeScript configuration module so the methodology page and scoring code use the same constants.

## 4. API and Frontend

### API

- `GET /v1/stations?query=`
  - English/Japanese station autocomplete.
- `POST /v1/optimize`
  - Run filtering, Dijkstra, and ranking.
- `GET /v1/neighborhoods/:stationGroupId`
  - Return map geometry and full factor evidence.
- `GET /v1/data-status`
  - Return import dates and current source vintages.
- `GET /health`
  - Database/application health.

Shared request contract:

```ts
type Importance = "low" | "medium" | "high" | "essential";

interface OptimizationRequest {
  destinationStationGroupId: string;
  arrivalTime: string;
  monthlyBudgetYen: number;
  layout: "1R" | "1K" | "1DK" | "1LDK" | "2K_2DK" | "2LDK" | "3LDK";
  maxCommuteMinutes: number;
  preferences: {
    floodSafety: Importance;
    supermarkets: Importance;
    restaurants: Importance;
    quietness: Importance;
  };
}
```

Keep Zod request validation and shared inferred TypeScript types. The frontend uses a small handwritten `fetch` wrapper; do not generate an API client.

### Frontend

Create a polished three-step experience:

1. Destination station, arrival time, and maximum commute.
2. Monthly all-in budget and layout.
3. Lifestyle importance.

Results use a responsive ranked-list/map layout:

- Overall score.
- Modeled rent range and confidence.
- Commute estimate with eight-minute access walk, rail time, and transfers.
- Flood, supermarket, restaurant, and quietness summaries.
- Top reasons for and against the area.
- Visible data dates and methodology links.
- URL-encoded inputs for shareable results.

Use Next.js, Tailwind, custom components, and MapLibre. No general-purpose component library. Provide keyboard-accessible forms, strong focus states, non-color map explanations, and a complete list-based alternative to interacting with the map.

## 5. Implementation and Verification

### Build sequence

1. Create PostGIS schema, Next.js shell, Fastify health endpoint, and shared request types.
2. Build a vertical slice with approximately 20 manually seeded stations across a few wards:
   - One destination.
   - Weighted graph.
   - Rent calculation.
   - One hazard and amenity query.
   - Ranked results in the UI.
3. Implement the four import scripts and replace the seeded data.
4. Build station catchments and the derived neighborhood metrics script.
5. Complete the Dijkstra commute estimator and confidence reporting.
6. Finalize scoring, explanations, empty-result behavior, and neighborhood details.
7. Add the map, responsive styling, accessibility, methodology, and source attribution.
8. Run the full 23-ward import, validate representative results manually, and deploy web/API/PostGIS to Render.
9. Add scheduled imports only after at least two successful manual refresh cycles.

### Focused tests

- Unit tests for rent formulas, component scores, hard filters, and weight normalization.
- Route tests for direct journeys, transfers, peak/off-peak differences, disconnected stations, and path reconstruction.
- PostGIS integration tests for 800 m catchments, `ST_DWithin` amenities, ward assignment, and flood intersections.
- Import fixture tests for one representative file from each source.
- API test for one successful optimization and major validation errors.
- Playwright happy-path test covering the wizard and ranked results.
- Browser verification at desktop and mobile widths after UI changes.
- Manual comparison of a representative sample of estimated commutes against public journey planners; visibly downgrade operators with poor estimates.
- Manual review that every rent statement says estimate/range and nothing suggests listing availability.

### Deferred until evidence justifies it

- Redis only if route or result computation becomes measurably slow.
- Background workers/queues only if imports cannot run reliably as scripts or cron jobs.
- Object storage/version rollback only when reproducible historical datasets become necessary.
- OpenTripPlanner or timetable routing only if users need exact departure-aware journeys.
- Accounts only after saved searches are demonstrably valuable.
- More advanced rent modeling only after acquiring station-level ground truth.
- Production-grade alerting, PITR requirements, and detailed performance objectives only after meaningful public usage.

## User directive (binding)

- Do not put much effort toward the frontend. The frontend will be built after the backend is finished and ready. Deliver a functional, minimal frontend only.

> Historical design document. Flood ingestion and scoring were removed by
> migration `0009_remove_flood.sql`; flood references below are not active requirements.
