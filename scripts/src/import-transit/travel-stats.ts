/**
 * Pure statistics derived from GTFS trips + stop_times: median adjacent-
 * stop travel times (split peak/off-peak) and per-direction headway ->
 * expected wait. No I/O, no database — everything here takes plain
 * in-memory arrays/maps, so it's directly unit-testable against the
 * committed fixture with no `DATABASE_URL`.
 *
 * A route's "direction" is identified here by `(routeId, firstStopId)` —
 * the `stopId` of the stop with the SMALLEST `stop_sequence` on a given
 * trip — rather than GTFS's own optional `direction_id` column. Two
 * physically opposite-direction trips of the same route depart from two
 * different physical stops, so grouping by first-stop-seen is exactly
 * equivalent to grouping by real direction, and unlike `direction_id`
 * (which the task brief itself flags as sometimes inconsistent/absent) it
 * requires no assumption about how faithfully a given GTFS feed populates
 * that column. This also means one `(routeId, firstStopId)` key can be
 * used as BOTH the join key for headway->expected-wait AND for tagging
 * which direction's ride edges that wait applies to.
 */

import { MAX_EXPECTED_WAIT_MINUTES, MIN_EXPECTED_WAIT_MINUTES, PEAK_WINDOW } from "@tokyo/shared";

import type { GtfsTrip } from "./gtfs-static.js";
import { minutesOfDay } from "./gtfs-time.js";
import type { StopTimeRow } from "./gtfs-stop-times.js";

export function isPeakMinutesOfDay(rawMinutes: number): boolean {
  const m = minutesOfDay(rawMinutes);
  return m >= PEAK_WINDOW.startMinutes && m < PEAK_WINDOW.endMinutes;
}

/** Median of `values` (odd length: the middle; even: average of the two middles). Throws on empty input. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("median: cannot compute the median of an empty array");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    // Non-empty by the guard above, and `mid` is a valid index into `sorted`.
    return sorted[mid] as number;
  }
  const lo = sorted[mid - 1] as number;
  const hi = sorted[mid] as number;
  return (lo + hi) / 2;
}

/**
 * A control character that cannot appear in a real GTFS/`rail_edges` id,
 * used to join the map-key components below so naive concatenation can
 * never collide between two different id tuples (e.g. routeId "AB" +
 * firstStopId "C" vs routeId "A" + firstStopId "BC" would otherwise both
 * produce "ABC"). Written as the literal `\u0001` escape (never a raw
 * embedded control byte, which is invisible in a diff/editor and
 * indistinguishable from no separator at all) — mirrors
 * `api/src/domain/transit/dijkstra.ts`'s `KEY_SEPARATOR` constant
 * exactly, including this same reasoning in its own doc comment.
 */
const KEY_SEPARATOR = "\u0001";

/** Joins a route id and a first-stop id into one map key (see `KEY_SEPARATOR`). */
export function directionKey(routeId: string, firstStopId: string): string {
  return `${routeId}${KEY_SEPARATOR}${firstStopId}`;
}

// ---------------------------------------------------------------------------
// Adjacent-stop travel times
// ---------------------------------------------------------------------------

export interface AdjacentPairKey {
  readonly routeId: string;
  readonly firstStopId: string;
  readonly fromStopId: string;
  readonly toStopId: string;
}

export interface AdjacentPairStat extends AdjacentPairKey {
  readonly peakMinutes: number | undefined;
  readonly offpeakMinutes: number | undefined;
  readonly peakSampleCount: number;
  readonly offpeakSampleCount: number;
}

/** Joins the 4 `AdjacentPairKey` components into one map key (see `KEY_SEPARATOR`). */
function pairMapKey(k: AdjacentPairKey): string {
  return `${k.routeId}${KEY_SEPARATOR}${k.firstStopId}${KEY_SEPARATOR}${k.fromStopId}${KEY_SEPARATOR}${k.toStopId}`;
}

/**
 * For every trip in `trips` that has stop_times rows in `stopTimesByTrip`,
 * walks its ordered stops and records the observed travel time
 * (`arrival(i+1) - departure(i)`, in minutes) for every adjacent pair,
 * bucketed into peak/off-peak by the FROM stop's departure time. Returns
 * one `AdjacentPairStat` per distinct `(routeId, firstStopId, from, to)`
 * combination, with the median of whatever samples landed in each period
 * (`undefined` when that period had zero samples for this pair).
 */
export function computeAdjacentPairStats(
  trips: readonly GtfsTrip[],
  stopTimesByTrip: ReadonlyMap<string, readonly StopTimeRow[]>,
): AdjacentPairStat[] {
  const peakSamples = new Map<string, number[]>();
  const offpeakSamples = new Map<string, number[]>();
  const keys = new Map<string, AdjacentPairKey>();

  for (const trip of trips) {
    const rows = stopTimesByTrip.get(trip.tripId);
    if (!rows || rows.length < 2) continue;
    const firstStopId = rows[0]?.stopId;
    if (firstStopId === undefined) continue;

    for (let i = 0; i < rows.length - 1; i++) {
      const from = rows[i];
      const to = rows[i + 1];
      if (!from || !to) continue;
      const travelMinutes = to.arrivalMinutes - from.departureMinutes;
      if (travelMinutes < 0) {
        throw new Error(
          `computeAdjacentPairStats: trip "${trip.tripId}" has a negative travel time between ` +
            `stop_sequence ${String(from.stopSequence)} and ${String(to.stopSequence)} — ` +
            `stop_times.txt rows are not chronologically ordered for this trip.`,
        );
      }

      const key: AdjacentPairKey = {
        routeId: trip.routeId,
        firstStopId,
        fromStopId: from.stopId,
        toStopId: to.stopId,
      };
      const mapKey = pairMapKey(key);
      keys.set(mapKey, key);

      const bucket = isPeakMinutesOfDay(from.departureMinutes) ? peakSamples : offpeakSamples;
      const list = bucket.get(mapKey);
      if (list) {
        list.push(travelMinutes);
      } else {
        bucket.set(mapKey, [travelMinutes]);
      }
    }
  }

  return [...keys.entries()].map(([mapKey, key]) => {
    const peak = peakSamples.get(mapKey);
    const offpeak = offpeakSamples.get(mapKey);
    return {
      ...key,
      peakMinutes: peak ? median(peak) : undefined,
      offpeakMinutes: offpeak ? median(offpeak) : undefined,
      peakSampleCount: peak?.length ?? 0,
      offpeakSampleCount: offpeak?.length ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Headway -> expected wait
// ---------------------------------------------------------------------------

/** Halves `headwayMinutes` for expected wait, clamped to `[MIN_EXPECTED_WAIT_MINUTES, MAX_EXPECTED_WAIT_MINUTES]`. */
export function expectedWaitFromHeadway(headwayMinutes: number): number {
  const half = headwayMinutes / 2;
  return Math.min(MAX_EXPECTED_WAIT_MINUTES, Math.max(MIN_EXPECTED_WAIT_MINUTES, half));
}

export interface HeadwayStat {
  readonly routeId: string;
  readonly firstStopId: string;
  readonly peakWaitMinutes: number | undefined;
  readonly offpeakWaitMinutes: number | undefined;
}

/**
 * For each `(routeId, firstStopId)` direction, gathers every trip's
 * departure time at that first stop, splits into peak/off-peak buckets
 * (by that same departure time's time-of-day), sorts each bucket
 * chronologically (raw minutes, NOT wrapped to 0-1439, so a post-midnight
 * rollover departure still sorts after a same-service-day one), and
 * averages the gaps between consecutive departures for that bucket's
 * headway. A bucket with fewer than 2 departures has no defined headway
 * (`undefined` — the caller decides the fallback; see `import-transit.ts`).
 */
export function computeHeadways(
  trips: readonly GtfsTrip[],
  stopTimesByTrip: ReadonlyMap<string, readonly StopTimeRow[]>,
): HeadwayStat[] {
  const peakDepartures = new Map<string, number[]>();
  const offpeakDepartures = new Map<string, number[]>();
  const keys = new Map<string, { routeId: string; firstStopId: string }>();

  for (const trip of trips) {
    const rows = stopTimesByTrip.get(trip.tripId);
    const first = rows?.[0];
    if (!first) continue;

    const key = { routeId: trip.routeId, firstStopId: first.stopId };
    const mapKey = directionKey(key.routeId, key.firstStopId);
    keys.set(mapKey, key);

    const bucket = isPeakMinutesOfDay(first.departureMinutes) ? peakDepartures : offpeakDepartures;
    const list = bucket.get(mapKey);
    if (list) {
      list.push(first.departureMinutes);
    } else {
      bucket.set(mapKey, [first.departureMinutes]);
    }
  }

  function averageHeadway(departures: number[] | undefined): number | undefined {
    if (!departures || departures.length < 2) return undefined;
    const sorted = [...departures].sort((a, b) => a - b);
    let totalGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      totalGap += (sorted[i] as number) - (sorted[i - 1] as number);
    }
    return totalGap / (sorted.length - 1);
  }

  return [...keys.entries()].map(([mapKey, key]) => {
    const peakHeadway = averageHeadway(peakDepartures.get(mapKey));
    const offpeakHeadway = averageHeadway(offpeakDepartures.get(mapKey));
    return {
      ...key,
      peakWaitMinutes: peakHeadway !== undefined ? expectedWaitFromHeadway(peakHeadway) : undefined,
      offpeakWaitMinutes:
        offpeakHeadway !== undefined ? expectedWaitFromHeadway(offpeakHeadway) : undefined,
    };
  });
}
