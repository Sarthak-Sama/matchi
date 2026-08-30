# Deferred metrics and why they were skipped

The scoring algorithm evaluates neighbourhoods on three foundations: commute speed,
rent, and lifestyle quality. Several metrics were considered for inclusion but
deliberately deferred to future work. Each entry below records what was proposed,
why it was set aside, and what it would take to build it — so the next person
doesn't have to rediscover the decision.

## The critical distinction: computable from existing data vs. new import

Three of the nine deferred metrics are **computable today** from data already in the
database. These are high-value, low-cost wins — they need algorithm work or schema
changes, not new data sources:

- **Line diversity and direct-ride reach** — computable from existing rail graph
- **Two-sided preference weights** — data available in OSM tags already captured
- **Catchment overlap deduplication** — station distance already known

The remaining six require **new data sources or new data acquisition** and will
demand dedicated import or curation efforts:

- **Hilliness** — MLIT DEM
- **Train congestion** — MLIT 混雑率
- **Land-price trend** — multiple years of MLIT L01
- **Earthquake and liquefaction hazard** — J-SHIS
- **Last train time** — GTFS/ODPT schedules
- **Pedestrian routing isochrones** — OSM pedestrian network

## Hilliness

**Proposed:** Detect steep slopes in Tokyo's terrain using a digital elevation model
(DEM).

**Why deferred:** Requires a new MLIT data source (the 50 m gridded DEM) and a new
import pipeline: download, parse into a structured format, table schema, and a
derive step that samples elevation at each station location and computes slope
metrics. The existing `scripts/src/import-mlit/geojson.ts` importer handles only
Point, Polygon, and LineString types; a raster DEM cannot be imported this way,
and the database lacks `postgis_raster` support, so the DEM must arrive as either
point or polygon features.

**Rough cost:** New MLIT import source (parse the DEM format, restructure as
Point features); new database schema; integration into the derive pipeline.

## Train congestion

**Proposed:** Rank stations by how crowded their peak-hour trains are, via MLIT's
混雑率 (crowding rate) dataset.

**Why deferred:** This is arguably the single biggest complaint from Tokyo commuters
— a commute score that ignores peak-hour crowding is missing what people actually
hate most. However, the dataset is large (minute-by-minute crowding records for
every line) and its structure in MLIT's raw output is undocumented. The decision
to defer was not "this is not important" but rather "this is complex enough to
warrant a separate focused effort once the core algorithm is stable."

**Rough cost:** Reverse-engineer MLIT 混雑率 format; build an import pipeline to
aggregate into station-level congestion scores; integrate into derive.

## Land-price trend

**Proposed:** Track residential land-price direction over multiple years using the
MLIT L01 dataset (published annually).

**Why deferred:** The system already imports MLIT L01 via
`scripts/src/import-mlit/land-prices.ts`, so this needs additional _years_ of that
same dataset rather than a new source type. However, the repo currently holds only
the most recent snapshot (one level per station). Trajectory — price up or down over
3–5 years — requires downloading and curating multiple years of data, then computing
a trend. This is valuable signal (rising prices can signal gentrification or
development; falling prices signal possible neighbourhood decline), but the
implementation would double the storage footprint of land-price data without the
algorithm being ready to weight temporal signals yet.

**Rough cost:** Curate and download multiple years of MLIT L01 data; expand schema
to store yearly values; implement trend calculation in derive; add a weighting
control to the API.

## Earthquake and liquefaction hazard

**Proposed:** Surface seismic risk — earthquake shaking intensity and liquefaction
potential — via the J-SHIS (Japan Seismic Hazard Information Station) database.

**Why deferred:** J-SHIS data is large, detailed (mesh blocks), and requires
careful interpretation. Hazard scoring is currently outside the product scope.

**Rough cost:** Access and license J-SHIS data; build import pipeline for hazard
mesh; resample to station catchment areas; integrate into derive; validation
against published hazard maps.

## Last train time

**Proposed:** For each station, record the departure time of the last train home
— a hard constraint on commute feasibility that affects real Tokyo commuters.

**Why deferred:** Requires the full GTFS or ODPT transit import to be complete and
stable. The system currently falls back to MLIT rail-network topology if GTFS is
unavailable. Last train time is meaningless without dense, real schedule data, so
this is explicitly gated on ODPT integration maturity.

**Rough cost:** Depends on GTFS/ODPT being wired in production. Once available,
parse and aggregate departure times; add to station schema; expose in API.

## Line diversity and direct-ride reach

**Proposed:** For each station, count how many distinct lines serve it and how far
you can travel on a single train without changing (e.g., 20 km on the Yamanote,
10 km to a major transfer hub).

**Why deferred:** This is computable today from the existing rail graph stored in
the database. No new data source is required. It was deferred because the current
iteration prioritises simple commute metrics (time to destination), and the
algorithm is not yet ready to weight multi-line reach against single-line speed.
This is a high-value, low-cost win for a future sprint.

**Rough cost:** Implement graph traversal on the existing rail network; compute
line-count and direct-reach metrics during derive; add to station schema.

## Two-sided preference weights

**Proposed:** Instead of a single "quietness" axis (currently one of nine), offer
a spectrum: quiet ↔ lively. Users who want lively, walkable neighbourhoods could
select the opposite end.

**Why deferred:** The current system computes quietness as an absence (low
traffic, low ambient noise) but does not capture what makes a place _lively_
(density of bars, restaurants, cultural venues — proxy signals from OSM). The
OSM importer already captures the tags needed for lively-ness signals. However,
implementing a true two-ended axis requires rethinking the normalisation — both
endpoints (quiet and lively) should map to score 100, and the midpoint to score
0 — which conflicts with the current min-max framework. **No new data source is
required — this is a UI and algorithm refactor.**

**Rough cost:** Redesign normalisation for two-sided axes; add new OSM tag queries
for "lively" signals; refactor scoring to handle opposing preferences; test the
new preference UI.

## Catchment overlap deduplication

**Proposed:** When two stations are within 900 m of each other (so their 800 m
catchment circles overlap significantly), merge or suppress the near-duplicate
recommendations they generate, since they describe essentially the same streets.

**Why deferred:** The current `/v1/optimize` returns ranked stations, each with
walk time and catchment amenities. When stations are close, the top results are
near-duplicates — which is honest (the user _can_ reach both) but unhelpful (both
describe the same few blocks). A dedup pass would suppress the second-ranked
station if the first ranked is within 900 m, or allow the user to filter "show me
distinct neighbourhoods only" as a preference. **No new data source is required —
station positions are already known; this is a UX and ranking-engine improvement.**

**Rough cost:** Add dedup logic to the ranking engine; add a preference flag; test
with the seeded database to ensure results remain meaningful.

## Pedestrian routing isochrones

**Proposed:** Replace the 800 m radius circle with actual walking time isochrones
using a pedestrian routing engine, to account for barriers (rivers, highways) and
street network detours.

**Why deferred:** The current system uses a fixed 800 m straight-line radius as a
proxy for walkable distance, which is simple and fast. True isochrones require
a pedestrian road network (computable from OSM, but not currently imported) and a
routing algorithm. The gain — more accurate walk accessibility — is real, but the
cost in import complexity, storage, and query time is substantial. This is best
tackled as a dedicated infrastructure upgrade.

**Rough cost:** Import OSM pedestrian ways and barriers; build or integrate a
routing engine; compute isochrones for every station at derive time (expensive);
restructure catchment query from radius-based to isochrone-based.
