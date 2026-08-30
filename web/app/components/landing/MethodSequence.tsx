"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { DestinationMark } from "../icons";
import { EXAMPLE_SEARCH } from "./tokyo-localities";

/**
 * The three moves a search makes — each shown, not described.
 *
 * The steps deliberately do not share a layout. A row of three identical
 * cards would say the moves are interchangeable; they are not. Each gets
 * the device that fits it: a committed destination, the engine's own
 * exclusion arithmetic, and a real recommendation. Every figure below
 * comes from one real `/v1/optimize` call, frozen at build time.
 */

const YEN = (value: number) => `¥${Math.round(value / 1000)}k`;

export function MethodSequence() {
  const { funnel, topResult } = EXAMPLE_SEARCH;

  return (
    <ol className="mt-12 space-y-px">
      <Step
        step="01"
        title="Say where you have to be"
        body="A station, an office, a campus — anywhere with a name. The guide works backwards from the one point in your week that is not negotiable, and the morning you have to make it by."
      >
        {/* The committed-destination state, as the form actually renders it. */}
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
        step="02"
        title="Set the limits you actually have"
        body="A budget, a layout, a commute you can stand twice a day. These are hard filters — an area that misses one is out — and the guide always tells you how many that cost you."
      >
        <Funnel
          considered={funnel.considered}
          excluded={[
            { label: `Over ${EXAMPLE_SEARCH.maxCommuteMinutes} min`, count: funnel.excludedByCommute },
            { label: "Over budget", count: funnel.excludedByRent },
            { label: "No rail route", count: funnel.excludedByDisconnected },
          ]}
          qualified={funnel.qualified}
          shortlisted={funnel.shortlisted}
        />
      </Step>

      <Step
        step="03"
        title="Read the shortlist, and the compromise"
        body="Every recommendation arrives with what it costs you, not just what it offers — the weakest component named, the confidence stated, and the date the data was collected."
      >
        {/* The actual top result, rendered the way the shortlist renders it. */}
        <div className="border border-line-strong bg-paper">
          <p className="label-utility border-b border-line px-4 py-2 text-vermilion-deep">
            <span className="font-mono tracking-normal">01</span>
            <span className="mx-2 text-line-strong" aria-hidden="true">
              /
            </span>
            Best overall fit
          </p>
          <div className="px-4 py-4">
            <div className="flex items-baseline justify-between gap-4">
              <p lang="ja" className="font-serif text-[26px] leading-none tracking-editorial">
                {topResult.nameJa}
              </p>
              <p className="font-serif text-[22px] tnum">
                {topResult.score}
                <span className="ml-1 font-sans text-[11px] text-ink-muted">/ 100</span>
              </p>
            </div>
            <p className="mt-1 text-[12px] text-ink-muted">{topResult.wardNameEn}-ku</p>
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

/**
 * One step: prose on the left, its evidence on the right, hairline between.
 * The alternating emphasis comes from the device, not from a shared frame.
 */
function Step({
  step,
  title,
  body,
  children,
}: {
  readonly step: string;
  readonly title: string;
  readonly body: string;
  readonly children: React.ReactNode;
}) {
  return (
    <li className="border-t border-line py-8 last:border-b lg:py-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-14">
        <div className="flex gap-5">
          <span className="font-mono text-[12px] text-vermilion-deep">{step}</span>
          <div>
            <h3 className="font-serif text-[1.6rem] leading-snug font-medium tracking-editorial text-balance sm:text-[1.9rem]">
              {title}
            </h3>
            <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-ink-muted">{body}</p>
          </div>
        </div>
        <div className="lg:pt-1">{children}</div>
      </div>
    </li>
  );
}

/**
 * The engine's exclusion arithmetic, drawn to scale.
 *
 * This is the one place a bar chart earns its keep on this page: the point
 * is the proportion — how much of the city a single commute cap removes —
 * and a proportion is what a bar is for. Bars grow once, when scrolled to.
 */
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
      <p className="label-utility text-[10px] text-ink-muted">
        This example, area by area
      </p>
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
        {qualified.toLocaleString("en-US")} areas cleared every limit. The guide ranks those and
        returns the best <span className="font-medium text-ink">{shortlisted}</span>.
      </p>
    </div>
  );
}
