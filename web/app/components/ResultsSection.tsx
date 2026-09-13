"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";

import type { NeighborhoodResult, OptimizeResponse } from "@tokyo/shared";

import { deriveResultsSummary, formatYenFull } from "../../lib/format";
import { ChevronDownIcon } from "./icons";
import { ComparisonTable } from "./ComparisonTable";
import { EmptyResults } from "./EmptyResults";
import { FeaturedResult } from "./FeaturedResult";
import { NeighborhoodDetail } from "./NeighborhoodDetail";
import { ResultRow } from "./ResultRow";
import { ResultsMap } from "./ResultsMap";

const MAX_COMPARED = 3;

export function ResultsSection({
  response,
  destinationLabel,
  destinationCoords,
  searchSummary,
  headingRef,
}: {
  readonly response: OptimizeResponse;
  readonly destinationLabel: string | null;
  readonly destinationCoords: { readonly lat: number; readonly lon: number } | null;
  readonly searchSummary: string;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const [selectedResult, setSelectedResult] = useState<NeighborhoodResult | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);

  const [comparedIds, setComparedIds] = useState<readonly string[]>([]);

  const toggleCompared = useCallback((result: NeighborhoodResult, compared: boolean) => {
    setComparedIds((current) =>
      compared
        ? current.includes(result.localityId) || current.length >= MAX_COMPARED
          ? current
          : [...current, result.localityId]
        : current.filter((id) => id !== result.localityId),
    );
  }, []);

  const { results } = response;
  const pattern = deriveResultsSummary(results, destinationLabel);
  const [featured, ...rest] = results;

  const comparedResults = results.filter((result) => comparedIds.includes(result.localityId));
  const compareFull = comparedResults.length >= MAX_COMPARED;

  if (results.length === 0) {
    return <EmptyResults response={response} headingRef={headingRef} />;
  }

  return (
    <section aria-labelledby="results-heading" className="mt-14">
      <div className="border-t-2 border-ink pt-5">
        <p className="label-utility text-vermilion-deep">The shortlist</p>
        <h2
          id="results-heading"
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 max-w-2xl font-serif text-3xl leading-tight font-medium tracking-editorial text-balance outline-none sm:text-4xl"
        >
          {results.length} neighborhood{results.length === 1 ? "" : "s"} fit your search
        </h2>
        {pattern && (
          <p className="mt-2 max-w-2xl font-serif text-[17px] leading-snug text-ink-muted italic">
            {pattern}
          </p>
        )}
        <p className="mt-3 font-mono text-[11px] text-ink-muted">{searchSummary}</p>
      </div>

      <AnimatePresence initial={false}>
        {comparedResults.length > 0 && (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <ComparisonTable
              results={comparedResults}
              onRemove={(localityId) =>
                setComparedIds((current) => current.filter((id) => id !== localityId))
              }
              onClear={() => setComparedIds([])}
              headingId="comparison-heading"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 lg:hidden">
        <div className="border border-line-strong">
          <div className={`relative overflow-hidden ${mapExpanded ? "h-[68vh]" : "h-64"}`}>
            <ResultsMap
              results={results}
              destination={
                destinationCoords && destinationLabel
                  ? { ...destinationCoords, label: destinationLabel }
                  : null
              }
              highlightedId={highlightedId}
              onHighlight={setHighlightedId}
              onSelect={setSelectedResult}
              expanded={mapExpanded}
            />
          </div>
          <button
            type="button"
            aria-expanded={mapExpanded}
            onClick={() => setMapExpanded((expanded) => !expanded)}
            className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-line bg-paper-soft text-[12px] font-semibold tracking-[0.08em] uppercase"
          >
            {mapExpanded ? "Collapse map" : "Expand map"}
            <ChevronDownIcon
              className={`size-3.5 transition-transform duration-200 motion-reduce:transition-none ${mapExpanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)] lg:items-start">
        <div className="sticky top-20 hidden lg:block">
          <div className="relative aspect-[1000/720] overflow-hidden border border-line-strong">
            <ResultsMap
              results={results}
              destination={
                destinationCoords && destinationLabel
                  ? { ...destinationCoords, label: destinationLabel }
                  : null
              }
              highlightedId={highlightedId}
              onHighlight={setHighlightedId}
              onSelect={setSelectedResult}
              expanded
            />
          </div>
          <div className="mt-2 flex items-start justify-between gap-5 text-[11px] leading-relaxed text-ink-muted">
            <p className="max-w-xl">
              Locality boundaries from public data. Hover, focus, or select a numbered marker to
              connect it with the ranked list.
            </p>
            <p className="hidden shrink-0 font-mono text-[9px] tracking-[0.08em] text-stone uppercase xl:block">
              Geographic centroids · displaced pins use leaders
            </p>
          </div>
        </div>

        <div>
          {featured && (
            <FeaturedResult
              result={featured}
              destinationLabel={destinationLabel}
              highlighted={highlightedId === featured.localityId}
              compared={comparedIds.includes(featured.localityId)}
              compareFull={compareFull}
              onCompare={toggleCompared}
              onHighlight={setHighlightedId}
              onOpen={setSelectedResult}
            />
          )}
          {rest.length > 0 && (
            <ol className="mt-6 divide-y divide-line border-y border-line">
              {rest.map((result) => (
                <ResultRow
                  key={result.localityId}
                  result={result}
                  highlighted={highlightedId === result.localityId}
                  compared={comparedIds.includes(result.localityId)}
                  compareFull={compareFull}
                  onCompare={toggleCompared}
                  onHighlight={setHighlightedId}
                  onOpen={setSelectedResult}
                />
              ))}
            </ol>
          )}
        </div>
      </div>

      {selectedResult && (
        <NeighborhoodDetail
          result={selectedResult}
          destinationLabel={destinationLabel}
          onClose={() => setSelectedResult(null)}
        />
      )}
    </section>
  );
}

export function buildSearchSummary(
  destinationLabel: string | null,
  arrivalTime: string,
  maxCommuteMinutes: number,
  monthlyBudgetYen: number,
  layoutLabel: string,
): string {
  return [
    destinationLabel ? `to ${destinationLabel}` : null,
    `arrive ${arrivalTime}`,
    `≤ ${maxCommuteMinutes} min`,
    `${formatYenFull(monthlyBudgetYen)} / month`,
    layoutLabel,
  ]
    .filter(Boolean)
    .join("  ·  ");
}
