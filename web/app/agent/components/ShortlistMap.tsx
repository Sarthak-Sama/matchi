"use client";

import { useEffect, useMemo, useState } from "react";

import type { NeighborhoodResult, StationsResponse } from "@tokyo/shared";

import { getJson } from "../../../lib/api";
import { ResultsMap } from "../../components/ResultsMap";
import { aboutYen } from "../lib/format";
import { areaName } from "../lib/evidence";
import type { Anchor, ShortlistItem } from "../lib/types";

/** The batch endpoint's limit. */
const MAX_AREAS = 10;

interface Destination {
  lat: number;
  lon: number;
  label: string;
}

/** An anchor is either a point or a station id; a station's coordinates come from the stations search. */
function useAnchorDestination(anchor: Anchor | undefined): Destination | null {
  const [destination, setDestination] = useState<Destination | null>(null);
  const point = anchor?.point;
  const stationId = anchor?.stationId;
  const label = anchor?.label ?? "";
  const pointLat = point?.lat;
  const pointLon = point?.lon;
  useEffect(() => {
    let active = true;
    setDestination(null);
    if (pointLat !== undefined && pointLon !== undefined) {
      setDestination({ lat: pointLat, lon: pointLon, label });
      return;
    }
    if (!stationId || !label) return;
    getJson<StationsResponse>(`/v1/stations?query=${encodeURIComponent(label)}&limit=10`)
      .then(({ results }) => {
        const station = results.find((s) => s.stationGroupId === stationId);
        if (active && station) setDestination({ lat: station.lat, lon: station.lon, label });
      })
      .catch(() => undefined); // The map is still useful without the anchor marker.
    return () => {
      active = false;
    };
  }, [pointLat, pointLon, stationId, label]);
  return destination;
}

function useAreaPolygons(ids: readonly string[]): Map<string, unknown> {
  const [polygons, setPolygons] = useState(new Map<string, unknown>());
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let active = true;
    getJson<{ results: { localityId: string; polygon: unknown }[] }>(
      `/v1/localities?ids=${encodeURIComponent(key)}`,
    )
      .then(({ results }) => {
        if (active) setPolygons(new Map(results.map((r) => [r.localityId, r.polygon])));
      })
      .catch(() => undefined); // Pins still show at the area centres without outlines.
    return () => {
      active = false;
    };
  }, [key]);
  return polygons;
}

/** ResultsMap reads only these fields; the rest of NeighborhoodResult belongs to the /find page. */
function toMapResult(item: ShortlistItem, rank: number, polygon: unknown): NeighborhoodResult {
  return {
    rank,
    localityId: item.localityId,
    nameEn: item.nameEn ?? item.nameJa,
    nameJa: item.nameJa,
    wardNameEn: item.wardNameEn ?? "",
    centroid: { lat: item.lat, lon: item.lon },
    polygon: polygon ?? null,
    nearbyStations: [],
    overallScore: 0,
  } as unknown as NeighborhoodResult;
}

export function ShortlistMap({
  shortlist,
  anchor,
  onSelect,
}: {
  shortlist: readonly ShortlistItem[];
  anchor: Anchor | undefined;
  onSelect: (localityId: string) => void;
}) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const items = useMemo(() => shortlist.slice(0, MAX_AREAS), [shortlist]);
  const polygons = useAreaPolygons(useMemo(() => items.map((i) => i.localityId), [items]));
  const destination = useAnchorDestination(anchor);
  const results = useMemo(
    () => items.map((item, i) => toMapResult(item, i + 1, polygons.get(item.localityId))),
    [items, polygons],
  );
  const describe = (result: NeighborhoodResult) => {
    const item = items.find((i) => i.localityId === result.localityId);
    if (!item) return areaName(result);
    const commute =
      item.commuteMinutes === null ? "no commute set" : `${Math.round(item.commuteMinutes)} min`;
    return `${commute} · ${aboutYen(item.rentYen)}/mo`;
  };
  return (
    <div className="mt-4 h-72 border border-line">
      <ResultsMap
        results={results}
        destination={destination}
        highlightedId={highlightedId}
        onHighlight={setHighlightedId}
        onSelect={(result) => onSelect(result.localityId)}
        expanded
        detail={describe}
      />
    </div>
  );
}
