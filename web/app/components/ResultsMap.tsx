"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

import type { NeighborhoodResult } from "@tokyo/shared";

import { formatYenCompact, localityDisplayName, localitySecondaryLabel } from "../../lib/format";

const VIEW_W = 1000;
const VIEW_H = 720;

const PREVIEW_PIN_LIMIT = 8;
const MIN_PIN_DISTANCE = 46;

const MAX_PIN_Z = 100;
const DESTINATION_Z = 120;
const HIGHLIGHT_Z = 140;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PinPlacement {
  readonly anchor: Point;
  readonly display: Point;
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

function buildProjection(
  results: readonly NeighborhoodResult[],
  destination: Point | null,
): Projection {
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
    return { project: () => ({ x: VIEW_W / 2, y: VIEW_H / 2 }) };
  }

  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);

  const spanLon = Math.max((maxLon - minLon) * lonScale, 0.001);
  const spanLat = Math.max(maxLat - minLat, 0.001);
  const padX = spanLon * 0.09;
  const padY = spanLat * 0.09;
  const scale = Math.min(VIEW_W / (spanLon + padX * 2), VIEW_H / (spanLat + padY * 2));
  const offsetX = (VIEW_W - spanLon * scale) / 2;
  const offsetY = (VIEW_H - spanLat * scale) / 2;

  return {
    project: (lat, lon) => ({
      x: offsetX + (lon - minLon) * lonScale * scale,
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

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Locality centroids often sit almost on top of one another. Keep the geographic
 * anchor honest, but gently fan colliding controls out so every result remains
 * reachable. A hairline leader marks any displaced pin.
 */
function placePins(points: readonly Point[]): PinPlacement[] {
  const placed: Point[] = [];

  return points.map((anchor, index) => {
    const candidates: Point[] = [anchor];

    for (let ring = 1; ring <= 4; ring += 1) {
      const radius = ring * MIN_PIN_DISTANCE * 0.72;
      const steps = 8 + ring * 4;
      for (let step = 0; step < steps; step += 1) {
        const angle = (Math.PI * 2 * step) / steps + index * 0.71;
        candidates.push({
          x: Math.min(VIEW_W - 28, Math.max(28, anchor.x + Math.cos(angle) * radius)),
          y: Math.min(VIEW_H - 28, Math.max(28, anchor.y + Math.sin(angle) * radius)),
        });
      }
    }

    const display =
      candidates.find((candidate) =>
        placed.every((other) => distance(candidate, other) >= MIN_PIN_DISTANCE),
      ) ?? anchor;
    placed.push(display);
    return { anchor, display };
  });
}

interface ResultsMapProps {
  readonly results: readonly NeighborhoodResult[];
  readonly destination: {
    readonly lat: number;
    readonly lon: number;
    readonly label: string;
  } | null;
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
  const reducedMotion = useReducedMotion();
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

  const placements = useMemo(() => placePins(shapes.map(({ pin }) => pin)), [shapes]);

  const destinationXY = destination ? projection.project(destination.lat, destination.lon) : null;

  const pinned = (expanded ? shapes : shapes.slice(0, PREVIEW_PIN_LIMIT)).map((shape, index) => ({
    ...shape,
    placement: placements[index] ?? { anchor: shape.pin, display: shape.pin },
  }));
  const hiddenPinCount = shapes.length - pinned.length;
  const highlightedResult = results.find((result) => result.localityId === highlightedId) ?? null;

  return (
    <figure className="relative isolate h-full w-full overflow-hidden bg-sage">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(251,248,241,0.72),transparent_34%),radial-gradient(circle_at_82%_76%,rgba(195,204,189,0.42),transparent_38%)]"
      />
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        aria-hidden="true"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect width={VIEW_W} height={VIEW_H} className="fill-transparent" />

        {[...shapes]
          .sort(
            (a, b) =>
              Number(a.result.localityId === highlightedId) -
              Number(b.result.localityId === highlightedId),
          )
          .map(({ result, d }) => {
            if (!d) return null;
            const isHighlighted = result.localityId === highlightedId;
            const isTop = result.rank === 1;
            return (
              <motion.path
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
                initial={reducedMotion ? false : { opacity: 0, pathLength: 0 }}
                animate={{ opacity: 1, pathLength: 1 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.55,
                  delay: reducedMotion ? 0 : Math.min(result.rank - 1, 12) * 0.035,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
              />
            );
          })}
      </svg>

      <div className="pointer-events-none absolute top-3 left-3 z-30 border-l-2 border-vermilion bg-paper/95 px-3 py-2 shadow-[0_2px_12px_rgba(40,36,31,0.08)] sm:top-4 sm:left-4">
        <p className="label-utility text-[9px] text-vermilion-deep">Candidate map</p>
        <p className="mt-0.5 font-serif text-[15px] leading-none tracking-editorial text-ink">
          {results.length} places, ranked
        </p>
      </div>

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
          {!reducedMotion && (
            <motion.span
              className="absolute inset-0 block bg-vermilion"
              initial={{ opacity: 0.45, scale: 1, rotate: 45 }}
              animate={{ opacity: 0, scale: 3, rotate: 45 }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                repeatDelay: 2.8,
                ease: "easeOut",
              }}
            />
          )}
          <span className="block size-4 rotate-45 border border-paper bg-vermilion shadow-[0_2px_7px_rgba(40,36,31,0.3)] ring-1 ring-vermilion-deep" />
          <span
            className={`absolute top-4 left-1/2 max-w-48 -translate-x-1/2 truncate bg-ink px-2 py-1 text-center text-[10px] font-medium whitespace-nowrap text-paper shadow-sm ${
              expanded ? "block" : "hidden sm:block"
            }`}
          >
            {destination?.label}
          </span>
        </div>
      )}

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {pinned.map(({ result, placement }) =>
          distance(placement.anchor, placement.display) > 4 ? (
            <line
              key={result.localityId}
              x1={placement.anchor.x}
              y1={placement.anchor.y}
              x2={placement.display.x}
              y2={placement.display.y}
              vectorEffect="non-scaling-stroke"
              className="stroke-ink/35"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          ) : null,
        )}
      </svg>

      {pinned.map(({ result, placement }) => {
        const isHighlighted = result.localityId === highlightedId;
        const isTop = result.rank === 1;
        const pin = placement.display;
        const displayName = localityDisplayName(result.nameEn, result.nameJa);
        const tooltipOnLeft = pin.x > VIEW_W * 0.7;
        const tooltipBelow = pin.y < VIEW_H * 0.28;
        return (
          <motion.button
            key={result.localityId}
            type="button"
            onMouseEnter={() => onHighlight(result.localityId)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(result.localityId)}
            onBlur={() => onHighlight(null)}
            onClick={() => onSelect(result)}
            aria-label={`Rank ${result.rank}: ${localityDisplayName(result.nameEn, result.nameJa)}, ${localitySecondaryLabel(result)} — ${Math.round(result.commute.totalMinutes)} minute commute, ${formatYenCompact(result.rent.lowYen)} to ${formatYenCompact(result.rent.highYen)} modeled rent. Open the neighborhood entry.`}
            className="group absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none"
            style={{
              left: `${(pin.x / VIEW_W) * 100}%`,
              top: `${(pin.y / VIEW_H) * 100}%`,

              zIndex: isHighlighted ? HIGHLIGHT_Z : Math.max(1, MAX_PIN_Z - result.rank),
            }}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: reducedMotion ? 0 : 0.3,
              delay: reducedMotion ? 0 : 0.28 + Math.min(result.rank - 1, 12) * 0.045,
            }}
          >
            <span
              className={`grid place-items-center rounded-full font-mono font-semibold text-white shadow-[0_2px_8px_rgba(40,36,31,0.24)] transition-[transform,background-color] duration-150 motion-reduce:transition-none ${
                isTop ? "size-9 bg-vermilion text-[12px]" : "size-8 bg-moss text-[11px]"
              } ${isHighlighted ? "scale-110 bg-vermilion ring-2 ring-paper ring-offset-2 ring-offset-ink" : "ring-2 ring-paper"}`}
            >
              {result.rank}
            </span>

            {isTop && !isHighlighted && (
              <span className="pointer-events-none absolute top-1/2 left-[calc(100%-0.15rem)] hidden -translate-y-1/2 border-l-2 border-vermilion bg-paper/95 px-2.5 py-1.5 text-left shadow-[0_2px_10px_rgba(40,36,31,0.12)] sm:block">
                <span className="block max-w-36 truncate font-serif text-[13px] leading-none tracking-editorial text-ink">
                  {displayName}
                </span>
                <span className="mt-1 block font-mono text-[9px] tracking-wide whitespace-nowrap text-ink-muted uppercase">
                  Best match · {Math.round(result.overallScore)} pts
                </span>
              </span>
            )}

            <span
              aria-hidden="true"
              className={`pointer-events-none absolute z-50 hidden w-48 border-t-2 border-vermilion bg-ink px-3 py-2.5 text-left text-paper shadow-[0_6px_18px_rgba(40,36,31,0.25)] group-hover:block group-focus-visible:block ${
                tooltipOnLeft ? "right-9" : "left-9"
              } ${tooltipBelow ? "top-7" : "bottom-7"}`}
            >
              <span className="block font-serif text-[15px] leading-tight tracking-editorial">
                {displayName}
              </span>
              <span className="mt-1 block text-[10px] leading-relaxed text-sage">
                {localitySecondaryLabel(result)} · {Math.round(result.commute.totalMinutes)} min ·{" "}
                {formatYenCompact(result.rent.medianYen)} median
              </span>
              <span className="mt-1.5 block text-[9px] font-semibold tracking-[0.12em] text-paper uppercase">
                Open neighborhood →
              </span>
            </span>
          </motion.button>
        );
      })}

      <div className="pointer-events-none absolute right-3 bottom-3 z-20 hidden items-center gap-3 bg-paper/90 px-2.5 py-1.5 text-[9px] font-medium tracking-[0.08em] text-ink-muted uppercase shadow-sm sm:flex">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-moss" /> Result
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rotate-45 bg-vermilion" /> Destination
        </span>
      </div>

      {hiddenPinCount > 0 && (
        <p className="absolute inset-x-0 bottom-0 z-40 bg-ink/90 px-3 py-2 text-center text-[11px] text-paper">
          Showing the top {pinned.length} of {results.length} — expand for all
        </p>
      )}

      <figcaption className="sr-only">
        Map of {results.length} candidate neighborhoods
        {destination ? ` around ${destination.label}` : ""}, drawn from locality boundaries.
        Neighborhoods are numbered by rank
        {hiddenPinCount > 0 ? `; this compact view marks the top ${pinned.length}` : ""}. The same
        information appears in the ranked list.
      </figcaption>
      <p className="sr-only" aria-live="polite">
        {highlightedResult
          ? `Highlighted rank ${highlightedResult.rank}, ${localityDisplayName(highlightedResult.nameEn, highlightedResult.nameJa)}.`
          : ""}
      </p>
    </figure>
  );
}
