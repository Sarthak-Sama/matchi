"use client";

import type { NeighborhoodResult } from "@tokyo/shared";

import {
  commuteDisplayTerms,
  deriveDescriptor,
  formatYenCompact,
  localityDisplayName,
  pickCompromise,
  pickStrength,
  sentenceCase,
  wardDisplayName,
} from "../../lib/format";
import { CompareToggle } from "./CompareToggle";
import { ArrowRightIcon } from "./icons";
import { ScoreRing } from "./ScoreRing";

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
  const commute = commuteDisplayTerms(result.commute);
  const descriptor = deriveDescriptor(result);
  const compromise = pickCompromise(result);
  const strength = pickStrength(result);

  return (
    <article
      onMouseEnter={() => onHighlight(result.localityId)}
      onMouseLeave={() => onHighlight(null)}
      className={`border transition-colors duration-200 motion-reduce:transition-none ${
        highlighted ? "border-vermilion" : "border-line-strong"
      } bg-paper-soft`}
    >
      {/* Rank band */}
      <div className="flex items-center justify-between border-b border-line px-5 py-2.5 sm:px-7">
        <p className="label-utility whitespace-nowrap text-vermilion-deep">
          <span className="font-mono tracking-normal">01</span>
          <span className="mx-2 text-line-strong" aria-hidden="true">
            /
          </span>
          Best overall fit
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
        {/* Name and score share the first line; the descriptor runs
            beneath both, where it has room to be a sentence. */}
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <h3 className="font-serif text-3xl leading-tight font-medium tracking-editorial text-balance break-words sm:text-4xl">
              {localityDisplayName(result.nameEn, result.nameJa)}
            </h3>
            <p className="mt-1.5 text-[13px] text-ink-muted">
              {result.nameEn !== result.nameJa && (
                <span lang="ja" className="mr-2">
                  {result.nameJa}
                </span>
              )}
              {wardDisplayName(result.wardNameEn)}
              <span lang="ja" className="ml-1.5">
                {result.wardNameJa}
              </span>
            </p>
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
          <p className="mt-4 max-w-lg font-serif text-[18px] leading-snug text-vermilion-deep italic">
            {sentenceCase(descriptor)} &mdash; {commute.total} minutes from{" "}
            {destinationLabel ?? "your destination"}.
          </p>
        )}

        {/* The three decision numbers, as an editorial strip — not cards. */}
        <dl className="mt-5 grid grid-cols-3 divide-x divide-line border-y border-line">
          <div className="py-3 pr-3">
            <dt className="label-utility text-[9px] text-ink-muted">Commute</dt>
            <dd className="mt-1.5 font-serif text-2xl tnum sm:text-[1.7rem]">
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
            <dd className="mt-1.5 font-serif text-2xl tnum sm:text-[1.7rem]">
              {formatYenCompact(result.rent.lowYen)}–{formatYenCompact(result.rent.highYen)}
            </dd>
            <dd className="mt-0.5 text-[11px] text-ink-muted">
              per month · {result.rent.confidence} confidence
            </dd>
          </div>
          <div className="py-3 pl-3">
            <dt className="label-utility text-[9px] text-ink-muted">Transfers</dt>
            <dd className="mt-1.5 font-serif text-2xl tnum sm:text-[1.7rem]">
              {result.commute.mode === "walk" ? "—" : result.commute.transferCount}
            </dd>
            <dd className="mt-0.5 text-[11px] text-ink-muted">
              {result.commute.mode === "walk"
                ? "walkable directly"
                : `${commute.accessWalk} min walk to the station`}
            </dd>
          </div>
        </dl>

        {/* Why it fits / consider carefully — the compromise column is
            never dropped: when the API states no reason against, the
            weakest scored component is named instead, so the reader is
            never shown an unqualified recommendation. */}
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

        <button
          type="button"
          onClick={() => onOpen(result)}
          className="mt-6 flex min-h-12 w-full items-center justify-between gap-3 bg-moss px-5 py-3.5 text-[13px] font-semibold tracking-[0.08em] text-white uppercase transition-colors hover:bg-moss-deep sm:w-auto sm:min-w-64"
        >
          Read the neighborhood entry
          <ArrowRightIcon />
        </button>
      </div>
    </article>
  );
}
