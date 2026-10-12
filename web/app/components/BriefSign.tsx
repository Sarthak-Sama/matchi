"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { LAYOUTS, LIFESTYLE_AXES, LIFESTYLE_AXIS_IDS } from "@tokyo/shared";

import type { OptimizeSearch } from "../../lib/useOptimizeSearch";
import { AxisPictogram } from "./AxisPictogram";

const ARRIVE = [0.16, 1, 0.3, 1] as const;

/** "Shibuya (渋谷)" → { primary: "渋谷", secondary: "Shibuya" }; plain labels pass through. */
export function splitBilingual(label: string): { primary: string; secondary: string | null } {
  const match = /^(.*?)\s*\(([^)]+)\)\s*$/u.exec(label);
  if (!match?.[1] || !match[2]) return { primary: label, secondary: null };
  const [en, ja] = [match[1], match[2]];
  return /[぀-ヿ㐀-鿿]/u.test(ja) ? { primary: ja, secondary: en } : { primary: en, secondary: ja };
}

/**
 * The /find page's companion sign: the brief, set as the station board for
 * the line the reader is about to build. It fills in as they answer — the
 * destination becomes the terminus, the limits become the timetable — so
 * every choice on the form gets a visible, physical consequence.
 */
export function BriefSign({ search }: { readonly search: OptimizeSearch }) {
  const reducedMotion = useReducedMotion();
  const destination = search.selectedDestination;
  const name = destination ? splitBilingual(destination.label) : null;
  const priorities = LIFESTYLE_AXIS_IDS.filter((id) => search.preferences[id] !== undefined);
  const layout = LAYOUTS[search.layout];

  const facts = [
    { label: "Arrive by", value: search.arrivalTime },
    { label: "At most", value: `${search.maxCommuteMinutes} min` },
    {
      label: "All-in",
      value: search.monthlyBudgetYen > 0 ? `¥${Math.round(search.monthlyBudgetYen / 1000)}k` : "—",
    },
    { label: "Layout", value: layout.label },
  ];

  return (
    <figure className="m-0" aria-label="Your brief, as it stands">
      <div className="relative overflow-hidden border border-ink/80 bg-paper-soft shadow-[0_18px_40px_-28px_rgb(14_26_19/0.55)]">
        <div className="flex items-center justify-between gap-4 px-5 pt-5">
          <p className="label-utility text-[10px] text-ink-muted">Your line · terminus</p>
          <span
            className={`label-utility px-1.5 py-0.5 text-[9.5px] transition-colors ${
              destination ? "bg-vermilion-deep text-white" : "bg-line text-ink-muted"
            }`}
          >
            {destination ? (destination.kind === "station" ? "Station" : "Place") : "Not set"}
          </span>
        </div>

        <div className="relative grid min-h-48 place-items-center px-5 py-6 text-center">
          {name ? (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={destination?.label}
                initial={
                  reducedMotion ? { opacity: 0 } : { x: "30%", opacity: 0, filter: "blur(8px)" }
                }
                animate={{ x: "0%", opacity: 1, filter: "blur(0px)" }}
                exit={
                  reducedMotion ? { opacity: 0 } : { x: "-30%", opacity: 0, filter: "blur(8px)" }
                }
                transition={{ duration: reducedMotion ? 0.1 : 0.5, ease: ARRIVE }}
              >
                <p className="font-display text-[clamp(2.4rem,5.6vw,4.6rem)] leading-[0.95] font-bold tracking-[0.06em] text-balance">
                  {name.primary}
                </p>
                {name.secondary && (
                  <p className="mt-3 font-display text-[1.3rem] leading-none font-semibold">
                    {name.secondary}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          ) : (
            // No exit animation: when a destination arrives (often straight
            // from a shared link) the placeholder should simply give way.
            <div className="flex flex-col items-center gap-3">
              <span className="grid size-20 place-items-center border-[3px] border-dashed border-vermilion font-display text-[2.4rem] font-bold text-vermilion-deep">
                ?
              </span>
              <span className="max-w-56 text-[13px] leading-snug text-ink-muted">
                Where you need to be becomes the end of your line.
              </span>
            </div>
          )}
        </div>

        <dl className="grid grid-cols-4 border-t border-ink/15">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="border-l border-ink/10 px-3 py-3 first:border-l-0 sm:px-4"
            >
              <dt className="label-utility text-[9px] text-ink-muted">{fact.label}</dt>
              <dd className="mt-1 overflow-hidden text-[15px] font-bold tnum">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={fact.value}
                    className="block"
                    initial={reducedMotion ? false : { y: "-100%", opacity: 0 }}
                    animate={{ y: "0%", opacity: 1 }}
                    exit={reducedMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                  >
                    {fact.value}
                  </motion.span>
                </AnimatePresence>
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex min-h-14 flex-wrap items-center gap-2 bg-moss px-5 py-3 text-paper-soft">
          <span className="label-utility mr-1 text-[9.5px] text-sage">Everyday life</span>
          {priorities.length === 0 ? (
            <span className="text-[12px] text-sage">Pick what your week depends on →</span>
          ) : (
            <AnimatePresence initial={false}>
              {priorities.map((id) => (
                <motion.span
                  key={id}
                  layout={!reducedMotion}
                  initial={reducedMotion ? false : { scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 480, damping: 28 }}
                  title={LIFESTYLE_AXES[id].label}
                >
                  <AxisPictogram axis={id} tone="inverse" className="size-8" />
                  <span className="sr-only">{LIFESTYLE_AXES[id].label}</span>
                </motion.span>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
      <figcaption className="mt-2.5 text-[12px] text-ink-muted">
        Your brief, as it stands. Every answer on the right changes the sign.
      </figcaption>
    </figure>
  );
}
