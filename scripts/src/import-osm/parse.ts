/**
 * Pure Overpass-API-JSON parsing for `import:osm` — no DB, no network.
 * Every property this module reads (`elements[].type/id/lat/lon/center/
 * geometry/tags`, `osm3s.timestamp_osm_base`) is an ASSUMPTION about
 * Overpass's real response shape, documented per-field below and
 * summarized in task-13-report.md's "Overpass format assumptions" section.
 *
 * Tag → category mapping (exactly as specified by task-13-brief.md):
 *   shop=supermarket                       -> pois.category = "supermarket"
 *   shop=greengrocer|butcher|bakery|grocery -> pois.category = "grocery"
 *   shop=convenience                       -> pois.category = "convenience"
 *   amenity=restaurant                     -> pois.category = "restaurant"
 *   amenity=cafe                           -> pois.category = "cafe"
 *   amenity=bar|pub|nightclub              -> pois.category = "bar"
 *   highway=motorway|trunk|primary         -> major_roads.road_class
 *
 * Tag-precedence rule (not specified by the brief — an element carrying
 * more than one mapped tag is possible in adversarial/hand-edited input,
 * even though a real Overpass extract built from this module's own query
 * should never produce one): `highway` is checked first, so a road-tagged
 * element is always written to `major_roads` regardless of any `shop`/
 * `amenity` tag also present. Failing that, `shop` is checked before
 * `amenity` — so an element with both a mapped `shop=*` and a mapped
 * `amenity=*` tag (e.g. `shop=supermarket` + `amenity=cafe`) becomes a
 * `supermarket` POI, not a `cafe` one. This mirrors the brief's own
 * listing order (shop rules are listed before amenity rules) and is the
 * more specific classifier of the two for retail-shaped data. Any element
 * that hits this ambiguous case prints a loud warning naming both tags and
 * the tag that won, rather than resolving silently — see `classifyElement`.
 *
 * Skip vs. error, kept deliberately sharp per the brief:
 *   - An element whose tags match none of the rules above is SKIPPED
 *     (`classification.kind === "unmapped"`) — never an error, and its
 *     coordinates/geometry are never even inspected.
 *   - An element that DOES match a rule but lacks the coordinates its
 *     kind needs (a node with no lat/lon, a way/relation POI with no
 *     `center`, or a highway way with no `geometry` array) is a hard
 *     error that aborts the whole import — see `resolvePoiCoordinates`
 *     and `resolveRoadGeometry`.
 */

export type PoiCategory = "supermarket" | "grocery" | "convenience" | "restaurant" | "cafe" | "bar";
export type RoadClass = "motorway" | "trunk" | "primary";
export type OsmElementType = "node" | "way" | "relation";

// These tag-value lists are the single source of truth for the brief's
// mapping — `import-osm/query.ts`'s Overpass query builder imports them
// too, rather than re-listing the same values, so the query filters and
// this classifier can never drift apart.
export const GROCERY_SHOP_VALUES = ["greengrocer", "butcher", "bakery", "grocery"] as const;
export const BAR_AMENITY_VALUES = ["bar", "pub", "nightclub"] as const;
export const ROAD_HIGHWAY_VALUES: readonly RoadClass[] = ["motorway", "trunk", "primary"] as const;

const SHOP_CATEGORY_MAP: Readonly<Record<string, PoiCategory>> = {
  supermarket: "supermarket",
  convenience: "convenience",
  ...Object.fromEntries(GROCERY_SHOP_VALUES.map((v) => [v, "grocery" as const])),
};

const AMENITY_CATEGORY_MAP: Readonly<Record<string, PoiCategory>> = {
  restaurant: "restaurant",
  cafe: "cafe",
  ...Object.fromEntries(BAR_AMENITY_VALUES.map((v) => [v, "bar" as const])),
};

function isRoadClass(value: string): value is RoadClass {
  return (ROAD_HIGHWAY_VALUES as readonly string[]).includes(value);
}

export type ElementClassification =
  | { readonly kind: "poi"; readonly category: PoiCategory }
  | { readonly kind: "road"; readonly roadClass: RoadClass }
  | { readonly kind: "unmapped" };

/** See this module's doc comment for the precedence rule this implements. */
export function classifyElement(
  tags: Readonly<Record<string, unknown>> | undefined | null,
  context: string,
): ElementClassification {
  if (!tags) return { kind: "unmapped" };

  const highway = typeof tags["highway"] === "string" ? tags["highway"] : undefined;
  if (highway !== undefined && isRoadClass(highway)) {
    return { kind: "road", roadClass: highway };
  }

  const shop = typeof tags["shop"] === "string" ? tags["shop"] : undefined;
  const shopCategory = shop !== undefined ? SHOP_CATEGORY_MAP[shop] : undefined;

  const amenity = typeof tags["amenity"] === "string" ? tags["amenity"] : undefined;
  const amenityCategory = amenity !== undefined ? AMENITY_CATEGORY_MAP[amenity] : undefined;

  if (shopCategory !== undefined && amenityCategory !== undefined && shopCategory !== amenityCategory) {
    console.warn(
      `import:osm — ${context}: has both shop=${shop} (-> ${shopCategory}) and amenity=${amenity} ` +
        `(-> ${amenityCategory}); shop takes precedence, category="${shopCategory}" (see ` +
        `import-osm/parse.ts's tag-precedence rule).`,
    );
  }

  if (shopCategory !== undefined) return { kind: "poi", category: shopCategory };
  if (amenityCategory !== undefined) return { kind: "poi", category: amenityCategory };
  return { kind: "unmapped" };
}

/** Raw Overpass element shape, as returned by `out center;` / `out geom;`. */
export interface OverpassElement {
  readonly type: OsmElementType;
  readonly id: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly center?: { readonly lat: number; readonly lon: number };
  readonly geometry?: readonly { readonly lat: number; readonly lon: number }[];
  readonly tags?: Readonly<Record<string, unknown>>;
}

export interface OverpassResponse {
  readonly osm3s?: { readonly timestamp_osm_base?: string };
  readonly elements: readonly OverpassElement[];
}

export interface ParsedPoi {
  readonly category: PoiCategory;
  readonly name: string | null;
  readonly osmType: OsmElementType;
  readonly osmId: number;
  readonly lon: number;
  readonly lat: number;
}

export interface ParsedRoad {
  readonly roadClass: RoadClass;
  readonly name: string | null;
  /** `MULTILINESTRING(...)` WKT, real linework (never a centroid). */
  readonly geomWKT: string;
}

export interface ParsedOverpassData {
  readonly pois: readonly ParsedPoi[];
  readonly roads: readonly ParsedRoad[];
  /** Count of elements skipped for carrying no mapped tag. */
  readonly skippedElements: number;
  readonly sourceUpdatedAt: Date | null;
}

function elementName(tags: Readonly<Record<string, unknown>> | undefined | null): string | null {
  const name = tags?.["name"];
  return typeof name === "string" && name.length > 0 ? name : null;
}

function elementContext(el: OverpassElement): string {
  return `osm ${el.type} ${String(el.id)}`;
}

/** Nodes use their own lat/lon; ways and relations use their `center`. */
function resolvePoiCoordinates(el: OverpassElement): { readonly lon: number; readonly lat: number } {
  const context = elementContext(el);

  if (el.type === "node") {
    if (typeof el.lat !== "number" || typeof el.lon !== "number") {
      throw new Error(`${context}: node is missing lat/lon coordinates`);
    }
    return { lon: el.lon, lat: el.lat };
  }

  if (el.center === undefined) {
    throw new Error(
      `${context}: ${el.type} has no "center" — expected Overpass's "out center;" to have supplied ` +
        `one for every non-node element`,
    );
  }
  if (typeof el.center.lat !== "number" || typeof el.center.lon !== "number") {
    throw new Error(`${context}: "center" is missing numeric lat/lon`);
  }
  return { lon: el.center.lon, lat: el.center.lat };
}

/**
 * Roads must keep real linework (a centroid would make `derive`'s
 * road-exposure metric meaningless), so only a `way` carrying Overpass's
 * `out geom;` `geometry` array (a list of `{lat, lon}` vertices) is
 * supported. A `highway=motorway|trunk|primary` tag on a node or relation
 * is not something our own Overpass query can produce (`highway` is a way
 * tag in real OSM data) and is treated as a hard error rather than
 * silently coerced to a point or skipped.
 */
function resolveRoadGeometry(el: OverpassElement): string {
  const context = elementContext(el);

  if (el.type !== "way") {
    throw new Error(
      `${context}: highway tag found on a "${el.type}", but only "way" elements are supported for ` +
        `major_roads (a road needs real linework, not a single centroid)`,
    );
  }
  if (el.geometry === undefined || el.geometry.length < 2) {
    throw new Error(
      `${context}: highway way is missing its "geometry" array (expected Overpass's "out geom;" to ` +
        `have supplied at least 2 vertices)`,
    );
  }
  for (const vertex of el.geometry) {
    if (typeof vertex.lat !== "number" || typeof vertex.lon !== "number") {
      throw new Error(`${context}: "geometry" contains a vertex missing numeric lat/lon`);
    }
  }
  const line = el.geometry.map((v) => `${v.lon} ${v.lat}`).join(", ");
  return `MULTILINESTRING((${line}))`;
}

function parseTimestamp(raw: string | undefined): Date | null {
  if (raw === undefined) {
    console.warn(
      `import:osm — response has no osm3s.timestamp_osm_base; source_updated_at will be recorded as null.`,
    );
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    console.warn(
      `import:osm — osm3s.timestamp_osm_base "${raw}" is not a parseable date; source_updated_at will ` +
        `be recorded as null.`,
    );
    return null;
  }
  return parsed;
}

/** Parses raw Overpass JSON text into typed, validated pois/roads. */
export function parseOverpassResponse(raw: string): ParsedOverpassData {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Overpass response: not valid JSON (${message})`, { cause: err });
  }

  if (
    typeof json !== "object" ||
    json === null ||
    !Array.isArray((json as Record<string, unknown>)["elements"])
  ) {
    throw new Error(`Overpass response: expected an object with an "elements" array`);
  }

  const response = json as OverpassResponse;
  const sourceUpdatedAt = parseTimestamp(response.osm3s?.timestamp_osm_base);

  const pois: ParsedPoi[] = [];
  const roads: ParsedRoad[] = [];
  let skippedElements = 0;

  for (const el of response.elements) {
    const context = elementContext(el);
    const classification = classifyElement(el.tags, context);

    if (classification.kind === "unmapped") {
      skippedElements += 1;
      continue;
    }

    if (classification.kind === "road") {
      roads.push({
        roadClass: classification.roadClass,
        name: elementName(el.tags),
        geomWKT: resolveRoadGeometry(el),
      });
      continue;
    }

    const { lon, lat } = resolvePoiCoordinates(el);
    pois.push({
      category: classification.category,
      name: elementName(el.tags),
      osmType: el.type,
      osmId: el.id,
      lon,
      lat,
    });
  }

  return { pois, roads, skippedElements, sourceUpdatedAt };
}
