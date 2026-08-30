/**
 * Vertical-slice seed data: ~20 real Tokyo stations across 4 wards, plus
 * one deliberately disconnected station, giving every later task (7-10,
 * 14) real data to test against without network access.
 *
 * Truncates every table it owns (CASCADE, so derived tables like
 * station_areas / neighborhood_metrics are cleared too — `pnpm derive`
 * repopulates them from this data) and reinserts inside one transaction.
 * Every row carries `source = 'seed'`, except rent_stats, whose `source`
 * column identifies the data *provider* ('estat' | 'reins') rather than
 * "came from the seed script" — see fixtures/seed/rent.ts.
 *
 * Idempotent by construction: fixtures are deterministic (no
 * `Math.random()`, no clock reads), and every run truncates first, so row
 * counts are identical across runs.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm db:seed --confirm-dev-seed
 */

import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { createPool, withTransaction } from "./lib/db.js";
import {
  WARDS,
  STATIONS,
  STATION_SOURCE_REFS,
  RAIL_LINES,
  RAIL_EDGES,
  RENT_STATS,
  LAND_PRICES,
  ZONING_AREAS,
  POIS,
  MAJOR_ROADS,
  GREEN_SPACES,
  multiPolygonWKT,
  multiLineStringWKT,
  pointWKT,
} from "./fixtures/seed/index.js";

const SEED_SOURCE = "seed";

export function assertSeedAllowed(argv: readonly string[], databaseUrl: string | undefined): void {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for db:seed");
  if (/(production|prod)/i.test(databaseUrl)) throw new Error("db:seed refuses a production-named DATABASE_URL");
  if (!/(test|_test|localhost|127\.0\.0\.1)/i.test(databaseUrl) && !argv.includes("--confirm-dev-seed")) {
    throw new Error("db:seed requires --confirm-dev-seed for a non-test development database");
  }
}

const OWNED_TABLES = [
  "wards",
  "station_groups",
  "station_source_refs",
  "rail_lines",
  "rail_edges",
  "rent_stats",
  "land_prices",
  "zoning_areas",
  "pois",
  "major_roads",
  "green_spaces",
] as const;

// Tables printed in the row-count summary: owned tables plus the tables
// CASCADE also clears (derived by `pnpm derive`, not seeded directly).
const SUMMARY_TABLES = [...OWNED_TABLES, "station_areas", "neighborhood_metrics"] as const;

async function truncateOwnedTables(client: PoolClient): Promise<void> {
  await client.query(`TRUNCATE TABLE ${OWNED_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

async function insertWards(client: PoolClient): Promise<void> {
  for (const ward of WARDS) {
    await client.query(
      `INSERT INTO wards (ward_code, name_ja, name_en, geom, source)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromText($4), 4326), $5)`,
      [ward.ward_code, ward.name_ja, ward.name_en, multiPolygonWKT([ward.ring]), SEED_SOURCE],
    );
  }
}

async function insertStations(client: PoolClient): Promise<void> {
  for (const station of STATIONS) {
    await client.query(
      `INSERT INTO station_groups (station_group_id, name_ja, name_en, aliases, point, ward_code, source)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromText($5), 4326), $6, $7)`,
      [
        station.station_group_id,
        station.name_ja,
        station.name_en,
        station.aliases ? [...station.aliases] : [],
        pointWKT(station.point),
        station.ward_code,
        SEED_SOURCE,
      ],
    );
  }
}

async function insertStationSourceRefs(client: PoolClient): Promise<void> {
  for (const ref of STATION_SOURCE_REFS) {
    await client.query(
      `INSERT INTO station_source_refs (station_group_id, source, source_id, source_name)
       VALUES ($1, $2, $3, $4)`,
      [ref.station_group_id, ref.source, ref.source_id, ref.source_name],
    );
  }
}

async function insertRailLines(client: PoolClient): Promise<void> {
  for (const line of RAIL_LINES) {
    await client.query(
      `INSERT INTO rail_lines (rail_line_id, operator, name_ja, name_en, mode, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [line.rail_line_id, line.operator, line.name_ja, line.name_en, line.mode, SEED_SOURCE],
    );
  }
}

async function insertRailEdges(client: PoolClient): Promise<void> {
  for (const edge of RAIL_EDGES) {
    await client.query(
      `INSERT INTO rail_edges
         (from_station_group_id, to_station_group_id, rail_line_id, edge_type,
          peak_travel_minutes, offpeak_travel_minutes, peak_wait_minutes, offpeak_wait_minutes,
          confidence, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        edge.from_station_group_id,
        edge.to_station_group_id,
        edge.rail_line_id,
        edge.edge_type,
        edge.peak_travel_minutes,
        edge.offpeak_travel_minutes,
        edge.peak_wait_minutes,
        edge.offpeak_wait_minutes,
        edge.confidence,
        SEED_SOURCE,
      ],
    );
  }
}

async function insertRentStats(client: PoolClient): Promise<void> {
  for (const stat of RENT_STATS) {
    // `source` here is the data provider ('estat' | 'reins'), not 'seed' —
    // see the module-level doc comment and fixtures/seed/rent.ts.
    await client.query(
      `INSERT INTO rent_stats (ward_code, period, source, rent_per_sqm_yen, management_fee_yen, sample_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        stat.ward_code,
        stat.period,
        stat.source,
        stat.rent_per_sqm_yen,
        stat.management_fee_yen,
        stat.sample_count,
      ],
    );
  }
}

async function insertLandPrices(client: PoolClient): Promise<void> {
  for (const lp of LAND_PRICES) {
    await client.query(
      `INSERT INTO land_prices (point, price_yen_per_sqm, year, use_category, ward_code, source)
       VALUES (ST_SetSRID(ST_GeomFromText($1), 4326), $2, $3, $4, $5, $6)`,
      [
        pointWKT(lp.point),
        lp.price_yen_per_sqm,
        lp.year,
        lp.use_category,
        lp.ward_code,
        SEED_SOURCE,
      ],
    );
  }
}

async function insertZoningAreas(client: PoolClient): Promise<void> {
  for (const z of ZONING_AREAS) {
    await client.query(
      `INSERT INTO zoning_areas (category, is_residential, geom, source)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4)`,
      [z.category, z.is_residential, multiPolygonWKT([z.ring]), SEED_SOURCE],
    );
  }
}

async function insertPois(client: PoolClient): Promise<void> {
  for (const poi of POIS) {
    await client.query(
      `INSERT INTO pois (category, name, point, source, cuisine, opening_hours)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4, $5, $6)`,
      [poi.category, poi.name, pointWKT(poi.point), SEED_SOURCE, poi.cuisine, poi.openingHours],
    );
  }
}

async function insertMajorRoads(client: PoolClient): Promise<void> {
  for (const road of MAJOR_ROADS) {
    await client.query(
      `INSERT INTO major_roads (name, road_class, geom, source)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4)`,
      [road.name, road.road_class, multiLineStringWKT([road.line]), SEED_SOURCE],
    );
  }
}

async function insertGreenSpaces(client: PoolClient): Promise<void> {
  for (const gs of GREEN_SPACES) {
    await client.query(
      `INSERT INTO green_spaces (name, leisure_class, geom, source)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4)`,
      [gs.name, gs.leisure_class, multiPolygonWKT([gs.ring]), SEED_SOURCE],
    );
  }
}

export async function runSeed(): Promise<void> {
  const pool = createPool();
  try {
    await withTransaction(pool, async (client) => {
      await truncateOwnedTables(client);
      await insertWards(client);
      await insertStations(client);
      await insertStationSourceRefs(client);
      await insertRailLines(client);
      await insertRailEdges(client);
      await insertRentStats(client);
      await insertLandPrices(client);
      await insertZoningAreas(client);
      await insertPois(client);
      await insertMajorRoads(client);
      await insertGreenSpaces(client);
    });

    console.log("seed complete. Row counts:");
    for (const table of SUMMARY_TABLES) {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table}`,
      );
      const count = rows[0]?.count ?? "0";
      console.log(`  ${table}: ${count}`);
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try { assertSeedAllowed(process.argv.slice(2), process.env["DATABASE_URL"]); }
  catch (error) { console.error(error); process.exit(1); }

  await runSeed();
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
