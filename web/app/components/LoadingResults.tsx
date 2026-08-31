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
    const handle = setInterval(() => {
      setStageIndex((index) => (index + 1) % STAGES.length);
    }, 1600);
    return () => clearInterval(handle);
  }, [reducedMotion]);

  return (
    <section aria-label="Searching for neighborhoods" className="mt-14">
      <div className="border-t-2 border-ink pt-5">
        <p className="label-utility text-vermilion-deep">The shortlist</p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4">
          <h2 className="font-serif text-3xl font-medium tracking-editorial sm:text-4xl">
            Reading the city
          </h2>
          <p role="status" aria-live="polite" className="font-mono text-[12px] text-ink-muted">
            {reducedMotion ? "Searching…" : `${STAGES[stageIndex]}…`}
          </p>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)]"
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
