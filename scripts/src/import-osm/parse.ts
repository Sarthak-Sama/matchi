/**
 * Pure Overpass-API-JSON parsing for `import:osm` — no DB, no network.
 * Every property this module reads (`elements[].type/id/lat/lon/center/
 * geometry/tags`, `osm3s.timestamp_osm_base`) is an ASSUMPTION about
 * Overpass's real response shape, documented per-field below and
 *
 * Tag → category mapping:
 *   shop=supermarket                       -> pois.category = "supermarket"
 *   shop=greengrocer|butcher|bakery|grocery -> pois.category = "grocery"
 *   shop=convenience                       -> pois.category = "convenience"
 *   amenity=restaurant                     -> pois.category = "restaurant"
 *   amenity=cafe                           -> pois.category = "cafe"
 *   amenity=bar|pub|nightclub              -> pois.category = "bar"
 *   amenity=clinic|doctors|pharmacy|hospital -> pois.category = "health"
 *   amenity=university|college|school      -> pois.category = "landmark"
 *   named office=*                         -> pois.category = "landmark"
 *   highway=motorway|trunk|primary         -> major_roads.road_class
 *   leisure=park|garden (way or relation)  -> green_spaces.leisure_class
 *
 * `pois.cuisine`/`pois.opening_hours` are carried through verbatim from the
 * OSM `cuisine`/`opening_hours` tags when present (any element, any
 * category) — `derive/amenities.ts` uses `cuisine` for
 * `COUNT(DISTINCT cuisine)` and `opening_hours` for a late-night heuristic.
 *
 * Tag-precedence rule (not specified by the brief): `highway` is checked
 * first, so a road-tagged element is always written to `major_roads`
 * regardless of any `shop`/`amenity` tag also present. Failing that, `shop`
 * is checked before `amenity` — so an element with both a mapped `shop=*`
 * and a mapped `amenity=*` tag (e.g. `shop=supermarket` + `amenity=cafe`)
 * becomes a `supermarket` POI, not a `cafe` one. This mirrors the brief's
 * own listing order (shop rules are listed before amenity rules) and is the
 * more specific classifier of the two for retail-shaped data.
 *
 * The `highway` half of this is a genuine impossibility from a real
 * Overpass response: `highway=*` is a way-only tag in real OSM data, so our
 * own query's `node[...]`/`relation[...]` POI filters can never match an
 * element that also carries a mapped `highway` value.
 *
 * The `shop`/`amenity` half is NOT a defensive guard against unreachable or
 * adversarial input — it fires on genuine `--download` output against real
 * Tokyo data, and should be expected to. `buildOverpassQuery` unions
 * several `node/way/relation[filter]` statements into one Overpass QL
 * block; Overpass deduplicates that union by element identity and returns
 * each matched element's *complete* real tag set, not just the tag that
 * matched the filter which found it. A single real element carrying both a
 * mapped `shop=*` and a mapped `amenity=*` tag therefore satisfies more
 * than one of our filters independently and comes back dual-tagged. This is
 * not exotic: `shop=bakery` + `amenity=cafe` (a bakery with a café counter)
 * is a common, legitimate OSM tagging pattern, and `bakery` is one of our
 * own mapped `GROCERY_SHOP_VALUES` — so this case is expected to fire on a
 * nontrivial fraction of a real Tokyo extract, not a rare edge case. The
 * `shop`-wins rule above is a deliberate modeling choice for that
 * expected, recurring situation, not an impossibility guard. Every time it
 * fires, `classifyElement` prints a loud warning naming both tags and the
 * tag that won rather than resolving silently — that warning is genuinely
 * worth reading after a live `--download` import, not noise to ignore.
 *
 * `highway` is checked first, then `leisure` (also a not-a-poi bucket),
 * then `shop`, then `amenity`; a named `office=*` is checked last, only when
 * nothing above matched — so an amenity=university (already "landmark" via
 * the amenity map) or a shop=supermarket never gets silently reclassified by
 * an incidental `office` tag on the same element.
 *
 * Skip vs. error, kept deliberately sharp per the brief:
 *   - An element whose tags match none of the rules above is SKIPPED
 *     (`classification.kind === "unmapped"`) — never an error, and its
 *     coordinates/geometry are never even inspected.
 *   - An element that DOES match a rule but lacks the coordinates its
 *     kind needs (a node with no lat/lon, a way/relation POI with no
 *     `center`, a highway way with no `geometry` array, or a park/garden
 *     way/relation with no `geometry` at all) is a hard error that
 *     aborts the whole import — see `resolvePoiCoordinates`,
 *     `resolveRoadGeometry`, and `resolveGreenSpaceGeometry`.
 *   - The one deliberate exception: a park/garden whose geometry IS present
 *     but has fewer than 3 vertices is SKIPPED and counted, not an error.
 *     Unfinished one- and two-vertex park outlines are real, valid OSM data
 *     that simply cannot form a polygon, and the real 23-ward extract
 *     contains them — aborting a 76k-row import over two such ways is the
 *     wrong trade. See `isUsableRing`.
 */

export type PoiCategory =
  "supermarket" | "grocery" | "convenience" | "restaurant" | "cafe" | "bar" | "health" | "landmark";
export type RoadClass = "motorway" | "trunk" | "primary";
export type LeisureClass = "park" | "garden";
export type OsmElementType = "node" | "way" | "relation";

// These tag-value lists are the single source of truth for the brief's
// mapping — `import-osm/query.ts`'s Overpass query builder imports them
// too, rather than re-listing the same values, so the query filters and
// this classifier can never drift apart.
export const GROCERY_SHOP_VALUES = ["greengrocer", "butcher", "bakery", "grocery"] as const;
export const BAR_AMENITY_VALUES = ["bar", "pub", "nightclub"] as const;
export const HEALTH_AMENITY_VALUES = ["clinic", "doctors", "pharmacy", "hospital"] as const;
export const LANDMARK_AMENITY_VALUES = ["university", "college", "school"] as const;
export const ROAD_HIGHWAY_VALUES: readonly RoadClass[] = ["motorway", "trunk", "primary"] as const;
export const GREEN_SPACE_LEISURE_VALUES: readonly LeisureClass[] = ["park", "garden"] as const;

const SHOP_CATEGORY_MAP: Readonly<Record<string, PoiCategory>> = {
  supermarket: "supermarket",
  convenience: "convenience",
  ...Object.fromEntries(GROCERY_SHOP_VALUES.map((v) => [v, "grocery" as const])),
};

const AMENITY_CATEGORY_MAP: Readonly<Record<string, PoiCategory>> = {
  restaurant: "restaurant",
  cafe: "cafe",
  ...Object.fromEntries(BAR_AMENITY_VALUES.map((v) => [v, "bar" as const])),
  ...Object.fromEntries(HEALTH_AMENITY_VALUES.map((v) => [v, "health" as const])),
  ...Object.fromEntries(LANDMARK_AMENITY_VALUES.map((v) => [v, "landmark" as const])),
};

function isRoadClass(value: string): value is RoadClass {
  return (ROAD_HIGHWAY_VALUES as readonly string[]).includes(value);
}

function isLeisureClass(value: string): value is LeisureClass {
  return (GREEN_SPACE_LEISURE_VALUES as readonly string[]).includes(value);
}

/** True when `tags.name` is a non-empty string — used for the "named office=*" landmark rule. */
function hasName(tags: Readonly<Record<string, unknown>>): boolean {
  return stringTag(tags, "name") !== null;
}

export type ElementClassification =
  | { readonly kind: "poi"; readonly category: PoiCategory }
  | { readonly kind: "road"; readonly roadClass: RoadClass }
  | { readonly kind: "green_space"; readonly leisureClass: LeisureClass }
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

  const leisure = typeof tags["leisure"] === "string" ? tags["leisure"] : undefined;
  if (leisure !== undefined && isLeisureClass(leisure)) {
    return { kind: "green_space", leisureClass: leisure };
  }

  const shop = typeof tags["shop"] === "string" ? tags["shop"] : undefined;
  const shopCategory = shop !== undefined ? SHOP_CATEGORY_MAP[shop] : undefined;

  const amenity = typeof tags["amenity"] === "string" ? tags["amenity"] : undefined;
  const amenityCategory = amenity !== undefined ? AMENITY_CATEGORY_MAP[amenity] : undefined;

  if (
    shopCategory !== undefined &&
    amenityCategory !== undefined &&
    shopCategory !== amenityCategory
  ) {
    console.warn(
      `import:osm — ${context}: has both shop=${shop} (-> ${shopCategory}) and amenity=${amenity} ` +
        `(-> ${amenityCategory}); shop takes precedence, category="${shopCategory}" (see ` +
        `import-osm/parse.ts's tag-precedence rule).`,
    );
  }

  if (shopCategory !== undefined) return { kind: "poi", category: shopCategory };
  if (amenityCategory !== undefined) return { kind: "poi", category: amenityCategory };

  const office = typeof tags["office"] === "string" ? tags["office"] : undefined;
  if (office !== undefined && hasName(tags)) {
    return { kind: "poi", category: "landmark" };
  }

  return { kind: "unmapped" };
}

/** One way-member of a relation, as returned by Overpass's `out geom;`. */
export interface OverpassMember {
  readonly type: OsmElementType;
  readonly ref: number;
  readonly role: string;
  readonly geometry?: readonly { readonly lat: number; readonly lon: number }[];
}

/** Raw Overpass element shape, as returned by `out center;` / `out geom;`. */
export interface OverpassElement {
  readonly type: OsmElementType;
  readonly id: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly center?: { readonly lat: number; readonly lon: number };
  readonly geometry?: readonly { readonly lat: number; readonly lon: number }[];
  /** Relation members — only way members carry their own `geometry` under `out geom;`. */
  readonly members?: readonly OverpassMember[];
  readonly tags?: Readonly<Record<string, unknown>>;
}

export interface OverpassResponse {
  readonly osm3s?: { readonly timestamp_osm_base?: string };
  readonly elements: readonly OverpassElement[];
}

export interface ParsedPoi {
  readonly category: PoiCategory;
  readonly name: string | null;
  /**
   * From the OSM `name:en` tag, verbatim; null when absent.
   *
   * `name` is the OSM `name` tag, which in Tokyo is the Japanese name — so
   * without this an English-speaking user cannot find their own campus or
   * office. Roughly half of real landmarks carry `name:en`, so this
   * supplements `name` and never replaces it.
   */
  readonly nameEn: string | null;
  readonly osmType: OsmElementType;
  readonly osmId: number;
  readonly lon: number;
  readonly lat: number;
  /** From the OSM `cuisine` tag, verbatim; null when absent. */
  readonly cuisine: string | null;
  /** From the OSM `opening_hours` tag, verbatim; null when absent. */
  readonly openingHours: string | null;
}

export interface ParsedRoad {
  readonly roadClass: RoadClass;
  readonly name: string | null;
  /** `MULTILINESTRING(...)` WKT, real linework (never a centroid). */
  readonly geomWKT: string;
}

export interface ParsedGreenSpace {
  readonly leisureClass: LeisureClass;
  readonly name: string | null;
  /** `MULTIPOLYGON(...)` WKT, real polygon ring(s) (never a centroid). */
  readonly geomWKT: string;
}

export interface ParsedOverpassData {
  readonly pois: readonly ParsedPoi[];
  readonly roads: readonly ParsedRoad[];
  readonly greenSpaces: readonly ParsedGreenSpace[];
  /**
   * Count of elements skipped: those carrying no mapped tag, plus
   * `leisure=park|garden` elements whose geometry cannot form a polygon
   * (see `isUsableRing`).
   */
  readonly skippedElements: number;
  readonly sourceUpdatedAt: Date | null;
}

function stringTag(
  tags: Readonly<Record<string, unknown>> | undefined | null,
  key: string,
): string | null {
  const value = tags?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function elementName(tags: Readonly<Record<string, unknown>> | undefined | null): string | null {
  return stringTag(tags, "name");
}

/** The OSM `name:en` tag — see `ParsedPoi.nameEn` for why it is carried separately. */
function elementNameEn(tags: Readonly<Record<string, unknown>> | undefined | null): string | null {
  return stringTag(tags, "name:en");
}

function elementContext(el: OverpassElement): string {
  return `osm ${el.type} ${String(el.id)}`;
}

/** Nodes use their own lat/lon; ways and relations use their `center`. */
function resolvePoiCoordinates(el: OverpassElement): {
  readonly lon: number;
  readonly lat: number;
} {
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

/**
 * True when a vertex array can form a polygon ring at all.
 *
 * OSM genuinely contains degenerate `leisure=park|garden` ways with one or
 * two vertices — a mapper's unfinished outline, or an area whose nodes were
 * partly deleted. That is real, valid OSM data that simply is not a polygon,
 * so it is a *skip* condition rather than a contract violation: treating it
 * as an error aborts the whole import transaction over a single bad way,
 * which is exactly what happened the first time this importer met the real
 * 23-ward extract. A missing `geometry` array or a non-numeric coordinate
 * still throws — those mean Overpass did not send what we asked for.
 */
function isUsableRing(
  vertices: readonly { readonly lat: number; readonly lon: number }[],
): boolean {
  return vertices.length >= 3;
}

/** Builds one `(...)` polygon ring's WKT, closing it if Overpass didn't repeat the first vertex. */
function ringWKT(
  vertices: readonly { readonly lat: number; readonly lon: number }[],
  ringContext: string,
): string {
  if (!isUsableRing(vertices)) {
    throw new Error(
      `${ringContext}: ring has only ${String(vertices.length)} vertex/vertices (expected at least 3)`,
    );
  }
  for (const vertex of vertices) {
    if (typeof vertex.lat !== "number" || typeof vertex.lon !== "number") {
      throw new Error(`${ringContext}: ring contains a vertex missing numeric lat/lon`);
    }
  }

  const closed = [...vertices];
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error(`${ringContext}: ring is unexpectedly empty`);
  }
  if (first.lat !== last.lat || first.lon !== last.lon) {
    closed.push(first);
  }

  const ring = closed.map((v) => `${v.lon} ${v.lat}`).join(", ");
  return `(${ring})`;
}

/**
 * Green space polygons keep real rings (a centroid would make `derive`'s
 * green-space-share metric meaningless). A `way` carrying Overpass's
 * `out geom;` `geometry` array supplies one ring directly. A `relation`
 * (OSM's usual multipolygon representation for a park made of several
 * disjoint or donut-shaped areas) has no top-level `geometry` of its own —
 * only its way `members` do — so its ring(s) come from every "outer"-role
 * way member's `geometry`. "inner"-role (hole) rings are not modeled: the
 * resulting polygon(s) may slightly overstate a park's true area where a
 * real hole exists (e.g. a building footprint inside a park), an acceptable
 * approximation for an area-*share* metric, not a precision measurement. A
 * `leisure=park|garden` tag on a node is not something our own Overpass
 * query can produce (it only asks for `way`/`relation`) and is a hard error
 * rather than silently coerced to a point.
 */
function resolveGreenSpaceGeometry(el: OverpassElement): string | null {
  const context = elementContext(el);

  if (el.type === "way") {
    if (el.geometry === undefined) {
      throw new Error(
        `${context}: park/garden way is missing its "geometry" array (expected Overpass's "out geom;" ` +
          `to have supplied it)`,
      );
    }
    if (!isUsableRing(el.geometry)) {
      console.warn(
        `import:osm — ${context}: park/garden way has only ${String(el.geometry.length)} ` +
          `vertex/vertices, which cannot form a polygon; skipping this green space.`,
      );
      return null;
    }
    // MULTIPOLYGON(( (single-ring-polygon) )) — one extra paren level wraps
    // ringWKT's bare ring into a one-ring polygon.
    return `MULTIPOLYGON((${ringWKT(el.geometry, context)}))`;
  }

  if (el.type === "relation") {
    const members = el.members ?? [];
    const outerPolygons: string[] = [];
    let degenerateOuterMembers = 0;
    for (const [index, member] of members.entries()) {
      if (member.role !== "outer" || member.type !== "way" || member.geometry === undefined)
        continue;
      // One unfinished outer way must not discard the rest of a valid
      // multipolygon park, so degenerate members are dropped individually.
      if (!isUsableRing(member.geometry)) {
        degenerateOuterMembers += 1;
        continue;
      }
      outerPolygons.push(
        `(${ringWKT(member.geometry, `${context} outer member #${String(index)}`)})`,
      );
    }
    if (outerPolygons.length === 0 && degenerateOuterMembers > 0) {
      console.warn(
        `import:osm — ${context}: park/garden relation's ${String(degenerateOuterMembers)} ` +
          `"outer"-role member(s) all have fewer than 3 vertices; skipping this green space.`,
      );
      return null;
    }
    if (outerPolygons.length === 0) {
      throw new Error(
        `${context}: park/garden relation has no "outer"-role way member with a "geometry" array ` +
          `(expected Overpass's "out geom;" to have supplied at least one)`,
      );
    }
    return `MULTIPOLYGON(${outerPolygons.join(", ")})`;
  }

  throw new Error(
    `${context}: leisure tag found on a "${el.type}", but only "way"/"relation" elements are supported ` +
      `for green_spaces (a park needs real polygon geometry, not a single centroid)`,
  );
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
  const greenSpaces: ParsedGreenSpace[] = [];
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

    if (classification.kind === "green_space") {
      const geomWKT = resolveGreenSpaceGeometry(el);
      if (geomWKT === null) {
        skippedElements += 1;
        continue;
      }
      greenSpaces.push({
        leisureClass: classification.leisureClass,
        name: elementName(el.tags),
        geomWKT,
      });
      continue;
    }

    const { lon, lat } = resolvePoiCoordinates(el);
    pois.push({
      category: classification.category,
      name: elementName(el.tags),
      nameEn: elementNameEn(el.tags),
      osmType: el.type,
      osmId: el.id,
      lon,
      lat,
      cuisine: stringTag(el.tags, "cuisine"),
      openingHours: stringTag(el.tags, "opening_hours"),
    });
  }

  return { pois, roads, greenSpaces, skippedElements, sourceUpdatedAt };
}
