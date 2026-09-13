"use client";

import { motion, useReducedMotion } from "motion/react";

import { PLATE_STATIONS, WARD_PLATE_VIEWBOX, WARD_SHAPES } from "./tokyo-wards";

export function HeroMapFragment() {
  const { width, height } = WARD_PLATE_VIEWBOX;
  const reducedMotion = useReducedMotion();

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={width} height={height} className="fill-sage" />

      <g className="fill-paper-soft stroke-line-strong" strokeWidth="1.1">
        {WARD_SHAPES.map((ward, index) => (
          <motion.path
            key={ward.code}
            d={ward.d}
            fillRule="evenodd"
            initial={reducedMotion ? false : { opacity: 0.2, pathLength: 0 }}
            animate={{ opacity: 1, pathLength: 1 }}
            transition={{
              duration: reducedMotion ? 0 : 0.65,
              delay: reducedMotion ? 0 : index * 0.025,
              ease: [0.22, 0.61, 0.36, 1],
            }}
          />
        ))}
      </g>

      {!reducedMotion && (
        <motion.line
          x1="70"
          x2={width - 70}
          y1="70"
          y2="70"
          className="stroke-vermilion"
          strokeWidth="1"
          strokeDasharray="2 7"
          initial={{ opacity: 0 }}
          animate={{ y1: [70, height - 70], y2: [70, height - 70], opacity: [0, 0.24, 0] }}
          transition={{
            duration: 3.2,
            delay: 1.1,
            repeat: Infinity,
            repeatDelay: 5.5,
            ease: "easeInOut",
          }}
        />
      )}

      <g>
        {PLATE_STATIONS.map((station, index) => (
          <motion.g
            key={station.nameJa}
            initial={reducedMotion ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ transformOrigin: `${station.x}px ${station.y}px` }}
            transition={{
              duration: reducedMotion ? 0 : 0.38,
              delay: reducedMotion ? 0 : 0.4 + index * 0.1,
              ease: [0.22, 0.61, 0.36, 1],
            }}
          >
            {!reducedMotion && (
              <motion.circle
                cx={station.x}
                cy={station.y}
                r="3.6"
                className="fill-none stroke-vermilion"
                initial={{ opacity: 0.55, scale: 1 }}
                animate={{ opacity: 0, scale: 3.2 }}
                transition={{
                  duration: 1.4,
                  delay: 0.8 + index * 0.12,
                  repeat: Infinity,
                  repeatDelay: 4.2,
                  ease: "easeOut",
                }}
              />
            )}
            <circle cx={station.x} cy={station.y} r="3.6" className="fill-vermilion" />
            <text
              x={station.x + 8}
              y={station.y + 1}
              className="fill-ink font-sans"
              fontSize="12.5"
              fontWeight="500"
            >
              {station.romanized}
            </text>
            <text
              x={station.x + 8}
              y={station.y + 14}
              className="fill-ink-muted font-serif"
              fontSize="11.5"
            >
              {station.nameJa}
            </text>
          </motion.g>
        ))}
      </g>
    </svg>
  );
}
