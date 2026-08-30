# Real-data pipeline

The system of record is one PostGIS database. Source archives and generated
GeoJSON stay in the ignored `data/` directory; neither belongs in Postgres or
Git.

## Before the first live run

Fill the six SHA-256 values in [data/catalog.json](../data/catalog.json) from
the approved downloaded archives. The catalog refuses placeholders and refuses
to download an archive whose checksum differs. This is intentional: the MLIT
download site does not publish a machine-readable checksum for every archive,
so inventing one would make a reproducible pipeline less safe, not more so.

Set `DATABASE_URL` and `ESTAT_APP_ID`. `MLIT_API_KEY` is not used.

## Commands

```sh
pnpm data:prepare
pnpm data:refresh --source all
pnpm data:validate
pnpm data:reset-real --confirm-real-reset
```

`data:refresh` is manual. It imports catalog-prepared MLIT data, uses the
e-Stat v3 API unless `import:rent --file` is explicitly supplied, rebuilds
topology after N02, derives all metrics, validates the result, and prints the
required API restart. Use `--source mlit`, `rent`, or `osm` for a targeted
refresh. OSM is normally rerun every one to three months.

`data:reset-real` is deliberately guarded and never seeds fixtures. `db:seed`
also refuses production-named URLs and needs `--confirm-dev-seed` outside a
test/local database.

The active layers are N03 2026, N02 2025, L01 2026, A55 2024, A31a 2025 and
e-Stat 2023. Legacy A29/A31 archives are rollback-only and are not imported;
they can be removed later to recover roughly 469 MB of local/archive storage.
