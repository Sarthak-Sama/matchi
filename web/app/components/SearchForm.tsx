"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import type { Layout } from "@tokyo/shared";
import { LAYOUT_IDS, LAYOUTS } from "@tokyo/shared";

import type { OptimizeSearch } from "../../lib/useOptimizeSearch";
import { ApiClientError } from "../../lib/api";
import { ArrowRightIcon, ChevronDownIcon } from "./icons";
import { DestinationField } from "./DestinationField";
import { LifestylePicker } from "./LifestylePicker";
import { SegmentedControl } from "./SegmentedControl";
import { TimePicker } from "./TimePicker";

export function SearchForm({ search }: { search: OptimizeSearch }) {
  const [prioritiesOpen, setPrioritiesOpen] = useState(true);
  const [maxCommuteText, setMaxCommuteText] = useState(String(search.maxCommuteMinutes));
  const [monthlyBudgetText, setMonthlyBudgetText] = useState(String(search.monthlyBudgetYen));
  const [editingMaxCommute, setEditingMaxCommute] = useState(false);
  const [editingMonthlyBudget, setEditingMonthlyBudget] = useState(false);
  const reducedMotion = useReducedMotion();
  const selectedPriorityCount = Object.values(search.preferences).filter(
    (value) => value !== undefined,
  ).length;
  const homeComplete =
    search.monthlyBudgetYen > 0 && search.maxCommuteMinutes >= 5 && search.maxCommuteMinutes <= 180;

  useEffect(() => {
    if (search.response) setPrioritiesOpen(false);
  }, [search.response]);

  useEffect(() => {
    if (!editingMaxCommute) setMaxCommuteText(String(search.maxCommuteMinutes));
  }, [editingMaxCommute, search.maxCommuteMinutes]);

  useEffect(() => {
    if (!editingMonthlyBudget) setMonthlyBudgetText(String(search.monthlyBudgetYen));
  }, [editingMonthlyBudget, search.monthlyBudgetYen]);

  const layoutDef = LAYOUTS[search.layout];

  return (
    <form role="search" aria-label="Neighborhood search" onSubmit={search.handleSubmit}>
      <div className="mb-7 border-b border-line pb-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="label-utility text-vermilion-deep">Your Tokyo brief</p>
            <p className="mt-1 font-serif text-[17px] tracking-editorial text-ink-muted">
              Three decisions. One considered shortlist.
            </p>
          </div>
          <ol className="flex gap-4" aria-label="Search brief progress">
            <BriefStatus index="1" label="Place" complete={search.selectedDestination !== null} />
            <BriefStatus index="2" label="Home" complete={homeComplete} />
            <BriefStatus index="3" label="Life" complete={selectedPriorityCount > 0} optional />
          </ol>
        </div>
      </div>
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
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <span id="arrivalTime-label" className="label-utility text-ink">
              Arrive by
            </span>
            <TimePicker
              id="arrivalTime"
              value={search.arrivalTime}
              onChange={search.setArrivalTime}
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
                value={maxCommuteText}
                onFocus={() => setEditingMaxCommute(true)}
                onBlur={() => setEditingMaxCommute(false)}
                onChange={(event) => {
                  const value = event.target.value;
                  setMaxCommuteText(value);
                  if (value !== "") search.setMaxCommuteMinutes(Number(value));
                }}
                required
                className="field-control min-h-12 w-full px-3 py-2.5 pr-14 text-[15px] tnum"
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

      <fieldset className="mt-8">
        <legend className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-vermilion-deep">02</span>
          <span className="font-serif text-xl font-medium tracking-editorial">The home</span>
        </legend>
        <div className="mt-4">
          <label htmlFor="monthlyBudgetYen" className="label-utility text-ink">
            Monthly budget, all-in (rent + commute)
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
              value={monthlyBudgetText}
              onFocus={() => setEditingMonthlyBudget(true)}
              onBlur={() => setEditingMonthlyBudget(false)}
              onChange={(event) => {
                const value = event.target.value;
                setMonthlyBudgetText(value);
                if (value !== "") search.setMonthlyBudgetYen(Number(value));
              }}
              required
              className="field-control min-h-12 w-full py-2.5 pr-3 pl-7 text-[15px] tnum"
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
              wideColumns={7}
            />
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">
            Rent is modeled for a {layoutDef.minSqm}–{layoutDef.maxSqm} m² {layoutDef.label}.
          </p>
        </div>
      </fieldset>

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
        <AnimatePresence initial={false}>
          {prioritiesOpen && (
            <motion.div
              id="priorities-panel"
              className="mt-3 overflow-hidden"
              initial={reducedMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <LifestylePicker preferences={search.preferences} onChange={search.setPreferences} />
            </motion.div>
          )}
        </AnimatePresence>
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
        <motion.button
          type="submit"
          disabled={search.isLoading}
          whileHover={reducedMotion || search.isLoading ? undefined : "hover"}
          whileTap={reducedMotion || search.isLoading ? undefined : { scale: 0.988 }}
          className="group flex min-h-13 w-full items-center justify-between gap-3 bg-moss px-5 py-4 text-[15px] font-semibold text-white transition-colors hover:bg-moss-deep disabled:cursor-wait disabled:opacity-70 sm:w-auto sm:min-w-72"
        >
          {search.isLoading ? "Reading the city…" : "Find my Matchi"}
          <motion.span
            className="inline-flex"
            variants={{ hover: { x: 5 } }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <ArrowRightIcon />
          </motion.span>
        </motion.button>
        <p className="mt-3 max-w-md text-[12px] leading-relaxed text-ink-muted">
          Recommendations use modeled rent, transit, safety, and amenity data — not live listings.
        </p>
      </div>
    </form>
  );
}

function BriefStatus({
  index,
  label,
  complete,
  optional = false,
}: {
  readonly index: string;
  readonly label: string;
  readonly complete: boolean;
  readonly optional?: boolean;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <li className="flex items-center gap-1.5 text-[10px] text-ink-muted">
      <motion.span
        aria-hidden="true"
        className={`size-1.5 ${complete ? "bg-vermilion" : "bg-line-strong"}`}
        animate={{ scale: complete && !reducedMotion ? [1, 1.7, 1] : 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.3 }}
      />
      <span className="font-mono">{index}</span>
      <span>{label}</span>
      <span className="sr-only">
        {complete ? "— complete" : optional ? "— optional" : "— incomplete"}
      </span>
    </li>
  );
}

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
