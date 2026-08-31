"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { WARD_PLATE_VIEWBOX, WARD_SHAPES } from "../tokyo-wards";
import { EXAMPLE_SEARCH, LOCALITY_COUNT, localityPoint } from "./tokyo-localities";

const STAGE_MS = 1100;

interface Beat {
  readonly eyebrow: string;
  readonly line: string;
}

const BEATS: readonly Beat[] = [
  { eyebrow: "The ground", line: "23 special wards" },
  { eyebrow: "The candidates", line: `${LOCALITY_COUNT} areas, weighed every search` },
  { eyebrow: "The limits", line: "45 minutes · ¥200,000 · 1LDK" },
  {
    eyebrow: "The shortlist",

    line: `${EXAMPLE_SEARCH.funnel.qualified} fit — the best ${EXAMPLE_SEARCH.funnel.shortlisted}`,
  },
];

export function NarrowingPlate() {
  const reducedMotion = useReducedMotion();

  const [beat, setBeat] = useState(() => (reducedMotion ? BEATS.length - 1 : -1));

  useEffect(() => {
    if (reducedMotion) {
      setBeat(BEATS.length - 1);
      return;
    }
    const timers = BEATS.map((_, index) =>
      setTimeout(() => setBeat(index), 350 + index * STAGE_MS),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [reducedMotion]);

  const { width, height } = WARD_PLATE_VIEWBOX;
  const showField = beat >= 1;
  const showSweep = beat >= 2;
  const showMatches = beat >= 3;
  const current = BEATS[Math.max(beat, 0)];

  const sweepRadius =
    Math.hypot(
      Math.max(EXAMPLE_SEARCH.destination.x, width - EXAMPLE_SEARCH.destination.x),
      Math.max(EXAMPLE_SEARCH.destination.y, height - EXAMPLE_SEARCH.destination.y),
    ) + 20;

  return (
    <figure className="m-0">
      <div className="relative border border-line-strong bg-sage">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`A map of Tokyo's 23 special wards showing all ${LOCALITY_COUNT} areas the guide weighs. In an example search — ${EXAMPLE_SEARCH.destinationNameJa} by ${EXAMPLE_SEARCH.arrivalTime}, within ${EXAMPLE_SEARCH.maxCommuteMinutes} minutes, under ¥${EXAMPLE_SEARCH.monthlyBudgetYen.toLocaleString("en-US")} a month — ${EXAMPLE_SEARCH.funnel.qualified} areas cleared every limit, and the best ${EXAMPLE_SEARCH.funnel.shortlisted} are marked.`}
          className="block h-full w-full"
        >
          <defs>
            {}
            <clipPath id="plate-sweep">
              <motion.circle
                cx={EXAMPLE_SEARCH.destination.x}
                cy={EXAMPLE_SEARCH.destination.y}
                initial={{ r: reducedMotion ? sweepRadius : 0 }}
                animate={{ r: showField ? sweepRadius : 0 }}
                transition={{ duration: reducedMotion ? 0 : 1.1, ease: [0.22, 0.61, 0.36, 1] }}
              />
            </clipPath>
          </defs>

          {}
          <g className="fill-paper-soft stroke-line-strong" strokeWidth="1.1">
            {WARD_SHAPES.map((ward, index) => (
              <motion.path
                key={ward.code}
                d={ward.d}
                fillRule="evenodd"
                initial={{ opacity: reducedMotion ? 1 : 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.5,
                  delay: reducedMotion ? 0 : index * 0.035,
                  ease: "easeOut",
                }}
              />
            ))}
          </g>

          {}
          <motion.g
            clipPath="url(#plate-sweep)"
            className="fill-moss"
            initial={{ opacity: reducedMotion ? 0.22 : 0 }}
            animate={{ opacity: showField ? (showMatches ? 0.22 : 0.72) : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.55, ease: "easeOut" }}
          >
            {Array.from({ length: LOCALITY_COUNT }, (_, index) => {
              const { x, y } = localityPoint(index);
              return <circle key={index} cx={x} cy={y} r="2.1" />;
            })}
          </motion.g>

          {}
          {showSweep && (
            <motion.circle
              cx={EXAMPLE_SEARCH.destination.x}
              cy={EXAMPLE_SEARCH.destination.y}
              fill="none"
              className="stroke-vermilion"
              strokeWidth="1.2"
              strokeDasharray="3 6"
              initial={{ r: reducedMotion ? 132 : 0, opacity: reducedMotion ? 0.5 : 0.9 }}
              animate={{ r: 132, opacity: 0.5 }}
              transition={{ duration: reducedMotion ? 0 : 0.85, ease: [0.22, 0.61, 0.36, 1] }}
            />
          )}

          {}
          {showMatches &&
            EXAMPLE_SEARCH.matchedIndices.map((localityIndex, order) => {
              const { x, y } = localityPoint(localityIndex);
              return (
                <motion.circle
                  key={localityIndex}
                  cx={x}
                  cy={y}
                  className="fill-vermilion"
                  initial={{ r: reducedMotion ? 4.2 : 0, opacity: reducedMotion ? 1 : 0 }}
                  animate={{ r: 4.2, opacity: 1 }}
                  transition={{
                    duration: reducedMotion ? 0 : 0.34,
                    delay: reducedMotion ? 0 : order * 0.035,
                    ease: "easeOut",
                  }}
                />
              );
            })}

          {}
          {showSweep && (
            <motion.g
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reducedMotion ? 0 : 0.3 }}
            >
              <rect
                x={EXAMPLE_SEARCH.destination.x - 5}
                y={EXAMPLE_SEARCH.destination.y - 5}
                width="10"
                height="10"
                transform={`rotate(45 ${EXAMPLE_SEARCH.destination.x} ${EXAMPLE_SEARCH.destination.y})`}
                className="fill-ink"
              />
              <text
                x={EXAMPLE_SEARCH.destination.x + 12}
                y={EXAMPLE_SEARCH.destination.y + 4}
                className="fill-ink font-serif"
                fontSize="15"
              >
                {EXAMPLE_SEARCH.destinationNameJa}
              </text>
            </motion.g>
          )}
        </svg>

        {/* The beat caption, in the plate's own margin. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-3">
          <motion.p
            key={current?.line}
            initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 6 }}
            animate={{ opacity: beat >= 0 ? 1 : 0, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.28, ease: "easeOut" }}
            className="bg-ink px-2.5 py-1.5 text-paper"
          >
            <span className="label-utility block text-[9px] text-sage">{current?.eyebrow}</span>
            <span className="mt-0.5 block text-[13px] font-medium tnum">{current?.line}</span>
          </motion.p>

          {/* Progress through the four beats — also the only non-colour cue
              that the plate is mid-sequence. */}
          <span className="flex gap-1.5 pb-1" aria-hidden="true">
            {BEATS.map((item, index) => (
              <span
                key={item.line}
                className={`h-0.5 w-5 transition-colors duration-300 motion-reduce:transition-none ${
                  index <= beat ? "bg-vermilion" : "bg-line-strong"
                }`}
              />
            ))}
          </span>
        </div>
      </div>

      <figcaption className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-ink-muted">
        <span className="text-[12px]">
          A real search, run against the live engine — not an illustration.
        </span>
        <span className="font-mono text-[10px] text-stone">
          {EXAMPLE_SEARCH.destinationNameJa} · {EXAMPLE_SEARCH.arrivalTime} · &le;
          {EXAMPLE_SEARCH.maxCommuteMinutes}min · &yen;
          {(EXAMPLE_SEARCH.monthlyBudgetYen / 1000).toFixed(0)}k · {EXAMPLE_SEARCH.layout}
        </span>
      </figcaption>
    </figure>
  );
}
