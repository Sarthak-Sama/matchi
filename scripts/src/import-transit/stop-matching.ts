import { haversineMeters, STATION_MERGE_RADIUS_M } from "@tokyo/shared";

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
      const distanceM = haversineMeters(group.lat, group.lon, candidate.lat, candidate.lon);
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
