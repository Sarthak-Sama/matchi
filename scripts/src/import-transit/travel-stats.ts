import { MAX_EXPECTED_WAIT_MINUTES, MIN_EXPECTED_WAIT_MINUTES, PEAK_WINDOW } from "@tokyo/shared";

import type { GtfsTrip } from "./gtfs-static.js";
import { minutesOfDay } from "./gtfs-time.js";
import type { StopTimeRow } from "./gtfs-stop-times.js";

export function isPeakMinutesOfDay(rawMinutes: number): boolean {
  const m = minutesOfDay(rawMinutes);
  return m >= PEAK_WINDOW.startMinutes && m < PEAK_WINDOW.endMinutes;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("median: cannot compute the median of an empty array");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] as number;
  }
  const lo = sorted[mid - 1] as number;
  const hi = sorted[mid] as number;
  return (lo + hi) / 2;
}

const KEY_SEPARATOR = "\u0001";

export function directionKey(routeId: string, firstStopId: string): string {
  return `${routeId}${KEY_SEPARATOR}${firstStopId}`;
}

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

function pairMapKey(k: AdjacentPairKey): string {
  return `${k.routeId}${KEY_SEPARATOR}${k.firstStopId}${KEY_SEPARATOR}${k.fromStopId}${KEY_SEPARATOR}${k.toStopId}`;
}

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
