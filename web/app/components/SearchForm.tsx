"use client";

import { useEffect, useState } from "react";

import type { Layout } from "@tokyo/shared";
import { LAYOUT_IDS, LAYOUTS } from "@tokyo/shared";

import type { OptimizeSearch } from "../../lib/useOptimizeSearch";
import { ApiClientError } from "../../lib/api";
import { ArrowRightIcon, ChevronDownIcon } from "./icons";
import { DestinationField } from "./DestinationField";
import { LifestylePicker } from "./LifestylePicker";
import { SegmentedControl } from "./SegmentedControl";

/**
 * The search composition: journey (destination + arrival + max commute),
 * home (budget + layout), and everyday priorities behind progressive
 * disclosure. Progressive disclosure here means the priorities section
 * starts open for a first-time visitor and folds itself away once results
 * are on screen — the form never becomes a wizard.
 */
export function SearchForm({ search }: { search: OptimizeSearch }) {
  const [prioritiesOpen, setPrioritiesOpen] = useState(true);
  const selectedPriorityCount = Object.values(search.preferences).filter(
    (value) => value !== undefined,
  ).length;

  // Fold the priorities section once results arrive; reopen on demand.
  useEffect(() => {
    if (search.response) setPrioritiesOpen(false);
  }, [search.response]);

  const layoutDef = LAYOUTS[search.layout];

  return (
    <form role="search" aria-label="Neighborhood search" onSubmit={search.handleSubmit}>
      {/* 01 — The journey */}
      <fieldset id="search">
        <legend className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-vermilion-deep">01</span>
          <span className="font-serif text-xl font-medium tracking-editorial">The journey</span>
        </legend>
        <div className="mt-4">
          <DestinationField
            query={search.destQuery}
            selectedLabel={search.selectedDestination?.label ?? null}
            selectedKind={search.selectedDestination?.kind === "point" ? "point" : "station"}
            placeSuggestions={search.placeSuggestions}
            placesLoading={search.placesLoading}
            stationFallback={search.stationFallback}
            stationFallbackLoading={search.stationFallbackLoading}
            showStationFallback={search.showStationFallback}
            autocompleteFailed={search.autocompleteFailed}
            onEditQuery={search.editDestinationQuery}
            onClear={search.clearDestination}
            onSelectPlace={search.selectPlace}
            onSelectStation={search.selectFallbackStation}
            onRetry={search.retryAutocomplete}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="arrivalTime" className="label-utility text-ink">
              Arrive by
            </label>
            <input
              id="arrivalTime"
              type="time"
              value={search.arrivalTime}
              onChange={(event) => search.setArrivalTime(event.target.value)}
              required
              className="mt-2 min-h-12 w-full border border-line-strong bg-paper-soft px-3 py-2.5 text-[15px] tnum focus:border-ink focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="maxCommuteMinutes" className="label-utility text-ink">
              Max commute
            </label>
            <div className="relative mt-2">
              <input
                id="maxCommuteMinutes"
                type="number"
                min={5}
                max={180}
                step={5}
                value={search.maxCommuteMinutes}
                onChange={(event) => search.setMaxCommuteMinutes(Number(event.target.value))}
                required
                className="min-h-12 w-full border border-line-strong bg-paper-soft px-3 py-2.5 pr-14 text-[15px] tnum focus:border-ink focus:outline-none"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-ink-muted"
              >
                min
              </span>
            </div>
          </div>
        </div>
      </fieldset>

      {/* 02 — The home */}
      <fieldset className="mt-8">
        <legend className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-vermilion-deep">02</span>
          <span className="font-serif text-xl font-medium tracking-editorial">The home</span>
        </legend>
        <div className="mt-4">
          <label htmlFor="monthlyBudgetYen" className="label-utility text-ink">
            Monthly budget, all-in
          </label>
          <div className="relative mt-2">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[15px] text-ink-muted"
            >
              ¥
            </span>
            <input
              id="monthlyBudgetYen"
              type="number"
              min={1}
              max={10_000_000}
              step="any"
              value={search.monthlyBudgetYen}
              onChange={(event) => search.setMonthlyBudgetYen(Number(event.target.value))}
              required
              className="min-h-12 w-full border border-line-strong bg-paper-soft py-2.5 pr-3 pl-7 text-[15px] tnum focus:border-ink focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-4">
          <span id="layout-label" className="label-utility text-ink">
            Layout
          </span>
          <div className="mt-2">
            <SegmentedControl<Layout>
              legend="Apartment layout"
              value={search.layout}
              options={LAYOUT_IDS.map((id) => ({ value: id, label: LAYOUTS[id].label }))}
              onChange={search.setLayout}
              className="w-full sm:w-auto"
            />
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">
            Rent is modeled for a {layoutDef.minSqm}–{layoutDef.maxSqm} m² {layoutDef.label}.
          </p>
        </div>
      </fieldset>

      {/* 03 — Everyday priorities (progressive disclosure) */}
      <section className="mt-8" aria-labelledby="priorities-heading">
        <h3 id="priorities-heading">
          <button
            type="button"
            aria-expanded={prioritiesOpen}
            aria-controls="priorities-panel"
            onClick={() => setPrioritiesOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-vermilion-deep">03</span>
              <span className="font-serif text-xl font-medium tracking-editorial">
                Everyday priorities
              </span>
              {!prioritiesOpen && selectedPriorityCount > 0 && (
                <span className="label-utility text-[10px] text-ink-muted">
                  {selectedPriorityCount} selected
                </span>
              )}
            </span>
            <ChevronDownIcon
              className={`size-4 shrink-0 text-ink-muted transition-transform duration-200 motion-reduce:transition-none ${prioritiesOpen ? "rotate-180" : ""}`}
            />
          </button>
        </h3>
        {prioritiesOpen && (
          <div id="priorities-panel" className="mt-3">
            <LifestylePicker preferences={search.preferences} onChange={search.setPreferences} />
          </div>
        )}
      </section>

      {search.error && (
        <div role="alert" className="mt-6 border border-brick/40 bg-warning px-4 py-3">
          <p className="text-[14px] leading-relaxed font-medium text-brick">
            {search.error instanceof ApiClientError
              ? describeApiError(search.error).message
              : search.error.message}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
            {search.error instanceof ApiClientError
              ? describeApiError(search.error).recovery
              : "Your answers are unchanged — try again."}
          </p>
        </div>
      )}

      <div className="mt-8">
        <button
          type="submit"
          disabled={search.isLoading}
          className="flex min-h-13 w-full items-center justify-between gap-3 bg-moss px-5 py-4 text-[15px] font-semibold text-white transition-colors hover:bg-moss-deep disabled:cursor-wait disabled:opacity-70 sm:w-auto sm:min-w-72"
        >
          {search.isLoading ? "Reading the city…" : "Find my Matchi"}
          <ArrowRightIcon />
        </button>
        <p className="mt-3 max-w-md text-[12px] leading-relaxed text-ink-muted">
          Recommendations use modeled rent, transit, safety, and amenity data — not live listings.
        </p>
      </div>
    </form>
  );
}

/**
 * Plain-language rendering of API error codes, each paired with the one
 * thing worth doing next. The recovery line is per-code on purpose: a
 * blanket "check your connection" is wrong — and quietly misleading —
 * for a destination the data simply does not know about.
 */
function describeApiError(error: ApiClientError): {
  readonly message: string;
  readonly recovery: string;
} {
  switch (error.code) {
    case "NETWORK_ERROR":
      return {
        message: "The recommendation service could not be reached.",
        recovery: "Your answers are unchanged. Check your connection, then try again.",
      };
    case "NO_ACCESS_STATIONS":
      return {
        message: "No station in the data is within walking range of that destination.",
        recovery:
          "Pick the nearest station by name instead of the place itself, and the guide can estimate the ride.",
      };
    case "STATION_NOT_FOUND":
      return {
        message: "That destination is not in the transit data.",
        recovery:
          "Choose it again from the suggestions — a shared link can outlive the station record it points at.",
      };
    case "VALIDATION_ERROR":
      return {
        message: "One of the answers is out of range.",
        recovery: "Check the arrival time, budget, and maximum commute, then search again.",
      };
    default:
      return {
        message: error.message,
        recovery: "Your answers are unchanged — try again.",
      };
  }
}
