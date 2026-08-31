"use client";

import { useEffect, useRef } from "react";

import type { FactorEvidence, NeighborhoodResult } from "@tokyo/shared";
import { RENT_LABEL } from "@tokyo/shared";

import {
  commuteDisplayTerms,
  deriveDescriptor,
  formatCoordinates,
  formatSourceDate,
  formatYenFull,
  localityDisplayName,
  pickCompromise,
  sentenceCase,
  wardDisplayName,
} from "../../lib/format";
import { CloseIcon } from "./icons";
import { ScoreRing } from "./ScoreRing";

interface NeighborhoodDetailProps {
  readonly result: NeighborhoodResult;
  readonly destinationLabel: string | null;
  readonly onClose: () => void;
}

export function NeighborhoodDetail({ result, destinationLabel, onClose }: NeighborhoodDetailProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      restoreRef.current?.focus();
    };
  }, [onClose]);

  const commute = commuteDisplayTerms(result.commute);
  const descriptor = deriveDescriptor(result);
  const compromise = pickCompromise(result);
  const isWalk = result.commute.mode === "walk";

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-ink/45 motion-reduce:transition-none"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="neighborhood-entry-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-line-strong bg-paper shadow-[-24px_0_60px_rgba(40,36,31,0.25)]"
      >
        <div className="border-b border-line px-5 pt-5 pb-5 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <p className="label-utility text-vermilion-deep">
              <span className="font-mono tracking-normal">
                {String(result.rank).padStart(2, "0")}
              </span>
              <span className="mx-2 text-line-strong" aria-hidden="true">
                /
              </span>
              Neighborhood entry
            </p>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close the neighborhood entry"
              className="flex min-h-11 min-w-11 items-center justify-center border border-line-strong text-ink transition-colors hover:border-ink"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id="neighborhood-entry-title"
                className="font-serif text-4xl leading-[1.05] font-medium tracking-editorial break-words"
              >
                {localityDisplayName(result.nameEn, result.nameJa)}
              </h2>
              <p className="mt-2 text-[14px] text-ink-muted">
                {wardDisplayName(result.wardNameEn)}
                <span lang="ja" className="ml-2">
                  {result.wardNameJa}
                </span>
              </p>
              <p className="mt-1.5 font-mono text-[11px] text-ink-muted">
                {formatCoordinates(result.centroid.lat, result.centroid.lon)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <ScoreRing
                score={result.overallScore}
                size={64}
                label={`Overall fit score ${Math.round(result.overallScore)} out of 100`}
              />
              <span className="label-utility text-[9px] text-ink-muted">Fit / 100</span>
            </div>
          </div>
          {descriptor && (
            <p className="mt-4 max-w-md font-serif text-[17px] leading-snug text-vermilion-deep italic">
              {sentenceCase(descriptor)}.
            </p>
          )}
        </div>

        <div
          role="region"
          aria-label="Neighborhood entry details"
          tabIndex={0}
          className="flex-1 overflow-y-auto"
        >
          <section aria-label="Key metrics" className="border-b border-line">
            <dl className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-6 sm:divide-y-0">
              <MetricCell
                label="Commute"
                value={`${commute.total} min`}
                note={`${Math.round(result.commute.rangeMinutes.min)}–${Math.round(result.commute.rangeMinutes.max)} min range`}
                span="sm:col-span-2"
              />
              <MetricCell
                label="Modeled rent"
                value={`${formatYenFull(result.rent.lowYen)}–${formatYenFull(result.rent.highYen)}`}
                note={`median ${formatYenFull(result.rent.medianYen)} · ${result.rent.confidence} confidence`}
                span="col-span-2 sm:col-span-3"
              />
              <MetricCell
                label={isWalk ? "On foot" : "Transfers"}
                value={isWalk ? "—" : String(result.commute.transferCount)}
                note={isWalk ? "walkable directly" : `${commute.accessWalk} min walk`}
              />
            </dl>
          </section>

          <section
            aria-labelledby="commute-heading"
            className="border-b border-line px-5 py-5 sm:px-8"
          >
            <h3 id="commute-heading" className="label-utility text-ink">
              The commute, composed
            </h3>
            {isWalk ? (
              <p className="mt-3 border border-moss/30 bg-sage/50 px-3 py-2.5 text-[13px] leading-relaxed">
                Walk directly — living here, walking beats taking rail for this journey. Treat the
                time as a walk estimate, not a train ride.
              </p>
            ) : (
              <>
                <CommuteBar result={result} />

                <ol className="mt-4 space-y-1.5 text-[13px] tnum">
                  <CommuteLeg
                    label="Walk to the station"
                    minutes={commute.accessWalk}
                    swatch="bg-stone"
                  />
                  <CommuteLeg label="On the rail" minutes={commute.rail} swatch="bg-moss" />
                  {commute.wait > 0 && (
                    <CommuteLeg
                      label="Expected wait"
                      minutes={commute.wait}
                      swatch="bg-sage-deep"
                    />
                  )}
                  {commute.destinationWalk > 0 && (
                    <CommuteLeg
                      label={`Walk to ${destinationLabel ?? "destination"}`}
                      minutes={commute.destinationWalk}
                      swatch="bg-stone"
                    />
                  )}
                </ol>
                {result.commute.path.length > 1 && (
                  <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
                    <span className="label-utility mr-2 text-[9px]">Route</span>
                    {result.commute.path.map((stop, index) => (
                      <span key={`${stop.stationGroupId}-${index}`}>
                        {index > 0 && <span aria-hidden="true"> → </span>}
                        <span lang="ja">{stop.nameJa}</span>
                      </span>
                    ))}
                  </p>
                )}
              </>
            )}
            <p className="mt-3 text-[12px] text-ink-muted">
              {result.commute.label} · {result.commute.confidence} confidence ·{" "}
              {result.catchmentLabel}
            </p>
          </section>

          <section aria-labelledby="fit-heading" className="border-b border-line px-5 py-5 sm:px-8">
            <h3 id="fit-heading" className="label-utility text-ink">
              The recommendation, in words
            </h3>
            {result.reasonsFor.length > 0 && (
              <ul className="mt-3 space-y-2">
                {result.reasonsFor.map((reason) => (
                  <li key={reason} className="flex gap-2.5 text-[14px] leading-relaxed">
                    <span aria-hidden="true" className="font-semibold text-moss">
                      +
                    </span>
                    <span>
                      <span className="sr-only">Strength: </span>
                      {reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(result.reasonsAgainst.length > 0 || compromise) && (
              <div className="mt-4 border border-brick/30 bg-warning px-4 py-3">
                <p className="label-utility text-[9px] text-brick">
                  {result.reasonsAgainst.length > 0 ? "The trade-offs" : "The weakest part"}
                </p>
                <ul className="mt-2 space-y-2">
                  {result.reasonsAgainst.length > 0
                    ? result.reasonsAgainst.map((reason) => (
                        <li key={reason} className="flex gap-2.5 text-[14px] leading-relaxed">
                          <span aria-hidden="true" className="font-semibold text-brick">
                            −
                          </span>
                          <span>
                            <span className="sr-only">Trade-off: </span>
                            {reason}
                          </span>
                        </li>
                      ))
                    : compromise && (
                        <li className="flex gap-2.5 text-[14px] leading-relaxed">
                          <span aria-hidden="true" className="font-semibold text-brick">
                            −
                          </span>
                          <span>
                            <span className="sr-only">Weakest component: </span>
                            {compromise.text}
                          </span>
                        </li>
                      )}
                </ul>
              </div>
            )}
          </section>

          {result.factors.length > 0 && (
            <section
              aria-labelledby="evidence-heading"
              className="border-b border-line px-5 py-5 sm:px-8"
            >
              <h3 id="evidence-heading" className="label-utility text-ink">
                The evidence
              </h3>
              <ul className="mt-4 space-y-5">
                {result.factors.map((factor) => (
                  <FactorRow key={factor.key} factor={factor} />
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="method-heading" className="px-5 py-5 sm:px-8">
            <h3 id="method-heading" className="label-utility text-ink">
              Notes on this estimate
            </h3>
            <dl className="mt-3 space-y-2.5 text-[13px] leading-relaxed">
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-ink-muted">Rent basis</dt>
                <dd>
                  {RENT_LABEL} for a {result.rent.assumedSizeSqmMin}–{result.rent.assumedSizeSqmMax}{" "}
                  m² {result.rent.layout} · source {result.rent.source}, {result.rent.sourcePeriod}{" "}
                  · {result.rent.confidence} confidence
                </dd>
              </div>
              {result.nearbyStations.length > 0 && (
                <div className="flex gap-3">
                  <dt className="w-28 shrink-0 text-ink-muted">Stations</dt>
                  <dd>
                    {result.nearbyStations.map((station, index) => (
                      <span key={station.stationGroupId}>
                        {index > 0 && ", "}
                        <span lang="ja">{station.nameJa}</span> ({station.walkMinutes} min)
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-ink-muted">Catchment</dt>
                <dd>{result.catchmentLabel}</dd>
              </div>
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}

function MetricCell({
  label,
  value,
  note,
  span = "",
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly span?: string;
}) {
  return (
    <div className={`px-4 py-4 ${span}`}>
      <dt className="label-utility text-[9px] text-ink-muted">{label}</dt>
      <dd className="mt-1.5 font-serif text-[17px] leading-snug tnum">{value}</dd>
      <dd className="mt-1 text-[11px] text-ink-muted">{note}</dd>
    </div>
  );
}

function CommuteBar({ result }: { readonly result: NeighborhoodResult }) {
  const terms = commuteDisplayTerms(result.commute);
  const segments = [
    { label: "Walk", minutes: terms.accessWalk, className: "bg-stone" },
    { label: "Rail", minutes: terms.rail, className: "bg-moss" },
    { label: "Wait", minutes: terms.wait, className: "bg-sage-deep" },
    { label: "Walk", minutes: terms.destinationWalk, className: "bg-stone" },
  ].filter((segment) => segment.minutes > 0);
  const total = Math.max(
    segments.reduce((sum, segment) => sum + segment.minutes, 0),
    1,
  );

  return (
    <div
      role="img"
      aria-label={`${terms.total} minutes total: ${terms.accessWalk} walking to the station, ${terms.rail} on rail, ${terms.wait} waiting, ${terms.destinationWalk} walking to the destination.`}
      className="mt-3 flex h-4 w-full overflow-hidden border border-line-strong"
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          className={segment.className}
          style={{ width: `${(segment.minutes / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

function CommuteLeg({
  label,
  minutes,
  swatch,
}: {
  readonly label: string;
  readonly minutes: number;
  readonly swatch: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="flex items-baseline gap-2 text-ink-muted">
        <span aria-hidden="true" className={`size-2 shrink-0 translate-y-px ${swatch}`} />
        {label}
      </span>
      <span className="font-medium">{minutes} min</span>
    </li>
  );
}

function FactorRow({ factor }: { readonly factor: FactorEvidence }) {
  const score = Math.round(factor.componentScore);
  const barClass =
    factor.direction === "positive"
      ? "bg-moss"
      : factor.direction === "negative"
        ? "bg-brick"
        : "bg-stone";
  const directionLabel =
    factor.direction === "positive"
      ? "Strength"
      : factor.direction === "negative"
        ? "Weakness"
        : "Neutral";

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-medium">{factor.label}</p>
        <p className="label-utility text-[9px] text-ink-muted">
          {directionLabel} · <span className="tnum">{score}/100</span>
        </p>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1 w-full bg-line">
        <div className={`h-full ${barClass}`} style={{ width: `${score}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{factor.explanation}</p>
      <p className="mt-1 text-[11px] text-ink-muted">
        {factor.confidence} confidence · data as of {formatSourceDate(factor.sourceDate)}
      </p>
    </li>
  );
}
