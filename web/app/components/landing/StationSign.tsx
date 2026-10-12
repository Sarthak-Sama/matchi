"use client";

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { wardDisplayName } from "../../../lib/format";
import { ArrowRightIcon } from "../icons";
import { StationNumber } from "../StationNumber";
import { EXAMPLE_SEARCH, type ShortlistStop } from "./tokyo-localities";

const STOPS = EXAMPLE_SEARCH.shortlist;
const SWIPE_THRESHOLD_PX = 48;
const ARRIVE = [0.16, 1, 0.3, 1] as const;

const yenK = (value: number) => `¥${Math.round(value / 1000)}k`;
const stopCode = (index: number) => String(index + 1).padStart(2, "0");

/**
 * The landing page's focal point: a Tokyo station-name board (駅名標) for
 * "the Matchi line" — the example search's shortlist, ranked, one stop per
 * area. Step along it with the band's arrows, the route strip, arrow keys,
 * or a swipe. The terminus behind stop 01 is the destination itself; past
 * the last stop the line runs on into the reader's own search.
 */
export function StationSign() {
  const reducedMotion = useReducedMotion();
  const [{ index, direction }, setState] = useState({ index: 0, direction: 1 });
  const [streak, setStreak] = useState(0);

  const stop = STOPS[index];
  const previous = STOPS[index - 1];
  const next = STOPS[index + 1];

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= STOPS.length || target === index) return;
      setState({ index: target, direction: target > index ? 1 : -1 });
      setStreak((count) => count + 1);
    },
    [index],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") goTo(index + 1);
    else if (event.key === "ArrowLeft") goTo(index - 1);
    else if (event.key === "Home") goTo(0);
    else if (event.key === "End") goTo(STOPS.length - 1);
    else return;
    event.preventDefault();
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD_PX) goTo(index + 1);
    else if (info.offset.x > SWIPE_THRESHOLD_PX) goTo(index - 1);
  };

  if (!stop) return null;

  return (
    <figure className="m-0">
      <RouteStrip current={index} onSelect={goTo} />

      <div
        role="group"
        aria-roledescription="station sign"
        aria-label="The Matchi line: the example search's shortlist, one stop per area. Use the left and right arrow keys to move between stops."
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="group/sign relative mt-3 overflow-hidden border border-ink/80 bg-paper-soft shadow-[0_1px_0_#fff_inset,0_18px_40px_-28px_rgb(14_26_19/0.55)] outline-offset-4"
      >
        {/* Top rail: line identity, terminus, match score. */}
        <div className="flex items-start justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-center gap-3">
            <StationNumber code={stopCode(index)} size="lg" />
            <div className="leading-tight">
              <p className="label-utility text-[10px] text-ink-muted">Matchi line</p>
              <p className="mt-0.5 text-[13px] font-semibold">
                <span lang="ja">{EXAMPLE_SEARCH.destinationNameJa}</span>
                <span className="ml-1 font-normal text-ink-muted">
                  方面 · for Shibuya by {EXAMPLE_SEARCH.arrivalTime}
                </span>
              </p>
            </div>
          </div>
          <MatchScore score={stop.score} />
        </div>

        {/* The name itself — the reason a sign exists. */}
        <motion.div
          className="relative cursor-grab touch-pan-y px-4 pt-6 pb-5 text-center select-none active:cursor-grabbing sm:px-6 sm:pt-8 sm:pb-6"
          drag={reducedMotion ? false : "x"}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.18}
          onDragEnd={onDragEnd}
        >
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={stop.nameJa}
              custom={direction}
              variants={{
                enter: (dir: number) =>
                  reducedMotion
                    ? { opacity: 0 }
                    : { x: `${dir * 38}%`, opacity: 0, filter: "blur(10px)" },
                center: { x: "0%", opacity: 1, filter: "blur(0px)" },
                exit: (dir: number) =>
                  reducedMotion
                    ? { opacity: 0 }
                    : { x: `${dir * -38}%`, opacity: 0, filter: "blur(10px)" },
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reducedMotion ? 0.12 : 0.55, ease: ARRIVE }}
            >
              <p
                lang="ja"
                className="font-display text-[clamp(3.6rem,10.5vw,7.4rem)] leading-[0.95] font-bold tracking-[0.14em] [text-indent:0.14em]"
              >
                {stop.nameJa}
              </p>
              <p className="mt-3 font-display text-[clamp(1.25rem,2.6vw,1.9rem)] leading-none font-semibold tracking-[0.02em]">
                {stop.nameEn}
              </p>
              <p className="mt-2 text-[13px] text-ink-muted">
                {wardDisplayName(stop.wardNameEn)}
                <span className="mx-1.5 text-line-strong" aria-hidden="true">
                  ·
                </span>
                <span lang="ja">{stop.wardNameJa}</span>
              </p>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          Stop {index + 1} of {STOPS.length}: {stop.nameEn}, {wardDisplayName(stop.wardNameEn)}.
          Match {stop.score} of 100, {stop.commuteMinutes} minutes to Shibuya, rent{" "}
          {yenK(stop.rentLowYen)} to {yenK(stop.rentHighYen)}.
        </p>

        <StopFacts stop={stop} />

        {/* The line band: neighbours on either side, as on every real board. */}
        <div className="relative grid grid-cols-2 bg-moss text-paper-soft">
          <AnimatePresence>
            {!reducedMotion && streak > 0 && (
              <motion.span
                key={streak}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                initial={{ left: direction > 0 ? "100%" : "-33%" }}
                animate={{ left: direction > 0 ? "-33%" : "100%" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            )}
          </AnimatePresence>

          {previous ? (
            <BandButton side="previous" stop={previous} onClick={() => goTo(index - 1)} />
          ) : (
            <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
              <TerminusMark />
              <span className="leading-tight">
                <span lang="ja" className="block text-[15px] font-bold">
                  {EXAMPLE_SEARCH.destinationNameJa}
                </span>
                <span className="block text-[11px] text-sage">
                  Terminus<span className="hidden sm:inline"> · your destination</span>
                </span>
              </span>
            </div>
          )}

          {next ? (
            <BandButton side="next" stop={next} onClick={() => goTo(index + 1)} />
          ) : (
            <Link
              href="/find"
              className="group/end flex min-h-16 items-center justify-end gap-3 border-l border-white/15 bg-vermilion-deep px-4 text-right transition-colors hover:bg-vermilion sm:px-6"
            >
              <span className="leading-tight">
                <span className="block text-[15px] font-bold">Your stop</span>
                <span className="block text-[11px] text-white/80">Run your own search</span>
              </span>
              <ArrowRightIcon className="size-5 transition-transform duration-200 group-hover/end:translate-x-1 motion-reduce:transition-none" />
            </Link>
          )}
        </div>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        <span>
          Stop {index + 1} of {STOPS.length} — a real search, run against the live engine.
        </span>
        <span className="font-mono text-[10.5px] text-stone">
          ≤{EXAMPLE_SEARCH.maxCommuteMinutes}min · {yenK(EXAMPLE_SEARCH.monthlyBudgetYen)} ·{" "}
          {EXAMPLE_SEARCH.layout} · swipe or ← →
        </span>
      </figcaption>
    </figure>
  );
}

/** The train-door display above the sign: every stop, the current one marked. */
function RouteStrip({
  current,
  onSelect,
}: {
  readonly current: number;
  readonly onSelect: (index: number) => void;
}) {
  const reducedMotion = useReducedMotion();
  const fraction = current / (STOPS.length - 1);

  return (
    <div className="flex items-center gap-3">
      <span
        lang="ja"
        className="flex h-7 shrink-0 items-center gap-1.5 bg-ink px-2 text-[11px] font-bold text-paper-soft"
      >
        <span aria-hidden="true" className="size-2 rotate-45 bg-vermilion" />
        {EXAMPLE_SEARCH.destinationNameJa}
      </span>
      <ol className="relative flex flex-1 items-center justify-between" aria-label="Stops">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-line-strong/70"
        />
        <motion.span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-1 origin-left -translate-y-1/2 bg-moss"
          style={{ width: "100%" }}
          initial={false}
          animate={{ scaleX: fraction }}
          transition={{ duration: reducedMotion ? 0 : 0.5, ease: ARRIVE }}
        />
        {STOPS.map((stop, index) => {
          const isCurrent = index === current;
          const passed = index < current;
          return (
            <li key={stop.nameJa} className="relative">
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-label={`Stop ${index + 1}: ${stop.nameEn} (${stop.nameJa}), score ${stop.score}`}
                aria-current={isCurrent ? "step" : undefined}
                className="group/stop relative grid size-9 place-items-center"
              >
                <span
                  className={`block transition-all duration-300 motion-reduce:transition-none ${
                    isCurrent
                      ? "size-3.5 rotate-45 bg-vermilion ring-4 ring-vermilion/20"
                      : `size-3 rounded-full border-2 ${
                          passed ? "border-moss bg-moss" : "border-ink/60 bg-paper-soft"
                        } group-hover/stop:scale-125 group-hover/stop:border-ink`
                  }`}
                />
                <span
                  lang="ja"
                  className="pointer-events-none absolute top-full left-1/2 mt-0.5 hidden -translate-x-1/2 text-[10.5px] font-semibold whitespace-nowrap text-ink-muted opacity-0 transition-opacity group-hover/stop:opacity-100 group-focus-visible/stop:opacity-100 sm:block"
                >
                  {stop.nameJa}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MatchScore({ score }: { readonly score: number }) {
  return (
    <div className="text-right leading-none">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={score}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 10, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="font-display text-[34px] font-bold tnum sm:text-[40px]"
        >
          {score}
        </motion.p>
      </AnimatePresence>
      <p className="label-utility mt-1 text-[9.5px] whitespace-nowrap text-ink-muted">
        Match / 100
      </p>
    </div>
  );
}

function StopFacts({ stop }: { readonly stop: ShortlistStop }) {
  const facts = [
    {
      label: `To ${EXAMPLE_SEARCH.destinationNameJa}`,
      value: `${stop.commuteMinutes} min`,
      note:
        stop.transfers === 0
          ? "direct"
          : `${stop.transfers} transfer${stop.transfers > 1 ? "s" : ""}`,
    },
    {
      label: `Rent · ${EXAMPLE_SEARCH.layout}`,
      value: `${yenK(stop.rentLowYen)}–${yenK(stop.rentHighYen)}`,
      note: "modeled",
    },
    {
      label: "Nearest station",
      value: stop.stationJa ?? "—",
      note: stop.lineName ?? stop.stationEn ?? "",
      ja: true,
    },
  ];

  return (
    <dl className="grid grid-cols-3 border-t border-ink/15">
      {facts.map((fact) => (
        <div key={fact.label} className="border-l border-ink/10 px-3 py-3 first:border-l-0 sm:px-5">
          <dt className="label-utility text-[9px] text-ink-muted sm:text-[9.5px]">{fact.label}</dt>
          <dd
            lang={fact.ja ? "ja" : undefined}
            className="mt-1 truncate text-[14px] font-bold tnum sm:text-[17px]"
          >
            {fact.value}
            <span
              lang={fact.ja ? "ja" : undefined}
              className="ml-1.5 hidden text-[11px] font-medium text-ink-muted sm:inline"
            >
              {fact.note}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BandButton({
  side,
  stop,
  onClick,
}: {
  readonly side: "previous" | "next";
  readonly stop: ShortlistStop;
  readonly onClick: () => void;
}) {
  const isNext = side === "next";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${isNext ? "Next" : "Previous"} stop: ${stop.nameEn} (${stop.nameJa})`}
      className={`group/band flex min-h-16 items-center gap-3 px-4 transition-colors hover:bg-moss-deep sm:px-6 ${
        isNext ? "justify-end border-l border-white/15 text-right" : ""
      }`}
    >
      {!isNext && <BandArrow direction="previous" />}
      <span className="min-w-0 leading-tight">
        <span lang="ja" className="block truncate text-[15px] font-bold">
          {stop.nameJa}
        </span>
        <span className="block truncate text-[11px] text-sage">{stop.nameEn}</span>
      </span>
      {isNext && <BandArrow direction="next" />}
    </button>
  );
}

function BandArrow({ direction }: { readonly direction: "previous" | "next" }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-8 shrink-0 place-items-center bg-paper-soft text-moss transition-transform duration-200 motion-reduce:transition-none ${
        direction === "next"
          ? "group-hover/band:translate-x-1"
          : "rotate-180 group-hover/band:-translate-x-1"
      }`}
      style={{ clipPath: "polygon(0 0, 62% 0, 100% 50%, 62% 100%, 0 100%)" }}
    >
      <ArrowRightIcon className="size-4 -translate-x-0.5" />
    </span>
  );
}

function TerminusMark() {
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center">
      <span className="size-4 rotate-45 bg-vermilion ring-2 ring-paper-soft" />
    </span>
  );
}
