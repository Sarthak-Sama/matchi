import { STATION_MERGE_RADIUS_M } from "@tokyo/shared";

import { slug } from "./geojson.js";
import type { ParsedStation } from "./stations.js";

export interface MergedStationGroup {
  readonly stationGroupId: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly lon: number;
  readonly lat: number;
  readonly members: readonly ParsedStation[];
}

export function normalizeStationName(name: string): string {
  return name
    .trim()
    .replace(/駅$/u, "")
    .replace(/\s*station$/iu, "")
    .trim()
    .toLowerCase();
}

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(a: ParsedStation, b: ParsedStation): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  constructor(indices: readonly number[]) {
    for (const i of indices) this.parent.set(i, i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent.get(root) !== root) {
      const next = this.parent.get(root);
      if (next === undefined) throw new Error(`UnionFind: unknown index ${root}`);
      root = next;
    }

    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      if (next === undefined) throw new Error(`UnionFind: unknown index ${cur}`);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function mergeStations(stations: readonly ParsedStation[]): MergedStationGroup[] {
  const byName = new Map<string, number[]>();
  stations.forEach((station, index) => {
    const key = normalizeStationName(station.nameJa);
    const indices = byName.get(key) ?? [];
    indices.push(index);
    byName.set(key, indices);
  });

  const groups: MergedStationGroup[] = [];

  for (const indices of byName.values()) {
    const uf = new UnionFind(indices);
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const ia = indices[a];
        const ib = indices[b];
        if (ia === undefined || ib === undefined) continue;
        const sa = stations[ia];
        const sb = stations[ib];
        if (sa === undefined || sb === undefined) continue;
        if (haversineMeters(sa, sb) <= STATION_MERGE_RADIUS_M) {
          uf.union(ia, ib);
        }
      }
    }

    const clusters = new Map<number, number[]>();
    for (const i of indices) {
      const root = uf.find(i);
      const cluster = clusters.get(root) ?? [];
      cluster.push(i);
      clusters.set(root, cluster);
    }

    for (const clusterIndices of clusters.values()) {
      const members = clusterIndices
        .map((i) => stations[i])
        .filter((s): s is ParsedStation => s !== undefined)
        .sort((x, y) => x.sourceId.localeCompare(y.sourceId));
      const representative = members[0];
      if (representative === undefined) continue;

      const lon = members.reduce((sum, m) => sum + m.lon, 0) / members.length;
      const lat = members.reduce((sum, m) => sum + m.lat, 0) / members.length;

      const baseSlug = slug(representative.nameEn);
      const stationGroupId = `mlit-${baseSlug}-${lat.toFixed(3)}-${lon.toFixed(3)}`;

      groups.push({
        stationGroupId,
        nameJa: representative.nameJa,
        nameEn: representative.nameEn,
        lon,
        lat,
        members,
      });
    }
  }

  groups.sort((a, b) => a.stationGroupId.localeCompare(b.stationGroupId));
  return groups;
}
