"use client";

import type { NeighborhoodResult } from "@tokyo/shared";

import {
  commuteDisplayTerms,
  formatYenCompact,
  isLifestyleFactor,
  localityDisplayName,
  pickCompromise,
  pickStrength,
  wardDisplayName,
} from "../../lib/format";
import { CloseIcon } from "./icons";

const MATERIAL_SPREAD = {
  score: 3,

  rentRatio: 0.05,
  minutes: 3,
  transfers: 1,
  factor: 8,
} as const;

type Better = "lower" | "higher";

function standoutIndex(
  values: readonly number[],
  better: Better,
  threshold: number,
): number | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < threshold) return null;
  const target = better === "lower" ? min : max;
  const winners = values.reduce<number[]>(
    (found, value, index) => (value === target ? [...found, index] : found),
    [],
  );
  return winners.length === 1 ? (winners[0] ?? null) : null;
}

interface Row {
  readonly id: string;
  readonly label: string;
  readonly values: readonly string[];
  readonly standout: number | null;

  readonly prose?: boolean;
}

function buildRows(results: readonly NeighborhoodResult[]): readonly Row[] {
  const commutes = results.map((result) => commuteDisplayTerms(result.commute));

  const rows: Row[] = [
    {
      id: "fit",
      label: "Fit score",
      values: results.map((result) => `${Math.round(result.overallScore)} / 100`),
      standout: standoutIndex(
        results.map((result) => result.overallScore),
        "higher",
        MATERIAL_SPREAD.score,
      ),
    },
    {
      id: "rent",
      label: "Modeled rent",
      values: results.map(
        (result) =>
          `${formatYenCompact(result.rent.lowYen)}–${formatYenCompact(result.rent.highYen)}`,
      ),
      standout: standoutIndex(
        results.map((result) => result.rent.medianYen),
        "lower",
        Math.min(...results.map((result) => result.rent.medianYen)) * MATERIAL_SPREAD.rentRatio,
      ),
    },
    {
      id: "commute",
      label: "Commute",
      values: commutes.map((commute) => `${commute.total} min`),
      standout: standoutIndex(
        commutes.map((commute) => commute.total),
        "lower",
        MATERIAL_SPREAD.minutes,
      ),
    },
    {
      id: "transfers",
      label: "Transfers",
      values: results.map((result) =>
        result.commute.mode === "walk" ? "—" : String(result.commute.transferCount),
      ),
      standout: results.every((result) => result.commute.mode !== "walk")
        ? standoutIndex(
            results.map((result) => result.commute.transferCount),
            "lower",
            MATERIAL_SPREAD.transfers,
          )
        : null,
    },
    {
      id: "walk",
      label: "Walk to the station",
      values: commutes.map((commute) => `${commute.accessWalk} min`),
      standout: standoutIndex(
        commutes.map((commute) => commute.accessWalk),
        "lower",
        MATERIAL_SPREAD.minutes,
      ),
    },
  ];

  const sharedFactorKeys = (results[0]?.factors ?? [])
    .map((factor) => factor.key)
    .filter(
      (key) =>
        isLifestyleFactor(key) &&
        results.every((result) => result.factors.some((factor) => factor.key === key)),
    );

  for (const key of sharedFactorKeys) {
    const factors = results.map((result) => result.factors.find((factor) => factor.key === key)!);
    const scores = factors.map((factor) => Math.round(factor.componentScore));
    rows.push({
      id: `factor:${key}`,
      label: factors[0]?.label ?? key,
      values: scores.map((score) => `${score} / 100`),
      standout: standoutIndex(scores, "higher", MATERIAL_SPREAD.factor),
    });
  }

  rows.push(
    {
      id: "strength",
      label: "Strongest point",
      values: results.map((result) => pickStrength(result)?.short ?? "—"),
      standout: null,
      prose: true,
    },
    {
      id: "compromise",
      label: "Main compromise",
      values: results.map((result) => pickCompromise(result)?.short ?? "—"),
      standout: null,
      prose: true,
    },
  );

  return rows;
}

export function ComparisonTable({
  results,
  onRemove,
  onClear,
  headingId,
}: {
  readonly results: readonly NeighborhoodResult[];
  readonly onRemove: (localityId: string) => void;
  readonly onClear: () => void;
  readonly headingId: string;
}) {
  const rows = buildRows(results);

  return (
    <section aria-labelledby={headingId} className="mt-10 border-t-2 border-ink pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <p className="label-utility text-vermilion-deep">Side by side</p>
          <h3
            id={headingId}
            className="mt-2 font-serif text-2xl font-medium tracking-editorial sm:text-3xl"
          >
            {results.length === 1
              ? "Pick one more to compare"
              : `Comparing ${results.length} neighborhoods`}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="label-utility flex min-h-11 items-center gap-2 border border-line-strong px-3 text-ink transition-colors hover:border-ink"
        >
          <CloseIcon className="size-3.5" />
          Clear comparison
        </button>
      </div>

      {results.length === 1 ? (
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-muted">
          Tick <span className="font-medium text-ink">Compare</span> on another neighborhood in the
          shortlist and the two will be laid out column by column.
        </p>
      ) : (
        <>
          {/* Scrolls inside its own container so three columns of Japanese
              names never push the page sideways on a phone. `tabIndex` is
              what makes that scroll reachable without a pointer: a plain
              overflow container cannot be scrolled from the keyboard. */}
          <div
            role="region"
            aria-label="Neighborhood comparison, scrolls horizontally"
            tabIndex={0}
            className="mt-5 overflow-x-auto border border-line-strong"
          >
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <caption className="sr-only">
                Comparison of {results.length} shortlisted neighborhoods. Values that stand out from
                the others are marked &ldquo;best of these&rdquo;.
              </caption>
              <thead>
                <tr className="border-b border-line-strong bg-paper-soft align-bottom">
                  <th scope="col" className="label-utility w-40 px-4 py-3 text-ink-muted">
                    Measure
                  </th>
                  {results.map((result) => (
                    <th
                      scope="col"
                      key={result.localityId}
                      className="min-w-[10rem] px-4 py-3 font-normal"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block font-mono text-[11px] text-vermilion-deep">
                            {String(result.rank).padStart(2, "0")}
                          </span>
                          <span className="mt-0.5 block font-serif text-[19px] leading-snug font-medium tracking-editorial break-words">
                            {localityDisplayName(result.nameEn, result.nameJa)}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-ink-muted">
                            {wardDisplayName(result.wardNameEn)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemove(result.localityId)}
                          aria-label={`Remove ${localityDisplayName(result.nameEn, result.nameJa)} from the comparison`}
                          className="flex size-11 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-brick"
                        >
                          <CloseIcon className="size-3.5" />
                        </button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <th scope="row" className="px-4 py-3 text-[13px] font-medium text-ink-muted">
                      {row.label}
                    </th>
                    {row.values.map((value, index) => (
                      <td
                        key={`${row.id}-${index}`}
                        className={`px-4 py-3 ${row.prose ? "text-[13px] leading-relaxed" : "text-[15px] font-medium tnum"}`}
                      >
                        {value}
                        {row.standout === index && (
                          <span className="mt-1 flex items-center gap-1.5 text-[11px] font-normal text-vermilion-deep">
                            <span
                              aria-hidden="true"
                              className="size-1.5 rounded-full bg-vermilion"
                            />
                            best of these
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
            <span className="sm:hidden">Scroll the table sideways to see every column. </span>
            Only differences large enough to matter are marked — a point or two between modeled
            scores is noise. This comparison lives in this tab and is not saved; reloading clears
            it.
          </p>
        </>
      )}
    </section>
  );
}
