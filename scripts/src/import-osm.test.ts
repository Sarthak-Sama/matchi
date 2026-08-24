/**
 * Tests for `pnpm import:osm`.
 *
 * The pure-function tests below (tag classification, Overpass JSON
 * parsing, query building, download error handling) never touch a
 * database or the network — every input comes from the small committed
 * fixtures under `fixtures/osm/`, hand-built in-memory data, or an
 * injected fake `fetch`.
 *
 * The DB-guarded section at the bottom requires a real PostGIS database
 * reachable via `DATABASE_URL` — it skips with an explicit message when
 * unset, so a missing env var never reads as a silent pass. Run with:
 *
 *   DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOKYO_23_WARDS_BBOX } from "@tokyo/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { downloadOverpass } from "./import-osm/download.js";
import { classifyElement, parseOverpassResponse } from "./import-osm/parse.js";
import { buildOverpassQuery } from "./import-osm/query.js";
import type { ImportOsmArgs, OsmImportResult } from "./import-osm.js";
import { parseArgs, runOsmImport } from "./import-osm.js";
import { runImport } from "./lib/import-run.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures/osm");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

// ---------------------------------------------------------------------------
// classifyElement — tag -> category/road mapping, and the precedence rule.
// ---------------------------------------------------------------------------

describe("classifyElement", () => {
  it("maps each shop=* value to its expected category", () => {
    expect(classifyElement({ shop: "supermarket" }, "t")).toEqual({ kind: "poi", category: "supermarket" });
    expect(classifyElement({ shop: "greengrocer" }, "t")).toEqual({ kind: "poi", category: "grocery" });
    expect(classifyElement({ shop: "butcher" }, "t")).toEqual({ kind: "poi", category: "grocery" });
    expect(classifyElement({ shop: "bakery" }, "t")).toEqual({ kind: "poi", category: "grocery" });
    expect(classifyElement({ shop: "grocery" }, "t")).toEqual({ kind: "poi", category: "grocery" });
    expect(classifyElement({ shop: "convenience" }, "t")).toEqual({ kind: "poi", category: "convenience" });
  });

  it("maps each amenity=* value to its expected category", () => {
    expect(classifyElement({ amenity: "restaurant" }, "t")).toEqual({ kind: "poi", category: "restaurant" });
    expect(classifyElement({ amenity: "cafe" }, "t")).toEqual({ kind: "poi", category: "cafe" });
    expect(classifyElement({ amenity: "bar" }, "t")).toEqual({ kind: "poi", category: "bar" });
    expect(classifyElement({ amenity: "pub" }, "t")).toEqual({ kind: "poi", category: "bar" });
    expect(classifyElement({ amenity: "nightclub" }, "t")).toEqual({ kind: "poi", category: "bar" });
  });

  it("maps each highway=* value to a road, not a poi", () => {
    expect(classifyElement({ highway: "motorway" }, "t")).toEqual({ kind: "road", roadClass: "motorway" });
    expect(classifyElement({ highway: "trunk" }, "t")).toEqual({ kind: "road", roadClass: "trunk" });
    expect(classifyElement({ highway: "primary" }, "t")).toEqual({ kind: "road", roadClass: "primary" });
  });

  it("an unmapped tag (and no tags at all) is skipped, not classified as poi/road", () => {
    expect(classifyElement({ shop: "hairdresser" }, "t")).toEqual({ kind: "unmapped" });
    expect(classifyElement({ highway: "residential" }, "t")).toEqual({ kind: "unmapped" });
    expect(classifyElement(undefined, "t")).toEqual({ kind: "unmapped" });
    expect(classifyElement({}, "t")).toEqual({ kind: "unmapped" });
  });

  it("highway wins over shop/amenity even when both are present", () => {
    expect(classifyElement({ highway: "primary", shop: "supermarket" }, "t")).toEqual({
      kind: "road",
      roadClass: "primary",
    });
  });

  it("shop wins over amenity when both map to different categories (documented precedence rule)", () => {
    expect(classifyElement({ shop: "supermarket", amenity: "cafe" }, "t")).toEqual({
      kind: "poi",
      category: "supermarket",
    });
  });

  it("maps each health amenity=* value to the health category", () => {
    expect(classifyElement({ amenity: "clinic" }, "t")).toEqual({ kind: "poi", category: "health" });
    expect(classifyElement({ amenity: "doctors" }, "t")).toEqual({ kind: "poi", category: "health" });
    expect(classifyElement({ amenity: "pharmacy" }, "t")).toEqual({ kind: "poi", category: "health" });
    expect(classifyElement({ amenity: "hospital" }, "t")).toEqual({ kind: "poi", category: "health" });
  });

  it("maps each landmark amenity=* value to the landmark category", () => {
    expect(classifyElement({ amenity: "university" }, "t")).toEqual({ kind: "poi", category: "landmark" });
    expect(classifyElement({ amenity: "college" }, "t")).toEqual({ kind: "poi", category: "landmark" });
    expect(classifyElement({ amenity: "school" }, "t")).toEqual({ kind: "poi", category: "landmark" });
  });

  it("a named office=* is classified as landmark", () => {
    expect(classifyElement({ office: "insurance", name: "Fixture Insurance Office" }, "t")).toEqual({
      kind: "poi",
      category: "landmark",
    });
  });

  it("an unnamed office=* is NOT classified as landmark (no name tag at all, or an empty one)", () => {
    expect(classifyElement({ office: "insurance" }, "t")).toEqual({ kind: "unmapped" });
    expect(classifyElement({ office: "insurance", name: "" }, "t")).toEqual({ kind: "unmapped" });
  });

  it("maps leisure=park|garden to a green_space, not a poi", () => {
    expect(classifyElement({ leisure: "park" }, "t")).toEqual({ kind: "green_space", leisureClass: "park" });
    expect(classifyElement({ leisure: "garden" }, "t")).toEqual({
      kind: "green_space",
      leisureClass: "garden",
    });
  });

  it("an unmapped leisure value is skipped, not classified as a green_space", () => {
    expect(classifyElement({ leisure: "pitch" }, "t")).toEqual({ kind: "unmapped" });
  });
});

// ---------------------------------------------------------------------------
// parseOverpassResponse — the committed fixture.
// ---------------------------------------------------------------------------

describe("parseOverpassResponse: valid fixture", () => {
  const parsed = parseOverpassResponse(fixture("overpass-sample.osm.json"));

  it("maps every element type to its expected category, using the right coordinates", () => {
    expect(parsed.pois).toHaveLength(6);

    const byOsmId = new Map(parsed.pois.map((p) => [p.osmId, p]));

    // node -> uses its own lat/lon
    expect(byOsmId.get(1001)).toMatchObject({
      category: "supermarket",
      osmType: "node",
      lon: 139.7017,
      lat: 35.6581,
    });
    expect(byOsmId.get(1002)).toMatchObject({ category: "convenience", osmType: "node" });

    // way with center -> uses the way's center, not any node coordinate
    expect(byOsmId.get(2001)).toMatchObject({
      category: "grocery", // shop=bakery
      osmType: "way",
      lon: 139.703,
      lat: 35.6595,
    });
    expect(byOsmId.get(2002)).toMatchObject({
      category: "cafe",
      osmType: "way",
      lon: 139.7041,
      lat: 35.6602,
    });

    // relation with center -> uses the relation's center
    expect(byOsmId.get(3001)).toMatchObject({
      category: "restaurant",
      osmType: "relation",
      lon: 139.7052,
      lat: 35.6611,
    });
    expect(byOsmId.get(3002)).toMatchObject({
      category: "bar", // amenity=pub
      osmType: "relation",
      lon: 139.7063,
      lat: 35.662,
    });
  });

  it("carries cuisine/opening_hours through when present, and null when absent", () => {
    const byOsmId = new Map(parsed.pois.map((p) => [p.osmId, p]));

    expect(byOsmId.get(3001)).toMatchObject({ cuisine: "japanese", openingHours: "24/7" });
    expect(byOsmId.get(1001)).toMatchObject({ cuisine: null, openingHours: null });
  });

  it("the unmapped element (shop=hairdresser) is skipped without aborting the run", () => {
    expect(parsed.skippedElements).toBe(1);
    expect(parsed.pois.some((p) => p.osmId === 1003)).toBe(false);
  });

  it("the road way keeps real linework as MultiLineString WKT, not a centroid", () => {
    expect(parsed.roads).toHaveLength(1);
    const road = parsed.roads[0];
    expect(road).toBeDefined();
    expect(road?.roadClass).toBe("primary");
    expect(road?.name).toBe("Fixture Avenue");
    expect(road?.geomWKT).toBe(
      "MULTILINESTRING((139.7 35.657, 139.702 35.658, 139.704 35.659))",
    );
  });

  it("source_updated_at is parsed from osm3s.timestamp_osm_base", () => {
    expect(parsed.sourceUpdatedAt).toEqual(new Date("2026-06-01T12:00:00Z"));
  });

  it("parses a leisure=park way's own geometry into a closed MultiPolygon ring", () => {
    expect(parsed.greenSpaces).toHaveLength(2);
    const park = parsed.greenSpaces.find((g) => g.name === "Fixture Park");
    expect(park).toMatchObject({ leisureClass: "park" });
    expect(park?.geomWKT).toBe(
      "MULTIPOLYGON(((139.709 35.664, 139.7095 35.6645, 139.71 35.6635, 139.709 35.664)))",
    );
  });

  it("parses a leisure=garden relation from its 'outer' way member(s), closing an open ring and ignoring 'inner' (hole) members", () => {
    const garden = parsed.greenSpaces.find((g) => g.name === "Fixture Garden");
    expect(garden).toMatchObject({ leisureClass: "garden" });
    // Only the "outer" member's 3 vertices, closed by repeating the first —
    // the "inner" member's vertices never appear.
    expect(garden?.geomWKT).toBe(
      "MULTIPOLYGON(((139.711 35.665, 139.7115 35.6655, 139.712 35.6645, 139.711 35.665)))",
    );
  });
});

describe("parseOverpassResponse: degenerate green-space geometry", () => {
  // OSM genuinely contains unfinished park outlines with fewer than 3
  // vertices. The real 23-ward extract aborted the whole import transaction
  // on osm way 1156828012 (a 2-vertex leisure way) before these were skipped.
  function responseWith(elements: readonly unknown[]): string {
    return JSON.stringify({ version: 0.6, generator: "test", elements });
  }

  it("skips a 2-vertex park way instead of aborting the import", () => {
    const raw = responseWith([
      {
        type: "way",
        id: 1156828012,
        tags: { leisure: "park", name: "Unfinished Outline" },
        geometry: [
          { lat: 35.664, lon: 139.709 },
          { lat: 35.6645, lon: 139.7095 },
        ],
      },
    ]);
    const result = parseOverpassResponse(raw);
    expect(result.greenSpaces).toHaveLength(0);
    expect(result.skippedElements).toBe(1);
  });

  it("keeps a relation's valid outer rings when only some members are degenerate", () => {
    const raw = responseWith([
      {
        type: "relation",
        id: 42,
        tags: { leisure: "park", name: "Partly Mapped Park" },
        members: [
          {
            type: "way",
            role: "outer",
            geometry: [
              { lat: 35.664, lon: 139.709 },
              { lat: 35.6645, lon: 139.7095 },
            ],
          },
          {
            type: "way",
            role: "outer",
            geometry: [
              { lat: 35.665, lon: 139.711 },
              { lat: 35.6655, lon: 139.7115 },
              { lat: 35.6645, lon: 139.712 },
            ],
          },
        ],
      },
    ]);
    const result = parseOverpassResponse(raw);
    expect(result.greenSpaces).toHaveLength(1);
    expect(result.greenSpaces[0]?.geomWKT).toBe(
      "MULTIPOLYGON(((139.711 35.665, 139.7115 35.6655, 139.712 35.6645, 139.711 35.665)))",
    );
  });

  it("skips a relation whose every outer member is degenerate", () => {
    const raw = responseWith([
      {
        type: "relation",
        id: 43,
        tags: { leisure: "garden", name: "All Unfinished" },
        members: [
          {
            type: "way",
            role: "outer",
            geometry: [
              { lat: 35.664, lon: 139.709 },
              { lat: 35.6645, lon: 139.7095 },
            ],
          },
        ],
      },
    ]);
    const result = parseOverpassResponse(raw);
    expect(result.greenSpaces).toHaveLength(0);
    expect(result.skippedElements).toBe(1);
  });
});

describe("parseOverpassResponse: malformed fixture", () => {
  it("a malformed element (missing coordinates) aborts with a clear message", () => {
    const raw = fixture("overpass-malformed.osm.json");
    expect(() => parseOverpassResponse(raw)).toThrowError(
      /osm node 9001: node is missing lat\/lon coordinates/,
    );
  });
});

describe("parseOverpassResponse: malformed input shapes", () => {
  it("rejects non-JSON input", () => {
    expect(() => parseOverpassResponse("not json")).toThrowError(/not valid JSON/);
  });

  it("rejects JSON without an elements array", () => {
    expect(() => parseOverpassResponse(JSON.stringify({ osm3s: {} }))).toThrowError(
      /expected an object with an "elements" array/,
    );
  });

  it("a highway tag on a node (not a way) is a hard error, not silently coerced", () => {
    const raw = JSON.stringify({
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: [{ type: "node", id: 1, lat: 35.6, lon: 139.7, tags: { highway: "primary" } }],
    });
    expect(() => parseOverpassResponse(raw)).toThrowError(/only "way" elements are supported/);
  });

  it("a highway tag on a relation (not a way) is also a hard error", () => {
    const raw = JSON.stringify({
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: [
        { type: "relation", id: 1, center: { lat: 35.6, lon: 139.7 }, tags: { highway: "trunk" } },
      ],
    });
    expect(() => parseOverpassResponse(raw)).toThrowError(/only "way" elements are supported/);
  });

  it("a highway way missing its geometry array is a hard error", () => {
    const raw = JSON.stringify({
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: [{ type: "way", id: 1, tags: { highway: "trunk" } }],
    });
    expect(() => parseOverpassResponse(raw)).toThrowError(/missing its "geometry" array/);
  });

  it("a way/relation poi missing its center is a hard error", () => {
    const raw = JSON.stringify({
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: [{ type: "way", id: 1, tags: { amenity: "cafe" } }],
    });
    expect(() => parseOverpassResponse(raw)).toThrowError(/has no "center"/);
  });

  it("a leisure=park tag on a node is a hard error, not silently coerced to a point", () => {
    const raw = JSON.stringify({
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: [{ type: "node", id: 1, lat: 35.6, lon: 139.7, tags: { leisure: "park" } }],
    });
    expect(() => parseOverpassResponse(raw)).toThrowError(/only "way"\/"relation" elements are supported/);
  });

  it("a leisure=park way missing its geometry array is a hard error", () => {
    const raw = JSON.stringify({
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: [{ type: "way", id: 1, tags: { leisure: "garden" } }],
    });
    expect(() => parseOverpassResponse(raw)).toThrowError(/missing its "geometry" array/);
  });

  it("a leisure=park relation with no 'outer'-role way member carrying geometry is a hard error", () => {
    const raw = JSON.stringify({
      osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
      elements: [
        {
          type: "relation",
          id: 1,
          members: [{ type: "way", ref: 1, role: "inner", geometry: [] }],
          tags: { leisure: "park" },
        },
      ],
    });
    expect(() => parseOverpassResponse(raw)).toThrowError(/no "outer"-role way member/);
  });

  it("a missing osm3s.timestamp_osm_base warns and yields a null source_updated_at, not an error", () => {
    const raw = JSON.stringify({ elements: [] });
    const parsed = parseOverpassResponse(raw);
    expect(parsed.sourceUpdatedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildOverpassQuery — pure string building, no network.
// ---------------------------------------------------------------------------

describe("buildOverpassQuery", () => {
  const query = buildOverpassQuery(TOKYO_23_WARDS_BBOX);

  it("includes the bbox coordinates", () => {
    expect(query).toContain("35.5,139.56,35.82,139.92");
  });

  it("includes every mapped shop/amenity/highway/leisure/office filter", () => {
    expect(query).toContain(`["shop"="supermarket"]`);
    expect(query).toContain(`["shop"~"^(greengrocer|butcher|bakery|grocery)$"]`);
    expect(query).toContain(`["shop"="convenience"]`);
    expect(query).toContain(`["amenity"="restaurant"]`);
    expect(query).toContain(`["amenity"="cafe"]`);
    expect(query).toContain(`["amenity"~"^(bar|pub|nightclub)$"]`);
    expect(query).toContain(`["amenity"~"^(clinic|doctors|pharmacy|hospital)$"]`);
    expect(query).toContain(`["amenity"~"^(university|college|school)$"]`);
    expect(query).toContain(`["office"]["name"]`);
    expect(query).toContain(`["highway"~"^(motorway|trunk|primary)$"]`);
    expect(query).toContain(`["leisure"~"^(park|garden)$"]`);
  });

  it("requests out center for pois and out geom for roads/green spaces, with a single out geom block", () => {
    expect(query).toContain("out center;");
    expect(query.match(/out geom;/g)).toHaveLength(1);
  });

  it("adds the leisure filter to the same block as the highway filter (way and relation)", () => {
    expect(query).toContain(`way["leisure"~"^(park|garden)$"]`);
    expect(query).toContain(`relation["leisure"~"^(park|garden)$"]`);
  });
});

// ---------------------------------------------------------------------------
// downloadOverpass — politeness/error handling, via an injected fake fetch.
// ---------------------------------------------------------------------------

describe("downloadOverpass", () => {
  it("sends exactly one POST request with a descriptive User-Agent", async () => {
    let callCount = 0;
    let capturedInit: RequestInit | undefined;
    const fakeFetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      callCount += 1;
      capturedInit = init;
      return new Response("{}", { status: 200 });
    };

    const text = await downloadOverpass("[out:json];", fakeFetch);

    expect(text).toBe("{}");
    expect(callCount).toBe(1);
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/tokyo-area-finder-import-osm/);
  });

  it("gives a clear, specific error on 429 (rate limited)", async () => {
    const fakeFetch = async (): Promise<Response> => new Response("", { status: 429 });
    await expect(downloadOverpass("[out:json];", fakeFetch)).rejects.toThrowError(/rate-limited/);
  });

  it("gives a clear, specific error on 504 (overloaded)", async () => {
    const fakeFetch = async (): Promise<Response> => new Response("", { status: 504 });
    await expect(downloadOverpass("[out:json];", fakeFetch)).rejects.toThrowError(/timed out/);
  });

  it("gives a generic-but-labeled error on any other non-OK status", async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response("", { status: 500, statusText: "Internal Server Error" });
    await expect(downloadOverpass("[out:json];", fakeFetch)).rejects.toThrowError(
      /Overpass download failed \(500/,
    );
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses --file", () => {
    expect(parseArgs(["--file", "data/tokyo.osm.json"])).toEqual({
      filePath: "data/tokyo.osm.json",
      download: false,
    });
  });

  it("parses --download", () => {
    expect(parseArgs(["--download"])).toEqual({ filePath: undefined, download: true });
  });
});

// ---------------------------------------------------------------------------
// DB integration — guarded on DATABASE_URL.
// ---------------------------------------------------------------------------

const databaseUrl = process.env["DATABASE_URL"];

const GOOD_ARGS: ImportOsmArgs = {
  filePath: fixturePath("overpass-sample.osm.json"),
  download: false,
};

async function poisSnapshot(pool: Pool): Promise<
  {
    category: string;
    osm_type: string;
    osm_id: string;
    cuisine: string | null;
    opening_hours: string | null;
  }[]
> {
  const { rows } = await pool.query<{
    category: string;
    osm_type: string;
    osm_id: string;
    cuisine: string | null;
    opening_hours: string | null;
  }>(
    `SELECT category, osm_type, osm_id::text, cuisine, opening_hours FROM pois
     WHERE source = 'openstreetmap' ORDER BY osm_type, osm_id`,
  );
  return rows;
}

async function roadsSnapshot(pool: Pool): Promise<{ road_class: string; name: string | null }[]> {
  const { rows } = await pool.query<{ road_class: string; name: string | null }>(
    `SELECT road_class, name FROM major_roads WHERE source = 'openstreetmap' ORDER BY name`,
  );
  return rows;
}

async function greenSpacesSnapshot(
  pool: Pool,
): Promise<{ leisure_class: string; name: string | null }[]> {
  const { rows } = await pool.query<{ leisure_class: string; name: string | null }>(
    `SELECT leisure_class, name FROM green_spaces WHERE source = 'openstreetmap' ORDER BY name`,
  );
  return rows;
}

describe.runIf(Boolean(databaseUrl))("import:osm (DB integration)", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) return;
    await runMigrations({ dryRun: false });
    await runSeed();
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`DELETE FROM import_runs WHERE source = 'openstreetmap'`);
    // Clean slate for this script's own source-scoped data too, independent
    // of whatever else has run against this shared database.
    await pool.query(`DELETE FROM pois WHERE source = 'openstreetmap'`);
    await pool.query(`DELETE FROM major_roads WHERE source = 'openstreetmap'`);
    await pool.query(`DELETE FROM green_spaces WHERE source = 'openstreetmap'`);
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.query(`DELETE FROM pois WHERE source = 'openstreetmap'`);
    await pool.query(`DELETE FROM major_roads WHERE source = 'openstreetmap'`);
    await pool.query(`DELETE FROM green_spaces WHERE source = 'openstreetmap'`);
    await pool.end();
  });

  it("a full run writes the pois + roads and records one success import_runs row", async () => {
    const result = (await runImport(
      { source: "openstreetmap", pool },
      (client) => runOsmImport(client, GOOD_ARGS),
    )) as OsmImportResult;

    expect(result.poisImported).toBe(6);
    expect(result.roadsImported).toBe(1);
    expect(result.greenSpacesImported).toBe(2);
    expect(result.skippedElements).toBe(1);
    expect(result.rowsImported).toBe(9);

    const { rows: runRows } = await pool.query<{ status: string; rows_imported: number | null }>(
      `SELECT status, rows_imported FROM import_runs WHERE source = 'openstreetmap'`,
    );
    expect(runRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({ status: "success", rows_imported: 9 });

    // poisSnapshot orders by (osm_type, osm_id) text — alphabetically
    // "node" < "relation" < "way".
    const pois = await poisSnapshot(pool);
    expect(pois).toEqual([
      { category: "supermarket", osm_type: "node", osm_id: "1001", cuisine: null, opening_hours: null },
      { category: "convenience", osm_type: "node", osm_id: "1002", cuisine: null, opening_hours: null },
      {
        category: "restaurant",
        osm_type: "relation",
        osm_id: "3001",
        cuisine: "japanese",
        opening_hours: "24/7",
      },
      { category: "bar", osm_type: "relation", osm_id: "3002", cuisine: null, opening_hours: null },
      { category: "grocery", osm_type: "way", osm_id: "2001", cuisine: null, opening_hours: null },
      { category: "cafe", osm_type: "way", osm_id: "2002", cuisine: null, opening_hours: null },
    ]);

    const roads = await roadsSnapshot(pool);
    expect(roads).toEqual([{ road_class: "primary", name: "Fixture Avenue" }]);

    const greenSpaces = await greenSpacesSnapshot(pool);
    expect(greenSpaces).toEqual([
      { leisure_class: "garden", name: "Fixture Garden" },
      { leisure_class: "park", name: "Fixture Park" },
    ]);
  });

  it("re-running with the same fixture is idempotent: identical rows, no duplicate POIs, one more success run record", async () => {
    const before = await poisSnapshot(pool);
    const { rows: countBefore } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pois WHERE source = 'openstreetmap'`,
    );

    const result = (await runImport(
      { source: "openstreetmap", pool },
      (client) => runOsmImport(client, GOOD_ARGS),
    )) as OsmImportResult;

    expect(result.rowsImported).toBe(9);

    const after = await poisSnapshot(pool);
    expect(after.sort((a, b) => a.osm_id.localeCompare(b.osm_id))).toEqual(
      before.sort((a, b) => a.osm_id.localeCompare(b.osm_id)),
    );

    const { rows: countAfter } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pois WHERE source = 'openstreetmap'`,
    );
    expect(countAfter[0]?.count).toBe(countBefore[0]?.count);
    expect(Number(countAfter[0]?.count)).toBe(6);

    const { rows: runRows } = await pool.query<{ status: string }>(
      `SELECT status FROM import_runs WHERE source = 'openstreetmap' ORDER BY started_at`,
    );
    expect(runRows).toHaveLength(2);
    expect(runRows.every((r) => r.status === "success")).toBe(true);
  });

  it("a malformed fixture writes one failed import_runs row and leaves pois/roads/green_spaces unchanged", async () => {
    const beforePois = await poisSnapshot(pool);
    const beforeRoads = await roadsSnapshot(pool);
    const beforeGreenSpaces = await greenSpacesSnapshot(pool);

    await expect(
      runImport({ source: "openstreetmap", pool }, (client) =>
        runOsmImport(client, { filePath: fixturePath("overpass-malformed.osm.json"), download: false }),
      ),
    ).rejects.toThrowError(/node is missing lat\/lon coordinates/);

    expect(await poisSnapshot(pool)).toEqual(beforePois);
    expect(await roadsSnapshot(pool)).toEqual(beforeRoads);
    expect(await greenSpacesSnapshot(pool)).toEqual(beforeGreenSpaces);

    const { rows: runRows } = await pool.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM import_runs WHERE source = 'openstreetmap' ORDER BY started_at`,
    );
    expect(runRows).toHaveLength(3);
    expect(runRows[2]?.status).toBe("failed");
    expect(runRows[2]?.error).toMatch(/node is missing lat\/lon coordinates/);
  });
});

describe("import:osm", () => {
  // Sentinel test: passes (with an explicit explanatory title) only when
  // DATABASE_URL is unset, so `pnpm test` output always makes clear *why*
  // the real integration tests above were skipped rather than silently
  // omitted. When DATABASE_URL is set, this sentinel itself is skipped.
  it.skipIf(Boolean(databaseUrl))(
    "SKIPPED integration tests above: DATABASE_URL is not set — set it to a PostGIS connection string to run them, e.g. DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
    () => {
      console.warn(
        "import-osm.test.ts: DATABASE_URL is not set; skipping PostGIS integration tests. " +
          "Run with DATABASE_URL=postgresql://tokyo:tokyo@localhost:5432/tokyo_test pnpm test",
      );
    },
  );
});
