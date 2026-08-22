/**
 * Maps GTFS stops to existing `station_groups`, per the task brief's
 * two-tier rule: an existing `station_source_refs` row wins outright;
 * otherwise fall back to normalized-name + `STATION_MERGE_RADIUS_M`
 * proximity matching. Pure — takes plain arrays (the caller fetches
 * `station_groups`/`station_source_refs` from the database itself before
 * calling this), so it's directly unit-testable with no `DATABASE_URL`.
 *
 * A platform-level GTFS stop (one with `parent_station` set) is matched
 * under its PARENT's identity, not its own: the parent's own `stops.txt`
 * row (name, lat/lon) is used for name+proximity matching, and the ref
 * key recorded/looked-up in `station_source_refs.source_id` is the
 * parent's `stop_id` — so every platform under one parent shares one ref
 * row and one match outcome, matching the brief's "stop_id/parent_station"
 * wording. A child stop whose `parent_station` doesn't resolve to any row
 * in `stops.txt` falls back to its own fields, with a warning (the
 * caller's job — this module returns enough detail to build one).
 */

import { STATION_MERGE_RADIUS_M } from "@tokyo/shared";

import { normalizeStationName } from "../import-mlit/station-merge.js";
import type { GtfsStop } from "./gtfs-static.js";

export interface CandidateStationGroup {
  readonly stationGroupId: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly lon: number;
  readonly lat: number;
}

/** One existing `station_source_refs` row for `source = 'gtfs'`. */
export interface ExistingGtfsRef {
  readonly sourceId: string;
  readonly stationGroupId: string;
}

export interface NewGtfsRef {
  readonly sourceId: string;
  readonly stationGroupId: string;
}

export interface StopMatchResult {
  /** GTFS `stop_id` -> matched `station_group_id`, for every matched stop (including unchanged platform children). */
  readonly matchedStopToGroup: ReadonlyMap<string, string>;
  /** New `station_source_refs` rows to insert (`source = 'gtfs'`), one per newly-matched ref key. */
  readonly newRefs: readonly NewGtfsRef[];
  /** Ref keys (parent stop_id, or the stop's own id when it has no parent) that matched nothing. */
  readonly unmatchedRefKeys: readonly string[];
  /** Every distinct ref key considered, for the caller's 20%-unmatched check. */
  readonly totalRefKeys: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Mirrors `import-mlit/station-merge.ts`'s `haversineMeters` (kept local — this module has no `ParsedStation` dependency). */
function haversineMeters(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

interface RefKeyInfo {
  readonly refKey: string;
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Every GTFS stop_id that shares this ref key (the parent itself, plus any platform children). */
  readonly stopIds: string[];
}

/** Groups every stop by its effective ref key (parent's stop_id when set and resolvable, else its own). */
function groupByRefKey(stops: readonly GtfsStop[]): Map<string, RefKeyInfo> {
  const byStopId = new Map(stops.map((s) => [s.stopId, s]));
  const groups = new Map<string, RefKeyInfo>();

  for (const stop of stops) {
    const parent = stop.parentStation !== undefined ? byStopId.get(stop.parentStation) : undefined;
    const refKey = stop.parentStation ?? stop.stopId;
    const source = parent ?? stop;

    const existing = groups.get(refKey);
    if (existing) {
      existing.stopIds.push(stop.stopId);
    } else {
      groups.set(refKey, {
        refKey,
        name: source.name,
        lon: source.lon,
        lat: source.lat,
        stopIds: [stop.stopId],
      });
    }
  }

  return groups;
}

/**
 * Matches every GTFS stop in `stops` to a `station_group_id`, preferring
 * an existing ref (`existingRefs`) and falling back to normalized-name +
 * `STATION_MERGE_RADIUS_M` proximity against `candidates`. When more than
 * one candidate shares the normalized name within radius, the closest one
 * wins.
 */
export function matchStops(
  stops: readonly GtfsStop[],
  existingRefs: readonly ExistingGtfsRef[],
  candidates: readonly CandidateStationGroup[],
): StopMatchResult {
  const refsBySourceId = new Map(existingRefs.map((r) => [r.sourceId, r.stationGroupId]));
  const groups = groupByRefKey(stops);

  const matchedStopToGroup = new Map<string, string>();
  const newRefs: NewGtfsRef[] = [];
  const unmatchedRefKeys: string[] = [];

  for (const group of groups.values()) {
    const viaRef = refsBySourceId.get(group.refKey);
    if (viaRef !== undefined) {
      for (const stopId of group.stopIds) matchedStopToGroup.set(stopId, viaRef);
      continue;
    }

    const normalizedName = normalizeStationName(group.name);
    let best: { stationGroupId: string; distanceM: number } | undefined;
    for (const candidate of candidates) {
      const candidateNames = [normalizeStationName(candidate.nameJa), normalizeStationName(candidate.nameEn)];
      if (!candidateNames.includes(normalizedName)) continue;
      const distanceM = haversineMeters(group.lon, group.lat, candidate.lon, candidate.lat);
      if (distanceM > STATION_MERGE_RADIUS_M) continue;
      if (!best || distanceM < best.distanceM) {
        best = { stationGroupId: candidate.stationGroupId, distanceM };
      }
    }

    if (best) {
      for (const stopId of group.stopIds) matchedStopToGroup.set(stopId, best.stationGroupId);
      newRefs.push({ sourceId: group.refKey, stationGroupId: best.stationGroupId });
    } else {
      unmatchedRefKeys.push(group.refKey);
    }
  }

  return {
    matchedStopToGroup,
    newRefs,
    unmatchedRefKeys,
    totalRefKeys: groups.size,
  };
}
