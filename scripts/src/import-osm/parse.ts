export type PoiCategory =
  "supermarket" | "grocery" | "convenience" | "restaurant" | "cafe" | "bar" | "health" | "landmark";
export type RoadClass = "motorway" | "trunk" | "primary";
export type LeisureClass = "park" | "garden";
export type OsmElementType = "node" | "way" | "relation";

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

function hasName(tags: Readonly<Record<string, unknown>>): boolean {
  return stringTag(tags, "name") !== null;
}

export type ElementClassification =
  | { readonly kind: "poi"; readonly category: PoiCategory }
  | { readonly kind: "road"; readonly roadClass: RoadClass }
  | { readonly kind: "green_space"; readonly leisureClass: LeisureClass }
  | { readonly kind: "unmapped" };

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

export interface OverpassMember {
  readonly type: OsmElementType;
  readonly ref: number;
  readonly role: string;
  readonly geometry?: readonly { readonly lat: number; readonly lon: number }[];
}

export interface OverpassElement {
  readonly type: OsmElementType;
  readonly id: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly center?: { readonly lat: number; readonly lon: number };
  readonly geometry?: readonly { readonly lat: number; readonly lon: number }[];

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

  readonly nameEn: string | null;
  readonly osmType: OsmElementType;
  readonly osmId: number;
  readonly lon: number;
  readonly lat: number;

  readonly cuisine: string | null;

  readonly openingHours: string | null;
}

export interface ParsedRoad {
  readonly roadClass: RoadClass;
  readonly name: string | null;

  readonly geomWKT: string;
}

export interface ParsedGreenSpace {
  readonly leisureClass: LeisureClass;
  readonly name: string | null;

  readonly geomWKT: string;
}

export interface ParsedOverpassData {
  readonly pois: readonly ParsedPoi[];
  readonly roads: readonly ParsedRoad[];
  readonly greenSpaces: readonly ParsedGreenSpace[];

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

function elementNameEn(tags: Readonly<Record<string, unknown>> | undefined | null): string | null {
  return stringTag(tags, "name:en");
}

function elementContext(el: OverpassElement): string {
  return `osm ${el.type} ${String(el.id)}`;
}

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

function isUsableRing(
  vertices: readonly { readonly lat: number; readonly lon: number }[],
): boolean {
  return vertices.length >= 3;
}

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

    return `MULTIPOLYGON((${ringWKT(el.geometry, context)}))`;
  }

  if (el.type === "relation") {
    const members = el.members ?? [];
    const outerPolygons: string[] = [];
    let degenerateOuterMembers = 0;
    for (const [index, member] of members.entries()) {
      if (member.role !== "outer" || member.type !== "way" || member.geometry === undefined)
        continue;

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
