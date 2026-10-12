"use client";

import { motion, useReducedMotion } from "motion/react";
import type { NeighborhoodResult } from "@tokyo/shared";

import {
  commuteDisplayTerms,
  formatYenCompact,
  localityDisplayName,
  localitySecondaryLabel,
  pickCompromise,
  pickStrength,
} from "../../lib/format";
import { CompareToggle } from "./CompareToggle";
import { GoogleMapsLink } from "./GoogleMapsLink";
import { ScoreRing } from "./ScoreRing";
import { StationNumber } from "./StationNumber";

export function ResultRow({
  result,
  highlighted,
  compared,
  compareFull,
  onCompare,
  onHighlight,
  onOpen,
}: {
  readonly result: NeighborhoodResult;
  readonly highlighted: boolean;
  readonly compared: boolean;
  readonly compareFull: boolean;
  readonly onCompare: (result: NeighborhoodResult, compared: boolean) => void;
  readonly onHighlight: (id: string | null) => void;
  readonly onOpen: (result: NeighborhoodResult) => void;
}) {
  const reducedMotion = useReducedMotion();
  const commute = commuteDisplayTerms(result.commute);
  const strength = pickStrength(result);
  const compromise = pickCompromise(result);
  const rankLabel = String(result.rank).padStart(2, "0");

  const displayName = localityDisplayName(result.nameEn, result.nameJa);
  const secondaryLabel = localitySecondaryLabel(result);

  return (
    <motion.li
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.32,
        delay: Math.min(result.rank - 1, 8) * 0.035,
      }}
      className={`flex items-stretch transition-colors duration-150 motion-reduce:transition-none ${
        highlighted
          ? "bg-paper-soft shadow-[inset_4px_0_0_var(--color-vermilion)]"
          : "hover:bg-paper-soft"
      }`}
      onMouseEnter={() => onHighlight(result.localityId)}
      onMouseLeave={() => onHighlight(null)}
    >
      <div className="min-w-0 flex-1 px-4 py-4 text-left sm:px-5">
        <div className="flex items-start gap-3 sm:gap-5">
          <StationNumber code={rankLabel} active={highlighted} />

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2.5">
              <button
                type="button"
                onClick={() => onOpen(result)}
                onFocus={() => onHighlight(result.localityId)}
                onBlur={() => onHighlight(null)}
                aria-label={`Rank ${result.rank}: ${displayName}. Open the neighborhood entry.`}
                className="-my-2 py-2 text-left text-[17px] leading-snug font-bold tracking-[-0.01em] break-words hyphens-auto underline sm:text-[18px] decoration-transparent underline-offset-4 transition-colors hover:text-vermilion-deep hover:decoration-vermilion-deep"
              >
                {result.nameEn || result.nameJa}
                {result.nameEn && result.nameJa && result.nameEn !== result.nameJa && (
                  <span
                    lang="ja"
                    className="ml-2 inline-block text-[0.85em] font-semibold text-ink-muted"
                  >
                    {result.nameJa}
                  </span>
                )}
              </button>
              <GoogleMapsLink result={result} compact />
            </span>
            <span className="mt-0.5 block text-[12px] text-ink-muted">{secondaryLabel}</span>

            <span className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="text-[15px] font-bold tnum">
                {commute.total}
                <span className="ml-1 text-[11px] font-medium text-ink-muted">min commute</span>
              </span>
              <span className="text-[15px] font-bold tnum">
                {formatYenCompact(result.rent.lowYen)}–{formatYenCompact(result.rent.highYen)}
                <span className="ml-1 text-[11px] font-medium text-ink-muted">modeled rent</span>
              </span>
            </span>

            <span className="mt-2 flex flex-col gap-0.5 text-[12.5px] leading-snug">
              {strength && (
                <span className="min-w-0">
                  <span className="font-semibold text-moss" aria-hidden="true">
                    +
                  </span>{" "}
                  <span className="sr-only">Strength: </span>
                  <span className="text-ink-muted">{strength.short}</span>
                </span>
              )}
              {compromise && (
                <span className="min-w-0">
                  <span className="font-semibold text-brick" aria-hidden="true">
                    −
                  </span>{" "}
                  <span className="sr-only">Compromise: </span>
                  <span className="text-ink-muted">{compromise.short}</span>
                </span>
              )}
            </span>
          </span>

          <span className="shrink-0">
            <ScoreRing
              score={result.overallScore}
              size={44}
              label={`Overall fit score ${Math.round(result.overallScore)} out of 100`}
            />
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center border-l border-line">
        <CompareToggle
          checked={compared}
          disabled={compareFull}
          onChange={(next) => onCompare(result, next)}
          name={displayName}
        />
      </div>
    </motion.li>
  );
}
