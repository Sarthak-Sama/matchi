"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { NarrowingPlate } from "./NarrowingPlate";
import { EXAMPLE_SEARCH, type ShortlistStop } from "./tokyo-localities";

const STOPS = EXAMPLE_SEARCH.shortlist;
const LATIN_NOISE = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const KANJI_NOISE = "東西南北中上下大小田町谷原台木本川橋森野山";
const FRAME_MS = 45;

const yenK = (value: number) => `¥${Math.round(value / 1000)}k`;

/**
 * The shortlist as a platform departure board, wired to the ward plate:
 * point at a row and the plate draws that area's line to the destination.
 */
export function DepartureBoard() {
  const [active, setActive] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const inView = useInView(boardRef, { once: true, amount: 0.3 });
  const activeStop = active === null ? null : STOPS[active];

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,9fr)_minmax(0,11fr)] lg:gap-12">
      <div className="lg:sticky lg:top-20">
        <NarrowingPlate
          showCaption={false}
          highlight={
            activeStop
              ? { x: activeStop.point.x, y: activeStop.point.y, label: activeStop.nameJa }
              : null
          }
        />
      </div>

      <div
        ref={boardRef}
        className="border-[6px] border-board-line bg-board text-led shadow-[inset_0_0_0_1px_#000,0_30px_60px_-40px_#000]"
      >
        <div className="flex items-center justify-between gap-4 border-b border-board-line px-4 py-3 sm:px-5">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              lang="ja"
              className="text-[15px] font-bold tracking-[0.2em] whitespace-nowrap text-paper-soft"
            >
              {EXAMPLE_SEARCH.destinationNameJa}方面
            </span>
            <span className="label-utility text-[10px] text-paper-soft/55">
              Arrive by {EXAMPLE_SEARCH.arrivalTime}
            </span>
          </p>
          <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] whitespace-nowrap text-led/80">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse bg-led motion-reduce:animate-none"
            />
            {STOPS.length} of {EXAMPLE_SEARCH.funnel.qualified} shown
          </span>
        </div>

        <table className="w-full border-collapse font-mono text-[13px] sm:text-[14px]">
          <caption className="sr-only">
            The example search&rsquo;s best {STOPS.length} areas: commute to Shibuya, modeled rent
            for a {EXAMPLE_SEARCH.layout}, and overall match.
          </caption>
          <thead>
            <tr className="label-utility text-left text-[9.5px] text-paper-soft/45">
              <th scope="col" className="w-10 py-2 pl-4 font-semibold sm:pl-5">
                順
              </th>
              <th scope="col" className="py-2 font-semibold">
                Area
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Min
              </th>
              <th scope="col" className="hidden py-2 text-right font-semibold sm:table-cell">
                Rent
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold sm:pr-5">
                Match
              </th>
            </tr>
          </thead>
          <tbody>
            {STOPS.map((stop, index) => (
              <BoardRow
                key={stop.nameJa}
                stop={stop}
                index={index}
                running={inView}
                isActive={active === index}
                onActivate={() => setActive(index)}
                onDeactivate={() => setActive((current) => (current === index ? null : current))}
              />
            ))}
          </tbody>
        </table>

        <p className="border-t border-board-line px-4 py-3 text-[11.5px] leading-relaxed text-paper-soft/55 sm:px-5">
          Point at a row to see its route on the map. Times are a typical weekday morning, not a
          timetable.
        </p>
      </div>
    </div>
  );
}

function BoardRow({
  stop,
  index,
  running,
  isActive,
  onActivate,
  onDeactivate,
}: {
  readonly stop: ShortlistStop;
  readonly index: number;
  readonly running: boolean;
  readonly isActive: boolean;
  readonly onActivate: () => void;
  readonly onDeactivate: () => void;
}) {
  const delay = index * 110;

  return (
    <tr
      tabIndex={0}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
      onClick={onActivate}
      className={`cursor-default border-t border-board-line/70 transition-colors duration-150 focus:outline-none focus-visible:bg-led/15 ${
        isActive ? "bg-led/10" : "hover:bg-led/5"
      }`}
    >
      <td className="py-2.5 pl-4 align-baseline text-led/60 tnum sm:pl-5">
        {String(index + 1).padStart(2, "0")}
      </td>
      <td className="py-2.5 align-baseline">
        <span lang="ja" className="mr-2.5 font-sans text-[15px] font-bold tracking-[0.12em]">
          <LedText text={stop.nameJa} running={running} delay={delay} noise={KANJI_NOISE} />
        </span>
        <span className="text-[11.5px] text-led/65 uppercase">
          <LedText text={stop.nameEn} running={running} delay={delay + 60} />
        </span>
      </td>
      <td className="py-2.5 text-right align-baseline tnum">
        <LedText text={String(stop.commuteMinutes)} running={running} delay={delay + 120} />
      </td>
      <td className="hidden py-2.5 text-right align-baseline text-led/80 tnum sm:table-cell">
        <LedText
          text={`${yenK(stop.rentLowYen)}–${yenK(stop.rentHighYen)}`}
          running={running}
          delay={delay + 160}
        />
      </td>
      <td className="py-2.5 pr-4 text-right align-baseline sm:pr-5">
        <span
          className={`inline-block min-w-9 px-1 text-center font-bold tnum transition-colors duration-150 ${
            isActive ? "bg-led text-board" : "text-led"
          }`}
        >
          <LedText text={String(stop.score)} running={running} delay={delay + 200} />
        </span>
      </td>
    </tr>
  );
}

/**
 * Text that settles into place character by character, like a board
 * refreshing — once, when the board first comes into view. Screen readers
 * and reduced-motion visitors get the final text immediately.
 */
function LedText({
  text,
  running,
  delay,
  noise = LATIN_NOISE,
}: {
  readonly text: string;
  readonly running: boolean;
  readonly delay: number;
  readonly noise?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [settled, setSettled] = useState(reducedMotion ? text.length : 0);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      setSettled(text.length);
      return;
    }
    if (!running) return;
    let tick = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        tick += 1;
        setFrame(tick);
        const done = Math.max(0, Math.floor((tick - 3) / 1.6));
        setSettled(Math.min(done, text.length));
        if (done >= text.length) clearInterval(interval);
      }, FRAME_MS);
    }, delay);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [running, delay, text, reducedMotion]);

  if (settled >= text.length) return <>{text}</>;

  const shown = [...text]
    .map((char, i) => {
      if (i < settled || char === " " || char === "–" || char === "¥") return char;
      if (!running) return " ";
      return noise[(i * 7 + frame * 13 + delay) % noise.length];
    })
    .join("");

  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}
