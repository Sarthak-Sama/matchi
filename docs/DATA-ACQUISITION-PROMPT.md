# Prompt for Codex — obtain the real data sources

Copy everything below the line into Codex.

---

I need help obtaining real data sources and API credentials for a Tokyo
neighbourhood-recommendation app. The code is complete and tested; it is
running on fixture data, and I need to feed it the real thing.

**Repo:** `/Users/yato_sar/projects/tokyo-area-finder` (pnpm monorepo,
TypeScript, PostgreSQL + PostGIS)

## Current state — what already works

`pnpm import:osm --download` works today with no credentials. It queries
the public Overpass API for the 23 special wards and loads 57,995 POIs,
9,867 green spaces and 8,890 roads. Lifestyle metrics are real.

Everything else is still seed fixtures. Specifically `station_groups`
holds **21 fake stations**, all clustered on Tokyo's west side. The
practical symptom: entering the University of Tokyo's Hongo campus as a
destination returns `NO_ACCESS_STATIONS`, because the nearest station in
the database is Shinjuku, 6.2 km away. Real Tokyo has Hongo-sanchome
~400 m away, Todaimae ~500 m, Nezu ~700 m.

**So the highest-priority item by far is MLIT's N02 railway dataset**
(stations + rail line geometry). Everything else is secondary.

## What I need from you

For each source below: tell me exactly how to obtain it, whether it needs
an account or API key, how to register if so, the current download URL,
and what format it arrives in. Where registration is required, walk me
through it step by step — note that several of these are Japanese
government portals whose signup flows are Japanese-only.

**Important:** do not modify any parser in the repo. If a real export's
field names differ from what the code expects, report the mismatch and
let me decide. The repo's field-name expectations are explicitly
documented as *assumptions* that were never verified against real
downloads.

### 1. MLIT — 国土数値情報 (National Land Numerical Information) — TOP PRIORITY

Six datasets. The repo expects GeoJSON; MLIT typically ships shapefiles,
which need `ogr2ogr -f GeoJSON out.geojson in.shp`.

| Dataset | MLIT code | Fields the code reads | Feeds |
|---|---|---|---|
| Railway stations | **N02** | `N02_005` | `station_groups` |
| Railway lines | **N02** | `N02_003`, `N02_004` | `rail_lines` |
| Administrative boundaries | **N03** | `N03_004`, `N03_007` | `wards` |
| Land prices | **L01** | `L01_005`, `L01_006`, `L01_022` | `land_prices` |
| Urban planning / zoning | **A29** | `A29_001` | `zoning_areas` |
| Flood hazard | **A31** | `A31_101` | `flood_zones` |

Questions I need answered:
- Is there a real MLIT download **API**, and does it need an API key? The
  repo has an `MLIT_API_KEY` env var, but its auto-download path is
  documented as always failing because no verified endpoint could be
  confirmed. Tell me whether such an endpoint actually exists today, or
  whether manual download is genuinely the only route.
- Direct download URLs for each dataset above, filtered to **Tokyo
  (東京都, prefecture code 13)** where the portal allows it.
- Confirm whether `N02_005` etc. are the correct current field names, or
  whether MLIT has revised the schema. Report what the real files contain.
- The licence and required attribution text.

Command the repo expects once files are in place:

```
pnpm import:mlit \
  --wards data/wards.geojson \
  --stations data/stations.geojson \
  --rail-lines data/rail-lines.geojson \
  --land-prices data/land-prices.geojson \
  --zoning data/zoning.geojson \
  --flood data/flood.geojson
```

### 2. e-Stat — 2023 Housing and Land Survey (住宅・土地統計調査)

Feeds ward-level rent statistics. The repo has an `ESTAT_APP_ID` env var,
and again its auto-download always fails: no verified table id could be
confirmed. CSVs are **Shift-JIS** encoded (the code already handles this).

- How do I register for an e-Stat application ID (`appId`)? Direct link
  and steps.
- **Which specific table id** holds 2023 ward-level average rent for
  Tokyo's 23 wards? This is the piece the repo could not confirm — I need
  the actual `statsDataId`.
- Does the API return rent per month in yen, and per unit or per m²? The
  importer has a `--rent-unit sqm` flag, so I need to know which applies.

Command: `pnpm import:rent --file data/estat-rent-2023.csv [--rent-unit sqm]`

### 3. ODPT — Public Transportation Open Data Centre — OPTIONAL

There is an `ODPT_ACCESS_TOKEN` env var for GTFS feeds, **but I likely do
not need it**: the repo has a `--from-topology` mode that derives the
entire rail graph from MLIT rail-line geometry plus station points, with
no GTFS at all.

So: only tell me what ODPT registration involves and whether Tokyo Metro /
JR East / Toei GTFS feeds are available through it, and how fresh they
are. Treat this as "nice to have" — I want real travel times eventually,
but MLIT topology unblocks me now.

### 4. REINS — skip

The repo notes REINS has no public API; a member exports their own
quarterly report. Confirm that's still true, then move on.

## Constraints

- I am not asking you to write or change application code. This is a data
  acquisition and verification task.
- If a portal requires a Japanese address, phone number, or corporate
  affiliation to register, say so plainly rather than routing around it.
- Prefer official primary sources over mirrors or scraped copies.
- Note each source's licence and attribution requirement — the app
  already attributes OpenStreetMap and will need to do the same for these.

## Deliverable

A step-by-step acquisition plan, ordered with **MLIT N02 first**, with:
1. exact URLs and any registration steps,
2. which credentials are genuinely required vs. avoidable by manual
   download,
3. any field-name mismatches between the real exports and the table above,
4. the `ogr2ogr` commands needed to convert what actually downloads.

Once I have N02 stations and rail lines loaded, I can run
`pnpm import:transit --from-topology` and get real commute times without
any GTFS feed — that is the milestone I am aiming for.
