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

export interface ExistingGtfsRef {
  readonly sourceId: string;
  readonly stationGroupId: string;
}

export interface NewGtfsRef {
  readonly sourceId: string;
  readonly stationGroupId: string;
}

export interface StopMatchResult {
  readonly matchedStopToGroup: ReadonlyMap<string, string>;

  readonly newRefs: readonly NewGtfsRef[];

  readonly unmatchedRefKeys: readonly string[];

  readonly totalRefKeys: number;
}

const EARTH_RADIUS_M = 6_371_000;

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

  readonly stopIds: string[];
}

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
      const candidateNames = [
        normalizeStationName(candidate.nameJa),
        normalizeStationName(candidate.nameEn),
      ];
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
