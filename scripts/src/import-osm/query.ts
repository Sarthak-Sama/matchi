/**
 * Builds the Overpass QL query `import:osm --download` sends, bounded to
 * `TOKYO_23_WARDS_BBOX` (`@tokyo/shared`). Kept as a pure string-builder,
 * separate from the actual HTTP call (`download.ts`), so the query text
 * itself is testable without touching the network.
 *
 * Two `out` statements are used because POIs and roads/green-spaces need
 * different output modes: `out center;` gives every node its own
 * coordinates and every way/relation a `center` (cheap — no full geometry
 * needed for a point-of-interest), while roads and green spaces need full
 * `out geom;` linework/ring geometry so `major_roads.geom`/
 * `green_spaces.geom` are real, not a centroid. Green spaces share the
 * roads' `out geom;` block (rather than getting a third statement) because
 * both need the same output mode; `parse.ts` tells them apart afterward by
 * tag (`highway=*` vs `leisure=park|garden`), not by which block produced
 * them. Splitting the query into two top-level statement blocks (one set of
 * `(node/way/relation[...];)` per `out`) is standard Overpass QL and
 * produces one merged `elements` array in the JSON response — `parse.ts`
 * doesn't need to know which `out` statement produced which element.
 */

import type { TOKYO_23_WARDS_BBOX } from "@tokyo/shared";

import {
  BAR_AMENITY_VALUES,
  GREEN_SPACE_LEISURE_VALUES,
  GROCERY_SHOP_VALUES,
  HEALTH_AMENITY_VALUES,
  LANDMARK_AMENITY_VALUES,
  ROAD_HIGHWAY_VALUES,
} from "./parse.js";

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
    `["amenity"~"${altRegex(HEALTH_AMENITY_VALUES)}"]`,
    `["amenity"~"${altRegex(LANDMARK_AMENITY_VALUES)}"]`,
    // Any named office=* — "named" is expressed as a second chained tag
    // filter (Overpass QL ANDs chained `[...]` filters), not a value regex.
    `["office"]["name"]`,
  ];

  const poiClauses = poiFilters
    .flatMap((filter) => [
      `node${filter}(${bb});`,
      `way${filter}(${bb});`,
      `relation${filter}(${bb});`,
    ])
    .map((line) => `  ${line}`)
    .join("\n");

  const roadFilter = `["highway"~"${altRegex(ROAD_HIGHWAY_VALUES)}"]`;
  const greenSpaceFilter = `["leisure"~"${altRegex(GREEN_SPACE_LEISURE_VALUES)}"]`;

  return [
    "[out:json][timeout:180];",
    "(",
    poiClauses,
    ");",
    "out center;",
    "(",
    `  way${roadFilter}(${bb});`,
    `  way${greenSpaceFilter}(${bb});`,
    `  relation${greenSpaceFilter}(${bb});`,
    ");",
    "out geom;",
  ].join("\n");
}
