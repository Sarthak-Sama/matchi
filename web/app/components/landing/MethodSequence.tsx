"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { bilingualLabel, wardDisplayName } from "../../../lib/format";
import { DestinationMark } from "../icons";
import { StationNumber } from "../StationNumber";
import { EXAMPLE_SEARCH } from "./tokyo-localities";

const YEN = (value: number) => `¥${Math.round(value / 1000)}k`;

export function MethodSequence() {
  const { funnel, topResult } = EXAMPLE_SEARCH;

  return (
    <ol className="relative mt-12">
      <Step
        marker="depart"
        title="Say where you have to be"
        body="A station, an office, a campus — anywhere with a name. Matchi works backwards from the one point in your week that is not negotiable, and the morning you have to make it by."
      >
        <div className="flex min-h-13 items-center gap-3 border border-moss bg-paper px-4 py-2.5">
          <span className="text-vermilion">
            <DestinationMark />
          </span>
          <span className="min-w-0 flex-1">
            <span lang="ja" className="block text-[15px] font-medium">
              {EXAMPLE_SEARCH.destinationNameJa}
            </span>
            <span className="label-utility mt-0.5 block text-[10px] text-ink-muted">
              Station — selected
            </span>
          </span>
          <span className="font-mono text-[11px] text-ink-muted tnum">
            {EXAMPLE_SEARCH.arrivalTime}
          </span>
        </div>
      </Step>

      <Step
        marker="stop"
        title="Set the limits you actually have"
        body="A budget, a layout, a commute you can stand twice a day. These are hard filters — an area that misses one is out — and Matchi always tells you how many that cost you."
      >
        <Funnel
          considered={funnel.considered}
          excluded={[
            {
              label: `Over ${EXAMPLE_SEARCH.maxCommuteMinutes} min`,
              count: funnel.excludedByCommute,
            },
            { label: "Over budget", count: funnel.excludedByRent },
            { label: "No rail route", count: funnel.excludedByDisconnected },
          ]}
          qualified={funnel.qualified}
          shortlisted={funnel.shortlisted}
        />
      </Step>

      <Step
        marker="arrive"
        title="Read the shortlist, and the compromise"
        body="Every recommendation arrives with what it costs you, not just what it offers — the weakest component named, the confidence stated, and the date the data was collected."
      >
        <div className="border border-line-strong bg-paper">
          <p className="label-utility flex items-center gap-3 border-b border-line px-4 py-2.5 text-vermilion-deep">
            <StationNumber code="01" size="sm" line={null} />
            Best overall fit
          </p>
          <div className="px-4 py-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-display text-[24px] leading-[1.05] font-bold tracking-editorial">
                {bilingualLabel(topResult.nameEn, topResult.nameJa)}
              </p>
              <p className="shrink-0 font-display text-[24px] font-bold whitespace-nowrap tnum">
                {topResult.score}
                <span className="ml-1 font-sans text-[11px] text-ink-muted">/ 100</span>
              </p>
            </div>
            <p className="mt-1 text-[12px] text-ink-muted">
              {wardDisplayName(topResult.wardNameEn)}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 border-y border-line py-2.5 text-[14px]">
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-muted">Commute</dt>
                <dd className="font-medium tnum">{topResult.commuteMinutes} min</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-muted">Rent</dt>
                <dd className="font-medium tnum">
                  {YEN(topResult.rentLowYen)}–{YEN(topResult.rentHighYen)}
                </dd>
              </div>
            </dl>
            <p className="mt-2.5 text-[13px] leading-snug">
              <span aria-hidden="true" className="font-semibold text-moss">
                +
              </span>{" "}
              <span className="text-ink-muted">{topResult.strength}</span>
            </p>
            <p className="mt-1 text-[13px] leading-snug">
              <span aria-hidden="true" className="font-semibold text-brick">
                −
              </span>{" "}
              <span className="text-ink-muted">
                {topResult.weakest.label} is the weakest component ({topResult.weakest.score}/100)
              </span>
            </p>
          </div>
        </div>
      </Step>
    </ol>
  );
}

function Step({
  marker,
  title,
  body,
  children,
}: {
  readonly marker: "depart" | "stop" | "arrive";
  readonly title: string;
  readonly body: string;
  readonly children: React.ReactNode;
}) {
  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-x-6">
      {/* The route line: one continuous green track threading the three steps. */}
      <span aria-hidden="true" className="relative flex justify-center">
        <span
          className={`absolute w-1.5 bg-moss ${
            marker === "depart" ? "top-3 bottom-0" : marker === "arrive" ? "top-0 h-3" : "inset-y-0"
          }`}
        />
        {marker === "arrive" ? (
          <span className="relative mt-1 size-5 rotate-45 bg-vermilion ring-4 ring-paper-soft" />
        ) : (
          <span className="relative mt-1 size-5 rounded-full border-[5px] border-moss bg-paper-soft" />
        )}
      </span>
      <div className="grid gap-6 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-14 lg:pb-16">
        <div>
          <h3 className="font-display text-[1.55rem] leading-[1.1] font-bold tracking-editorial text-balance sm:text-[1.9rem]">
            {title}
          </h3>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-muted">{body}</p>
        </div>
        <div className="lg:pt-1">{children}</div>
      </div>
    </li>
  );
}

function Funnel({
  considered,
  excluded,
  qualified,
  shortlisted,
}: {
  readonly considered: number;
  readonly excluded: readonly { readonly label: string; readonly count: number }[];
  readonly qualified: number;
  readonly shortlisted: number;
}) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const bars = [
    { label: `All areas`, count: considered, tone: "bg-stone" },
    ...excluded
      .filter((row) => row.count > 0)
      .map((row) => ({ label: row.label, count: row.count, tone: "bg-brick/70" })),
    { label: "Cleared every limit", count: qualified, tone: "bg-moss" },
  ];

  return (
    <div ref={ref} className="border border-line-strong bg-paper px-4 py-4">
      <p className="label-utility text-[10px] text-ink-muted">This example, area by area</p>
      <dl className="mt-3 space-y-2.5">
        {bars.map((bar, index) => (
          <div key={bar.label}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <dt className="text-ink-muted">{bar.label}</dt>
              <dd className="font-medium tnum">{bar.count.toLocaleString("en-US")}</dd>
            </div>
            <div aria-hidden="true" className="mt-1 h-1.5 w-full bg-line">
              <motion.div
                className={`h-full ${bar.tone}`}
                initial={{ scaleX: reducedMotion ? bar.count / considered : 0 }}
                animate={{ scaleX: shown ? bar.count / considered : 0 }}
                style={{ transformOrigin: "left" }}
                transition={{
                  duration: reducedMotion ? 0 : 0.6,
                  delay: reducedMotion ? 0 : 0.08 * index,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
              />
            </div>
          </div>
        ))}
      </dl>
      <p className="mt-3.5 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-muted">
        {qualified.toLocaleString("en-US")} areas cleared every limit. Matchi ranks those and
        returns the best <span className="font-medium text-ink">{shortlisted}</span>.
      </p>
    </div>
  );
}
