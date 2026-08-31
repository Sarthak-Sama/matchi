# Local real-data setup

Downloaded on 2026-08-25. All source data lives under `data/`, which is intentionally ignored by Git.

## Downloaded MLIT source archives

| Dataset                                    | Local archive                           | Status                                                          |
| ------------------------------------------ | --------------------------------------- | --------------------------------------------------------------- |
| N02 railway, 2025                          | `data/raw/mlit/N02-25_GML.zip`          | Downloaded and inspected                                        |
| N03 administrative boundaries, Tokyo, 2024 | `data/raw/mlit/N03-20240101_13_GML.zip` | Downloaded and converted                                        |
| L01 posted land prices, Tokyo, 2026        | `data/raw/mlit/L01-26_13_GML.zip`       | Downloaded and inspected                                        |
| A29 zoning, Tokyo, 2019                    | `data/raw/mlit/A29-19_13_GML.zip`       | Downloaded; legacy ZIP filenames prevent normal macOS expansion |

SHA-256 values:

```text
57fc822d580cf744e5596b7006363aa2a5685ceec0720b0053430760e12fc3c2  A29-19_13_GML.zip
4f3e251683a6affe7181236b60fda2a7eee1d5e83daffc9db82435a1542a7795  L01-26_13_GML.zip
aaf76af133b2e771e538fabc4646d2e443dc1d5a67b221382a28d744e706cc9f  N02-25_GML.zip
2c2cfd4413658c2e7cb919bb80638cc235a4e29555e72a282211613e7dc046ff  N03-20240101_13_GML.zip
```

## Files staged for the application

`data/wards.geojson` is import-ready: it contains exactly one dissolved geometry per Tokyo special ward (`13101` through `13123`), reprojected to EPSG:4326. The source N03 download contains 118 component polygons for those 23 wards, so using the raw N03 export directly would cause repeated upserts per ward.

`data/staged/mlit/n02-25-stations-centroids.geojson` is a candidate station input. The 10,234 raw N02 station features are `LineString` geometries; this staged file contains their centroids as Points while retaining all N02 properties. It has not been named `data/stations.geojson` because that geometry transformation needs an explicit acceptance decision.

`data/staged/mlit/n02-25-rail-sections.geojson` is the raw N02 rail-section data in EPSG:4326. It deliberately has no added `mode` field.

`data/staged/mlit/l01-26-tokyo.geojson` is a GeoJSON conversion of the Tokyo L01 source, retained for schema inspection only.

## Verified incompatibilities with the current importers

No application parser was modified.

| Import input    | Current real source                                        | Repository expects                | Consequence                                         |
| --------------- | ---------------------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| N02 stations    | `LineString`; name `N02_005`, IDs `N02_005c`/`N02_005g`    | Point                             | Raw file is rejected; centroid staging is available |
| N02 rail lines  | `N02_003`, `N02_004`, no `mode`                            | `mode` is required                | A classification policy is needed before import     |
| N03 wards       | multiple polygons per ward                                 | effectively one geometry per ward | `data/wards.geojson` is already dissolved           |
| L01 land prices | year `L01_007`, price `L01_008`, use `L01_028`             | `L01_005`, `L01_006`, `L01_022`   | Current importer would read incorrect values        |
| A29 zoning      | classification `A29_004`; `A29_001` is administrative code | `A29_001` as category             | Current importer would misclassify zoning           |

## What remains for a successful live import

1. Decide and implement the N02 station-centroid policy and N02 line-mode mapping.
2. Correct or preprocess the L01 and A29 field mappings.
3. Register for e-Stat, fetch `statsDataId=0004021492`, and provide `ESTAT_APP_ID` only if API retrieval is wanted.
4. Optionally register for ODPT later for timetable/real-time transit data. It is not needed for topology mode.

Once items 1-3 are resolved, run:

```bash
pnpm import:mlit \\
  --wards data/wards.geojson \\
  --stations data/stations.geojson \\
  --rail-lines data/rail-lines.geojson \\
  --land-prices data/land-prices.geojson \\
  --zoning data/zoning.geojson

pnpm import:transit --from-topology
```
