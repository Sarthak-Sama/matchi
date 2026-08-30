import { fileURLToPath } from "node:url";
import { createPool } from "./lib/db.js";

interface Check { readonly label: string; readonly sql: string; readonly expect: (value: number) => boolean; }

const checks: readonly Check[] = [
  { label: "exactly 23 wards", sql: "SELECT count(*)::int AS value FROM wards", expect: (n) => n === 23 },
  { label: "valid ward geometry", sql: "SELECT count(*)::int AS value FROM wards WHERE NOT ST_IsValid(geom)", expect: (n) => n === 0 },
  { label: "station coverage (450–550)", sql: "SELECT count(*)::int AS value FROM station_groups", expect: (n) => n >= 450 && n <= 550 },
  { label: "stations missing wards", sql: "SELECT count(*)::int AS value FROM station_groups WHERE ward_code IS NULL", expect: (n) => n === 0 },
  { label: "unclassified rail lines", sql: "SELECT count(*)::int AS value FROM rail_lines WHERE mode NOT IN ('subway','local_rail','commuter_rail','monorail')", expect: (n) => n === 0 },
  { label: "orphan topology stations", sql: "SELECT count(*)::int AS value FROM station_groups s WHERE NOT EXISTS (SELECT 1 FROM rail_edges e WHERE e.from_station_group_id=s.station_group_id OR e.to_station_group_id=s.station_group_id)", expect: (n) => n === 0 },
  { label: "2023 e-Stat rows", sql: "SELECT count(*)::int AS value FROM rent_stats WHERE source='estat' AND period='2023'", expect: (n) => n === 23 },
  { label: "seed/fixture rows", sql: "SELECT count(*)::int AS value FROM (SELECT source FROM wards UNION ALL SELECT source FROM station_groups UNION ALL SELECT source FROM rail_lines UNION ALL SELECT source FROM land_prices UNION ALL SELECT source FROM zoning_areas) x WHERE source IN ('seed','fixture')", expect: (n) => n === 0 },
  { label: "residential L01 points", sql: "SELECT count(*)::int AS value FROM land_prices WHERE source='mlit' AND use_category='residential'", expect: (n) => n > 0 },
  { label: "valid A55 geometry", sql: "SELECT count(*)::int AS value FROM zoning_areas WHERE source='mlit' AND NOT ST_IsValid(geom)", expect: (n) => n === 0 },
  { label: "complete normalized metrics", sql: "SELECT count(*)::int AS value FROM neighborhood_metrics WHERE norm_amenity_supermarket NOT BETWEEN 0 AND 100 OR norm_amenity_restaurant NOT BETWEEN 0 AND 100 OR norm_quietness NOT BETWEEN 0 AND 100", expect: (n) => n === 0 },
  { label: "valid locality geometry", sql: "SELECT count(*)::int AS value FROM localities WHERE NOT ST_IsValid(geom) OR NOT ST_Covers(geom, centroid)", expect: (n) => n === 0 },
  { label: "locality boundary coverage", sql: "SELECT count(*)::int AS value FROM localities", expect: (n) => n > 0 },
  { label: "nine contained samples per locality", sql: "SELECT count(*)::int AS value FROM localities l WHERE (SELECT count(*) FROM locality_samples s WHERE s.locality_id=l.locality_id) <> 9 OR EXISTS (SELECT 1 FROM locality_samples s WHERE s.locality_id=l.locality_id AND NOT ST_Covers(l.geom, s.point))", expect: (n) => n === 0 },
  { label: "complete locality metrics", sql: "SELECT count(*)::int AS value FROM locality_metrics WHERE norm_amenity_supermarket NOT BETWEEN 0 AND 100 OR norm_amenity_restaurant NOT BETWEEN 0 AND 100 OR norm_quietness NOT BETWEEN 0 AND 100", expect: (n) => n === 0 },
];

export async function runDataValidation(): Promise<void> {
  const pool = createPool();
  try {
    const failures: string[] = [];
    for (const check of checks) {
      const { rows } = await pool.query<{ value: number }>(check.sql);
      const value = Number(rows[0]?.value ?? NaN);
      if (!check.expect(value)) failures.push(`${check.label}: ${String(value)}`);
      else console.log(`data:validate — ok: ${check.label} (${String(value)})`);
    }
    if (failures.length > 0) throw new Error(`data validation failed:\n${failures.map((x) => `- ${x}`).join("\n")}`);
  } finally { await pool.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env["DATABASE_URL"]) { console.error("DATABASE_URL is required for data:validate"); process.exit(1); }
  runDataValidation().catch((error: unknown) => { console.error(error); process.exit(1); });
}
