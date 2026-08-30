# Data sources — what to verify before your first live import

Every import script was built to the **documented** format of its source and
verified against committed fixtures. None has been run against a real
download, because this machine has no MLIT / e-Stat / ODPT credentials and no
network access at build time.

The scripts are therefore correct with respect to a stated set of assumptions.
Those assumptions are written down — specifically and falsifiably — in each
script's module doc comment. **Spot-check one real file per dataset against
them before trusting any output.**

| Script | Source | Assumptions documented in |
|---|---|---|
| `pnpm import:mlit` | MLIT (wards, stations, rail, land prices, zoning) | `scripts/src/import-mlit.ts` and `scripts/src/import-mlit/*.ts` |
| `pnpm import:rent` | e-Stat 2023 Housing & Land Survey; optional REINS | `scripts/src/import-rent/estat.ts`, `scripts/src/import-rent/reins.ts` |
| `pnpm import:osm` | OpenStreetMap via Overpass | `scripts/src/import-osm/parse.ts` |
| `pnpm import:transit` | GTFS / ODPT, or MLIT topology fallback | `scripts/src/import-transit.ts` |
| `pnpm import:localities` | [e-Stat 2020 町丁・字等 boundaries](https://www.e-stat.go.jp/gis/statmap-search?aggregateUnitForBoundary=A&datum=2000&page=1&serveyId=A002005212020&toukeiCode=00200521&toukeiYear=2020&type=2) | `scripts/src/import-localities.ts` |

## The three assumptions most worth checking first

These were flagged in review as the ones that would do the most damage if wrong.

1. **e-Stat rent units.** The importer assumes the rent column is already
   yen per m². Real e-Stat publication tables often report *total* rent and
   floor area in separate columns instead. A total-rent figure fails loudly
   (it breaks the ¥20,000/m² ceiling), but a **per-tsubo** figure does not —
   1 tsubo ≈ 3.3058 m², so per-tsubo values land inside the accepted range
   and would inflate every ward's rent by ~3.3× silently. Declare the unit
   explicitly with `--rent-unit=sqm|tsubo`; the unit in effect is printed in
   the run summary.

2. **MLIT land-price `use_category`.** The derive step takes the median of
   *residential* land prices only. If the real L01 export uses a different
   field code, or a category spelling the classifier doesn't recognise, every
   station falls back to a multiplier of 1.0 — every station in a ward then
   gets identical rent and the affordability ranking loses its within-ward
   discrimination. `import:mlit` now prints how many rows classified as
   residential and warns loudly when that count is zero; `derive` warns when
   more than half of stations hit the fallback.

3. **REINS format.** Built with no real sample at all, and assumed UTF-8
   rather than Shift-JIS. A Shift-JIS file fails loudly (its own headers
   corrupt and validation aborts before any row is written), so this is safe
   to discover by running it — but expect to adjust.

## Order of operations

```bash
pnpm db:migrate
pnpm import:mlit    # wards and stations first — other imports reference them
pnpm import:localities data/localities.geojson
pnpm import:rent
pnpm import:osm
pnpm import:transit --gtfs <dir>   # or --from-topology
pnpm derive                        # rebuild catchments, metrics, rent estimates
```

`import:rent` before `derive`: a station whose ward has no `rent_stats` row is
skipped by the rent step and reported in the summary. That is handled
gracefully — derive completes and the station is simply excluded from
`/v1/optimize` results — but you want rent coverage for every ward you care
about.

`import:transit` writes the in-memory rail graph's source data. The API builds
that graph **once at startup**, so restart the API after a transit import.

**Applying a migration to an already-populated database.** A migration that
adds new `norm_*` lifestyle columns (e.g. `0004_lifestyle_metrics.sql`) does
not populate them — those columns are NULL for every existing row until
`pnpm derive` runs. The API fails closed on any NULL `norm_*` column: a
station with even one missing normalized metric is treated as having no
lifestyle metrics at all and is excluded from `/v1/optimize` and
`/v1/neighborhoods/:id`. So on a real deploy, `pnpm db:migrate` and a full
`pnpm derive` must both complete **before** the API version that depends on
the new columns is deployed — otherwise every candidate is dropped and
`/v1/optimize` quietly returns an empty result.

## Attribution

OpenStreetMap data is © OpenStreetMap contributors and the attribution is
rendered in the UI. MLIT, e-Stat, and ODPT each carry their own terms — check
them before publishing anything derived from their data.
