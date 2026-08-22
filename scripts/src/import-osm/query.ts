/**
 * Builds the Overpass QL query `import:osm --download` sends, bounded to
 * `TOKYO_23_WARDS_BBOX` (`@tokyo/shared`). Kept as a pure string-builder,
 * separate from the actual HTTP call (`download.ts`), so the query text
 * itself is testable without touching the network.
 *
 * Two `out` statements are used because POIs and roads need different
 * output modes: `out center;` gives every node its own coordinates and
 * every way/relation a `center` (cheap — no full geometry needed for a
 * point-of-interest), while roads need full `out geom;` linework so
 * `major_roads.geom` is real, not a centroid. Splitting the query into two
 * top-level statement blocks (one set of `(node/way/relation[...];)` per
 * `out`) is standard Overpass QL and produces one merged `elements` array
 * in the JSON response — `parse.ts` doesn't need to know which `out`
 * statement produced which element.
 */

import type { TOKYO_23_WARDS_BBOX } from "@tokyo/shared";

import { BAR_AMENITY_VALUES, GROCERY_SHOP_VALUES, ROAD_HIGHWAY_VALUES } from "./parse.js";

type Bbox = typeof TOKYO_23_WARDS_BBOX;

function bboxArg(bbox: Bbox): string {
  return `${String(bbox.south)},${String(bbox.west)},${String(bbox.north)},${String(bbox.east)}`;
}

function altRegex(values: readonly string[]): string {
  return `^(${values.join("|")})$`;
}

/** Builds the full Overpass QL query text for `import:osm --download`. */
export function buildOverpassQuery(bbox: Bbox): string {
  const bb = bboxArg(bbox);
  const poiFilters = [
    `["shop"="supermarket"]`,
    `["shop"~"${altRegex(GROCERY_SHOP_VALUES)}"]`,
    `["shop"="convenience"]`,
    `["amenity"="restaurant"]`,
    `["amenity"="cafe"]`,
    `["amenity"~"${altRegex(BAR_AMENITY_VALUES)}"]`,
  ];

  const poiClauses = poiFilters
    .flatMap((filter) => [`node${filter}(${bb});`, `way${filter}(${bb});`, `relation${filter}(${bb});`])
    .map((line) => `  ${line}`)
    .join("\n");

  const roadFilter = `["highway"~"${altRegex(ROAD_HIGHWAY_VALUES)}"]`;

  return [
    "[out:json][timeout:180];",
    "(",
    poiClauses,
    ");",
    "out center;",
    "(",
    `  way${roadFilter}(${bb});`,
    ");",
    "out geom;",
  ].join("\n");
}
