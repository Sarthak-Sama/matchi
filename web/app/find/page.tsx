"use client";

import { useEffect, useRef } from "react";

import { LAYOUTS } from "@tokyo/shared";

import { useOptimizeSearch } from "../../lib/useOptimizeSearch";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";
import { HeroMapFragment } from "../components/HeroMapFragment";
import { LoadingResults } from "../components/LoadingResults";
import { Masthead } from "../components/Masthead";
import { MethodologyFooter } from "../components/MethodologyFooter";
import { ResultsSection, buildSearchSummary } from "../components/ResultsSection";
import { SearchForm } from "../components/SearchForm";

export default function Home() {
  const search = useOptimizeSearch();
  const reducedMotion = usePrefersReducedMotion();
  const resultsRegionRef = useRef<HTMLDivElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (search.isLoading) {
      resultsRegionRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  }, [search.isLoading, reducedMotion]);

  useEffect(() => {
    if (search.response) {
      resultsHeadingRef.current?.focus({ preventScroll: true });
      resultsRegionRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  }, [search.response, reducedMotion]);

  const response = search.response;
  const searchSummary = response
    ? buildSearchSummary(
        search.resultDestinationLabel,
        response.request.arrivalTime,
        response.request.maxCommuteMinutes,
        response.request.monthlyBudgetYen,
        LAYOUTS[response.request.layout].label,
      )
    : "";

  return (
    <div id="top" className="min-h-screen">
      <Masthead />

      <main>
        {}
        <div className="mx-auto max-w-[1360px] px-5 pt-10 pb-14 sm:px-8 lg:pt-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,10fr)_minmax(0,11fr)] lg:gap-14">
            <div>
              <p className="label-utility text-vermilion-deep">Meet your Matchi.</p>
              <h1 className="mt-4 max-w-xl font-serif text-[2.6rem] leading-[1.02] font-medium tracking-editorial text-balance sm:text-6xl">
                Find the Tokyo neighborhood that fits your life.
              </h1>
              <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-muted">
                Compare commute, rent, and everyday rhythm — quiet streets, groceries, late nights —
                not just listings. Tell the guide where you need to be; it will show you where you
                could live.
              </p>

              {}
              <figure className="mt-10 hidden border border-line-strong lg:block">
                <div className="aspect-[62/56] overflow-hidden bg-paper-soft">
                  <HeroMapFragment />
                </div>
                <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line px-3 py-2">
                  <span className="text-[12px] text-ink-muted">
                    The 23 special wards, and where the guide looks.
                  </span>
                  <span className="font-mono text-[10px] text-stone">
                    35.69&deg; N / 139.69&deg; E
                  </span>
                </figcaption>
              </figure>
            </div>

            <div className="border border-line-strong bg-paper-soft px-5 py-6 sm:px-8 sm:py-7">
              <SearchForm search={search} />
            </div>
          </div>
        </div>

        {}
        <div ref={resultsRegionRef} className="mx-auto max-w-[1360px] scroll-mt-16 px-5 sm:px-8">
          {search.isLoading && <LoadingResults />}
          {!search.isLoading && response && (
            <ResultsSection
              response={response}
              destinationLabel={search.resultDestinationLabel}
              destinationCoords={search.destinationCoords}
              searchSummary={searchSummary}
              headingRef={resultsHeadingRef}
            />
          )}
        </div>
      </main>

      <div className="mt-4">
        <MethodologyFooter response={response} />
      </div>
    </div>
  );
}
