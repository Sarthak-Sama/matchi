"use client";

import { useEffect, useState } from "react";

import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";

const STAGES = [
  "Mapping the commute",
  "Checking rent fit",
  "Weighing everyday priorities",
] as const;

export function LoadingResults() {
  const reducedMotion = usePrefersReducedMotion();
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    // Ride the stages once and wait at the last: looping back would claim
    // progress that is not happening.
    const handle = setInterval(() => {
      setStageIndex((index) => Math.min(index + 1, STAGES.length - 1));
    }, 1600);
    return () => clearInterval(handle);
  }, [reducedMotion]);

  return (
    <section aria-label="Searching for neighborhoods" className="mt-14">
      <div className="border-t-[6px] border-moss pt-5">
        <p className="label-utility flex items-center gap-2.5 text-vermilion-deep">
          <span aria-hidden="true" className="size-2 rotate-45 bg-vermilion" />
          The shortlist
        </p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4">
          <h2 className="font-display text-3xl font-bold tracking-editorial sm:text-4xl">
            Reading the city
          </h2>
          <p role="status" aria-live="polite" className="sr-only">
            {reducedMotion ? "Searching…" : `${STAGES[stageIndex]}…`}
          </p>
        </div>

        <ol aria-hidden="true" className="mt-6 flex max-w-2xl items-center">
          {STAGES.map((stage, index) => {
            const reached = reducedMotion || index <= stageIndex;
            const current = !reducedMotion && index === stageIndex;
            return (
              <li key={stage} className="flex flex-1 items-center last:flex-none">
                <span className="relative flex flex-col items-start">
                  <span
                    className={`block size-4 transition-all duration-300 motion-reduce:transition-none ${
                      current
                        ? "rotate-45 bg-vermilion ring-4 ring-vermilion/20"
                        : reached
                          ? "rounded-full border-4 border-moss bg-paper-soft"
                          : "rounded-full border-4 border-line-strong bg-paper"
                    }`}
                  />
                  <span
                    className={`absolute top-6 left-0 text-[12px] font-semibold whitespace-nowrap transition-colors duration-300 ${
                      reached ? "text-ink" : "text-stone"
                    }`}
                  >
                    {stage}
                  </span>
                </span>
                {index < STAGES.length - 1 && (
                  <span className="relative mx-1 h-1.5 flex-1 bg-line">
                    <span
                      className={`absolute inset-y-0 left-0 bg-moss ${
                        reducedMotion || index < stageIndex
                          ? "w-full"
                          : index === stageIndex
                            ? "w-full animate-[line-fill_1600ms_linear]"
                            : "w-0"
                      }`}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div
        aria-hidden="true"
        className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)]"
      >
        <div className="skeleton hidden aspect-[1000/720] border border-line lg:block" />
        <div>
          <div className="border border-line">
            <div className="skeleton h-8 border-b border-line" />
            <div className="space-y-3 px-5 py-6">
              <div className="skeleton h-9 w-2/3" />
              <div className="skeleton h-4 w-1/3" />
              <div className="skeleton mt-5 h-16 w-full" />
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-4 w-3/5" />
            </div>
          </div>

          <div className="mt-6 divide-y divide-line border-y border-line">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-4 px-4 py-4">
                <div className="skeleton h-4 w-6" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-5 w-1/2" />
                  <div className="skeleton h-3 w-4/5" />
                </div>
                <div className="skeleton hidden h-10 w-10 rounded-full sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
