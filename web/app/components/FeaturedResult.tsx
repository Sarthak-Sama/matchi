"use client";

import { motion, useReducedMotion } from "motion/react";
import type { NeighborhoodResult } from "@tokyo/shared";

import {
  commuteDisplayTerms,
  deriveDescriptor,
  formatYenCompact,
  localityDisplayName,
  localitySecondaryLabel,
  pickCompromise,
  pickStrength,
  sentenceCase,
} from "../../lib/format";
import { CompareToggle } from "./CompareToggle";
import { GoogleMapsLink } from "./GoogleMapsLink";
import { ArrowRightIcon } from "./icons";
import { ScoreRing } from "./ScoreRing";
import { StationNumber } from "./StationNumber";

export function FeaturedResult({
  result,
  destinationLabel,
  highlighted,
  compared,
  compareFull,
  onCompare,
  onHighlight,
  onOpen,
}: {
  readonly result: NeighborhoodResult;
  readonly destinationLabel: string | null;
  readonly highlighted: boolean;
  readonly compared: boolean;
  readonly compareFull: boolean;
  readonly onCompare: (result: NeighborhoodResult, compared: boolean) => void;
  readonly onHighlight: (id: string | null) => void;
  readonly onOpen: (result: NeighborhoodResult) => void;
}) {
  const reducedMotion = useReducedMotion();
  const commute = commuteDisplayTerms(result.commute);
  const descriptor = deriveDescriptor(result);
  const compromise = pickCompromise(result);
  const strength = pickStrength(result);

  return (
    <article
      onMouseEnter={() => onHighlight(result.localityId)}
      onMouseLeave={() => onHighlight(null)}
      className={`border border-t-[6px] border-t-moss shadow-[0_18px_40px_-30px_rgb(14_26_19/0.5)] transition-colors duration-200 motion-reduce:transition-none ${
        highlighted ? "border-vermilion" : "border-ink/70"
      } bg-paper-soft`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3 sm:px-7">
        <p className="label-utility flex items-center gap-3 whitespace-nowrap text-vermilion-deep">
          <StationNumber code="01" active={highlighted} />
          <span>
            <span className="sr-only">Rank 1: </span>Best overall fit
          </span>
        </p>
        <div className="flex items-center gap-4">
          <CompareToggle
            checked={compared}
            disabled={compareFull}
            onChange={(next) => onCompare(result, next)}
            name={localityDisplayName(result.nameEn, result.nameJa)}
            showLabel
          />
        </div>
      </div>

      <div className="px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <h3 className="font-display text-[1.8rem] leading-[1.02] font-bold tracking-editorial break-words hyphens-auto sm:text-[2.5rem]">
                {result.nameEn || result.nameJa}
                {result.nameEn && result.nameJa && result.nameEn !== result.nameJa && (
                  <span
                    lang="ja"
                    className="mt-1 block text-[0.6em] tracking-[0.08em] text-ink-muted"
                  >
                    {result.nameJa}
                  </span>
                )}
              </h3>
              <GoogleMapsLink result={result} />
            </div>
            <p className="mt-1.5 text-[13px] text-ink-muted">{localitySecondaryLabel(result)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1">
            <ScoreRing
              score={result.overallScore}
              size={72}
              label={`Overall fit score ${Math.round(result.overallScore)} out of 100`}
            />
            <span className="label-utility text-[9px] whitespace-nowrap text-ink-muted">
              Fit / 100
            </span>
          </div>
        </div>
        {descriptor && (
          <p className="mt-5 max-w-lg border-l-4 border-vermilion pl-4 text-[17px] leading-snug font-semibold">
            {sentenceCase(descriptor)} &mdash; {commute.total} minutes from{" "}
            {destinationLabel ?? "your destination"}.
          </p>
        )}

        <dl className="mt-5 grid grid-cols-3 divide-x divide-line border-y border-line">
          <div className="py-3 pr-3">
            <dt className="label-utility text-[9px] text-ink-muted">Commute</dt>
            <dd className="mt-1.5 font-display text-2xl font-bold tnum sm:text-[1.6rem]">
              {commute.total}
              <span className="ml-1 font-sans text-[12px] text-ink-muted">min</span>
            </dd>
            <dd className="mt-0.5 text-[11px] text-ink-muted tnum">
              {Math.round(result.commute.rangeMinutes.min)}–
              {Math.round(result.commute.rangeMinutes.max)} min across the area
            </dd>
          </div>
          <div className="px-3 py-3">
            <dt className="label-utility text-[9px] text-ink-muted">Modeled rent</dt>
            <dd className="mt-1.5 font-display text-2xl font-bold tnum sm:text-[1.6rem]">
              {formatYenCompact(result.rent.lowYen)}–{formatYenCompact(result.rent.highYen)}
            </dd>
            <dd className="mt-0.5 text-[11px] text-ink-muted">
              per month · {result.rent.confidence} confidence
            </dd>
          </div>
          <div className="py-3 pl-3">
            <dt className="label-utility text-[9px] text-ink-muted">Transfers</dt>
            <dd className="mt-1.5 font-display text-2xl font-bold tnum sm:text-[1.6rem]">
              {result.commute.mode === "walk" ? "—" : result.commute.transferCount}
            </dd>
            <dd className="mt-0.5 text-[11px] text-ink-muted">
              {result.commute.mode === "walk"
                ? "walkable directly"
                : `${commute.accessWalk} min walk to the station`}
            </dd>
          </div>
        </dl>

        <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          {strength && (
            <div>
              <p className="label-utility text-[9px] text-moss">Why it fits</p>
              <p className="mt-1.5 text-[14px] leading-relaxed">{strength.text}</p>
            </div>
          )}
          {compromise && (
            <div>
              <p className="label-utility text-[9px] text-brick">
                {compromise.derived ? "The weakest part" : "Consider carefully"}
              </p>
              <p className="mt-1.5 text-[14px] leading-relaxed">{compromise.text}</p>
            </div>
          )}
        </div>

        <motion.button
          type="button"
          onClick={() => onOpen(result)}
          whileHover={reducedMotion ? undefined : "hover"}
          whileTap={reducedMotion ? undefined : { scale: 0.985 }}
          className="mt-6 flex min-h-13 w-full items-center justify-between gap-5 bg-moss py-1.5 pr-1.5 pl-5 text-[15px] font-bold text-paper-soft shadow-[inset_0_-4px_0_rgb(0_0_0/0.22)] transition-colors hover:bg-moss-deep sm:w-auto sm:min-w-72"
        >
          Read the neighborhood entry
          <motion.span
            aria-hidden="true"
            className="grid h-10 w-12 place-items-center bg-paper-soft text-moss"
            style={{ clipPath: "polygon(0 0, 70% 0, 100% 50%, 70% 100%, 0 100%)" }}
            variants={{ hover: { x: 4 } }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <ArrowRightIcon className="size-4 -translate-x-1" />
          </motion.span>
        </motion.button>
      </div>
    </article>
  );
}
