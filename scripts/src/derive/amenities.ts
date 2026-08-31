/**
 * Step 2 — amenity counts.
 *
 * For each station, counts `pois` within `CATCHMENT_RADIUS_M` using
 * `ST_DWithin(point::geography, station.point::geography, 800)` — a
 * geography-cast distance check, so the 800m radius is genuine metres and
 * (per the brief) can use the GiST index on `pois.point`. See
 * derive.test.ts / the task report for the `EXPLAIN` plan.
 *
 * `amenity_supermarket_equiv` folds supermarket/grocery/convenience counts
 * into one "supermarket-equivalent" number via `AMENITY_WEIGHTS`.
 *
 * Three new raw counts, added to the same single-pass
 * CTE rather than a second query over `pois`:
 *
 *   - `health_count`: POIs with `category = 'health'` (OSM
 *     amenity=clinic|doctors|pharmacy|hospital, per import-osm/parse.ts).
 *
 *   - `cuisine_variety_count`: `COUNT(DISTINCT cuisine)` over "restaurant-ish"
 *     POIs, taken here as `category IN ('restaurant', 'cafe')` — the same
 *     pair `restaurant_count + cafe_count` already sums for
 *     `norm_amenity_restaurant`. `bar` is deliberately excluded: this axis
 *     is measuring food variety, and `COUNT(DISTINCT cuisine)` ignores a
 *     NULL `cuisine` on its own, so a restaurant/cafe with no `cuisine` tag
 *     simply doesn't contribute — no extra NULL-guard needed.
 *
 *   - `late_night_count`: POIs with `category IN ('restaurant', 'cafe',
 *     'bar')` whose `opening_hours` conservatively parses as closing at or
 *     after 23:00. **This is an approximation, not a real opening_hours
 *     parser.** The OSM `opening_hours` grammar is genuinely hard
 *     (multi-segment weekday rules, `PH`/holiday modifiers, cross-midnight
 *     ranges written as an early closing hour) and parsing it properly
 *     needs a dependency this project isn't taking on. The heuristic below
 *     matches only:
 *       - the literal string `24/7`, or
 *       - any `-HH:MM` closing token anywhere in the string with `HH` in
 *         `23`-`29` (covers a plain `23:xx`/`24:00` close and the
 *         `24:00`-`29:59` "past midnight" notation some OSM data uses).
 *     It does NOT attempt to identify which segment of a multi-segment
 *     string is the "last" one (any segment closing late is enough), and
 *     it does NOT understand a cross-midnight range written as an early
 *     closing hour — `Mo-Su 18:00-02:00` (genuinely open past 2am) is NOT
 *     counted, because the literal token `02:00` never matches. That is
 *     the required trade: the brief calls for a *conservative* heuristic,
 *     where a string this code can't confidently read is a false negative
 *     (undercounts) rather than a false positive (never overcounts). See
 *     fixtures/seed/pois.ts's shibuya bar/restaurant/cafe fixtures for
 *     worked examples of both the counted and the deliberately-uncounted
 *     shapes.
 *
 *     It WAS considered and rejected to match on a bare `-HH:MM` substring
 *     without checking for OSM's `off` rule modifier, which marks the
 *     time range it follows as CLOSED, not open — e.g.
 *     `"Mo-Su 09:00-22:00; Tu 22:00-23:30 off"` describes a venue that
 *     never opens past 22:00, but its `-23:30` substring would otherwise
 *     match. `off`-with-times is a standard, common OSM construct (lunch
 *     breaks, holiday exceptions), not a theoretical edge case, and
 *     matching it would be a false positive — exactly what the brief
 *     forbids. So the condition below additionally declines to count ANY
 *     string containing a standalone `off` token at all (word-bounded, so
 *     it doesn't misfire on `off` appearing inside an unrelated word like
 *     "Standoff"), spending another false negative rather than risk one
 *     more false positive. `lateNightConditionSql` below is the exact
 *     fragment embedded into the query — factored out so
 *     derive/amenities.test.ts can exercise it directly against a table of
 *     sample `opening_hours` strings (including the `off` case above)
 *     without needing the full pois/station_groups schema.
 *
 *     Tension worth surfacing, not hiding: `nightlife_count` (bars) already
 *     feeds `norm_quietness` inversely (derive/quietness.ts). A station
 *     with many late-closing bars/restaurants will therefore tend to score
 *     well on `norm_amenity_late_night` and *worse* on `norm_quietness` —
 *     the same underlying venues pulling two different axes in opposite
 *     directions. That's a deliberate product tradeoff (late-night food
 *     access and residential quiet genuinely compete), not a double-count:
 *     the two axes measure different things that happen to share a source.
 *
 * All three reuse the existing `SUM((p.category = 'X')::int)` idiom's
 * NULL behavior: with the `LEFT JOIN`, a station with no POI in range at
 * all has `p.category`/`p.opening_hours` both NULL, so the boolean (and
 * the late-night `AND`-chain) evaluates to NULL there too; `SUM` ignores
 * NULL input, which is exactly the "count nothing" a 0-POI station should
 * get — no different from every pre-existing count column here.
 */

import type { Pool } from "pg";

import { AMENITY_WEIGHTS, CATCHMENT_RADIUS_M } from "@tokyo/shared";

import { withTransaction } from "../lib/db.js";
import { assertCatchmentsDerived } from "./prerequisites.js";
import type { StepResult } from "./types.js";

/**
 * The late-night heuristic's boolean SQL fragment, parameterized only on
 * the `opening_hours` column reference so it can be reused verbatim
 * (byte-for-byte, not re-typed) both in the real query below and in
 * derive/amenities.test.ts's direct unit coverage of the heuristic. See
 * this module's doc comment above for what it does and doesn't match, and
 * why.
 */
export function lateNightConditionSql(openingHoursColumn: string): string {
  return `(
    ${openingHoursColumn} !~* '\\yoff\\y'
    AND (${openingHoursColumn} = '24/7' OR ${openingHoursColumn} ~ '-2[3-9]:[0-5][0-9]')
  )`;
}

export async function runAmenitiesStep(pool: Pool): Promise<StepResult> {
  const start = Date.now();
  await assertCatchmentsDerived(pool);

  const rowsWritten = await withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      `
      WITH counts AS (
        SELECT
          sg.station_group_id,
          COALESCE(SUM((p.category = 'supermarket')::int), 0) AS supermarket_count,
          COALESCE(SUM((p.category = 'grocery')::int), 0) AS grocery_count,
          COALESCE(SUM((p.category = 'convenience')::int), 0) AS convenience_count,
          COALESCE(SUM((p.category = 'restaurant')::int), 0) AS restaurant_count,
          COALESCE(SUM((p.category = 'cafe')::int), 0) AS cafe_count,
          COALESCE(SUM((p.category = 'bar')::int), 0) AS nightlife_count,
          COALESCE(SUM((p.category = 'health')::int), 0) AS health_count,
          COALESCE(SUM((
            p.category IN ('restaurant', 'cafe', 'bar')
            AND ${lateNightConditionSql("p.opening_hours")}
          )::int), 0) AS late_night_count,
          COUNT(DISTINCT p.cuisine) FILTER (WHERE p.category IN ('restaurant', 'cafe'))
            AS cuisine_variety_count
        FROM station_groups sg
        LEFT JOIN pois p ON ST_DWithin(p.point::geography, sg.point::geography, $1)
        GROUP BY sg.station_group_id
      )
      UPDATE neighborhood_metrics nm
      SET
        supermarket_count = c.supermarket_count,
        grocery_count = c.grocery_count,
        convenience_count = c.convenience_count,
        restaurant_count = c.restaurant_count,
        cafe_count = c.cafe_count,
        nightlife_count = c.nightlife_count,
        health_count = c.health_count,
        late_night_count = c.late_night_count,
        cuisine_variety_count = c.cuisine_variety_count,
        amenity_supermarket_equiv =
          c.supermarket_count * $2::double precision
          + c.grocery_count * $3::double precision
          + c.convenience_count * $4::double precision
      FROM counts c
      WHERE nm.station_group_id = c.station_group_id
      `,
      [
        CATCHMENT_RADIUS_M,
        AMENITY_WEIGHTS.supermarket,
        AMENITY_WEIGHTS.grocery,
        AMENITY_WEIGHTS.convenience,
      ],
    );

    return rowCount ?? 0;
  });

  return { name: "amenities", rowsWritten, durationMs: Date.now() - start };
}
