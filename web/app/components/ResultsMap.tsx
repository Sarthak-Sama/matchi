"use client";

import { useMemo } from "react";

import type { NeighborhoodResult } from "@tokyo/shared";

import { formatYenCompact, wardDisplayName } from "../../lib/format";

/**
 * The spatial canvas: real locality polygons (GeoJSON from the API)
 * drawn as a quiet editorial map — sage fills, hairline boundaries, ink
 * pins numbered by rank, a vermilion survey nail for the destination.
 *
 * Pins are HTML buttons overlaid on the SVG (not SVG <g> elements) so
 * focus rings, touch targets, and screen-reader labels are native. The
 * SVG geometry itself is aria-hidden; everything the map communicates is
 * also in the ranked list, which is the non-map route to the same
 * information.
 */

const VIEW_W = 1000;
const VIEW_H = 720;

/**
 * How many pins the compact mobile preview draws. Twenty numbered discs
 * inside a 300px-wide frame overlap into an unreadable clump; the preview
 * shows the strongest matches and says so, and expanding draws them all.
 */
const PREVIEW_PIN_LIMIT = 8;

/** Pin stacking order — see the `zIndex` note on the rank pins below. */
const MAX_PIN_Z = 100;
const DESTINATION_Z = 120;
const HIGHLIGHT_Z = 140;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Projection {
  readonly project: (lat: number, lon: number) => Point;
}

type Ring = readonly (readonly number[])[];
type PolygonCoords = readonly Ring[];
type MultiPolygonCoords = readonly PolygonCoords[];

interface MultiPolygon {
  readonly type: "MultiPolygon";
  readonly coordinates: MultiPolygonCoords;
}

function asMultiPolygon(value: unknown): MultiPolygon | null {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "MultiPolygon" &&
    Array.isArray((value as { coordinates?: unknown }).coordinates)
  ) {
    return value as MultiPolygon;
  }
  return null;
}

function buildProjection(results: readonly NeighborhoodResult[], destination: Point | null): Projection {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const extend = (lat: number, lon: number) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };

  for (const result of results) {
    extend(result.centroid.lat, result.centroid.lon);
    const polygon = asMultiPolygon(result.polygon);
    if (polygon) {
      for (const poly of polygon.coordinates) {
        for (const ring of poly) {
          for (const point of ring) {
            const lon = point[0];
            const lat = point[1];
            if (lon !== undefined && lat !== undefined) extend(lat, lon);
          }
        }
      }
    }
  }
  if (destination) extend(destination.y, destination.x);
  if (!Number.isFinite(minLon)) {
    // No geometry at all — degenerate; project everything to center.
    return { project: () => ({ x: VIEW_W / 2, y: VIEW_H / 2 }) };
  }

  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  // Pad the window so edge polygons don't kiss the frame.
  const spanLon = Math.max((maxLon - minLon) * lonScale, 0.001);
  const spanLat = Math.max(maxLat - minLat, 0.001);
  const padX = spanLon * 0.09;
  const padY = spanLat * 0.09;
  const scale = Math.min(VIEW_W / (spanLon + padX * 2), VIEW_H / (spanLat + padY * 2));
  const offsetX = (VIEW_W - spanLon * scale) / 2;
  const offsetY = (VIEW_H - spanLat * scale) / 2;

  return {
    project: (lat, lon) => ({
      x: offsetX + ((lon - minLon) * lonScale) * scale,
      y: offsetY + (maxLat - lat) * scale,
    }),
  };
}

function polygonPath(polygon: MultiPolygon, projection: Projection): string {
  const parts: string[] = [];
  for (const poly of polygon.coordinates) {
    for (const ring of poly) {
      ring.forEach((point, index) => {
        const lon = point[0];
        const lat = point[1];
        if (lon === undefined || lat === undefined) return;
        const { x, y } = projection.project(lat, lon);
        parts.push(`${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
      });
      parts.push("Z");
    }
  }
  return parts.join(" ");
}

interface ResultsMapProps {
  readonly results: readonly NeighborhoodResult[];
  readonly destination: { readonly lat: number; readonly lon: number; readonly label: string } | null;
  readonly highlightedId: string | null;
  readonly onHighlight: (localityId: string | null) => void;
  readonly onSelect: (result: NeighborhoodResult) => void;
  readonly expanded: boolean;
}

export function ResultsMap({
  results,
  destination,
  highlightedId,
  onHighlight,
  onSelect,
  expanded,
}: ResultsMapProps) {
  const destinationPoint = useMemo(
    () => (destination ? { x: destination.lon, y: destination.lat } : null),
    [destination],
  );

  const projection = useMemo(
    () => buildProjection(results, destinationPoint),
    [results, destinationPoint],
  );

  const shapes = useMemo(
    () =>
      results.map((result) => {
        const polygon = asMultiPolygon(result.polygon);
        return {
          result,
          d: polygon ? polygonPath(polygon, projection) : null,
          pin: projection.project(result.centroid.lat, result.centroid.lon),
        };
      }),
    [results, projection],
  );

  const destinationXY = destination
    ? projection.project(destination.lat, destination.lon)
    : null;

  const pinned = expanded ? shapes : shapes.slice(0, PREVIEW_PIN_LIMIT);
  const hiddenPinCount = shapes.length - pinned.length;

  return (
    // The SVG letterboxes when the frame is wider than the projection's
    // aspect; painting the frame itself keeps that as one ground rather
    // than two pale bands beside a sage rectangle.
    <figure className="relative h-full w-full bg-sage">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        aria-hidden="true"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect width={VIEW_W} height={VIEW_H} className="fill-sage" />
        {/* SVG has no z-index: paint order is document order, so the
            highlighted outline is drawn last or its neighbours cover it. */}
        {[...shapes]
          .sort((a, b) =>
            Number(a.result.localityId === highlightedId) -
            Number(b.result.localityId === highlightedId),
          )
          .map(({ result, d }) => {
          if (!d) return null;
          const isHighlighted = result.localityId === highlightedId;
          const isTop = result.rank === 1;
          return (
            <path
              key={result.localityId}
              d={d}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
              className={`transition-colors duration-200 motion-reduce:transition-none ${
                isHighlighted
                  ? "fill-vermilion/25 stroke-vermilion"
                  : isTop
                    ? "fill-sage-deep/70 stroke-line-strong"
                    : "fill-paper/60 stroke-line-strong"
              }`}
              strokeWidth={isHighlighted ? 1.6 : 1}
            />
          );
        })}
      </svg>

      {/* Destination — the vermilion survey nail. Stacked above every
          rank pin except the highlighted one: it is the anchor the whole
          shortlist is measured from, so it must never be buried by a pin
          that happens to project on top of it. */}
      {destinationXY && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${(destinationXY.x / VIEW_W) * 100}%`,
            top: `${(destinationXY.y / VIEW_H) * 100}%`,
            zIndex: DESTINATION_Z,
          }}
        >
          <span className="block size-3.5 rotate-45 bg-vermilion ring-2 ring-paper" />
          <span
            className={`absolute top-3.5 left-1/2 max-w-40 -translate-x-1/2 truncate bg-ink px-1.5 py-0.5 text-center text-[10px] font-medium whitespace-nowrap text-paper ${
              expanded ? "block" : "hidden sm:block"
            }`}
          >
            {destination?.label}
          </span>
        </div>
      )}

      {/* Rank pins — real buttons, keyboard accessible. */}
      {pinned.map(({ result, pin }) => {
        const isHighlighted = result.localityId === highlightedId;
        const isTop = result.rank === 1;
        return (
          <button
            key={result.localityId}
            type="button"
            onMouseEnter={() => onHighlight(result.localityId)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(result.localityId)}
            onBlur={() => onHighlight(null)}
            onClick={() => onSelect(result)}
            aria-label={`Rank ${result.rank}: ${result.nameJa}, ${wardDisplayName(result.wardNameEn)} — ${Math.round(result.commute.totalMinutes)} minute commute, ${formatYenCompact(result.rent.lowYen)} to ${formatYenCompact(result.rent.highYen)} modeled rent. Open the neighborhood entry.`}
            className={`absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-mono text-[12px] font-medium text-white transition-transform duration-150 motion-reduce:transition-none ${
              isTop ? "bg-vermilion" : "bg-moss"
            } ${isHighlighted ? "scale-125 ring-2 ring-ink" : "ring-2 ring-paper"}`}
            style={{
              left: `${(pin.x / VIEW_W) * 100}%`,
              top: `${(pin.y / VIEW_H) * 100}%`,
              // Central Tokyo puts twenty candidates inside a couple of
              // kilometres, so pins genuinely overlap. Rather than nudge
              // them off their real positions — which would make the map
              // lie — stack them: better ranks sit above worse ones, and
              // whatever the reader is pointing at comes to the very top.
              zIndex: isHighlighted ? HIGHLIGHT_Z : Math.max(1, MAX_PIN_Z - result.rank),
            }}
          >
            {result.rank}
          </button>
        );
      })}

      {hiddenPinCount > 0 && (
        <p className="absolute inset-x-0 bottom-0 z-30 bg-ink/85 px-3 py-1.5 text-center text-[11px] text-paper">
          Showing the top {pinned.length} of {results.length} — expand for all
        </p>
      )}

      <figcaption className="sr-only">
        Map of {results.length} candidate neighborhoods
        {destination ? ` around ${destination.label}` : ""}, drawn from locality boundaries.
        Neighborhoods are numbered by rank
        {hiddenPinCount > 0
          ? `; this compact view marks the top ${pinned.length}`
          : ""}
        . The same information appears in the ranked list.
      </figcaption>
    </figure>
  );
}
