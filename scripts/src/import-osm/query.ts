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
