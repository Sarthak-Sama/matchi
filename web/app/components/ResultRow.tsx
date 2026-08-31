"use client";

import type { NeighborhoodResult } from "@tokyo/shared";

import {
  commuteDisplayTerms,
  formatYenCompact,
  localityDisplayName,
  pickCompromise,
  pickStrength,
  wardDisplayName,
} from "../../lib/format";
import { CompareToggle } from "./CompareToggle";
import { ScoreRing } from "./ScoreRing";

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
  const commute = commuteDisplayTerms(result.commute);
  const strength = pickStrength(result);
  const compromise = pickCompromise(result);
  const rankLabel = String(result.rank).padStart(2, "0");

  const displayName = localityDisplayName(result.nameEn, result.nameJa);

  return (
    <li
      className={`flex items-stretch transition-colors duration-150 motion-reduce:transition-none ${
        highlighted ? "bg-sage/50" : "hover:bg-paper-soft"
      }`}
      onMouseEnter={() => onHighlight(result.localityId)}
      onMouseLeave={() => onHighlight(null)}
    >
      <button
        type="button"
        onClick={() => onOpen(result)}
        onFocus={() => onHighlight(result.localityId)}
        onBlur={() => onHighlight(null)}
        aria-label={`Rank ${result.rank}: ${displayName}, ${wardDisplayName(result.wardNameEn)}. Open the neighborhood entry.`}
        className="min-w-0 flex-1 px-4 py-4 text-left sm:px-5"
      >
        <div className="flex items-start gap-3 sm:items-center sm:gap-5">
          <span className="mt-1 w-6 shrink-0 font-mono text-[12px] text-vermilion-deep sm:mt-0">
            {rankLabel}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2.5">
              <span className="font-serif text-[19px] leading-snug font-medium tracking-editorial break-words">
                {localityDisplayName(result.nameEn, result.nameJa)}
              </span>
              <span className="text-[12px] text-ink-muted">
                {wardDisplayName(result.wardNameEn)}
              </span>
            </span>

            <span className="mt-1.5 flex flex-col gap-0.5 text-[12.5px] leading-snug">
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

          <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-6">
            <span className="text-right sm:w-16">
              <span className="block text-[15px] font-semibold tnum">{commute.total} min</span>
              <span className="label-utility block text-[8px] text-ink-muted">Commute</span>
            </span>
            <span className="text-right sm:w-28">
              <span className="block text-[15px] font-semibold tnum">
                {formatYenCompact(result.rent.lowYen)}–{formatYenCompact(result.rent.highYen)}
              </span>
              <span className="label-utility block text-[8px] text-ink-muted">Modeled rent</span>
            </span>
            <span className="hidden items-center sm:flex">
              <ScoreRing
                score={result.overallScore}
                size={44}
                label={`Overall fit score ${Math.round(result.overallScore)} out of 100`}
              />
            </span>
          </span>
        </div>
      </button>

      <div className="flex shrink-0 items-center border-l border-line">
        <CompareToggle
          checked={compared}
          disabled={compareFull}
          onChange={(next) => onCompare(result, next)}
          name={displayName}
        />
      </div>
    </li>
  );
}
