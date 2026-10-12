"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Importance, LifestyleAxisId } from "@tokyo/shared";
import {
  IMPORTANCE_OPTIONS,
  LIFESTYLE_AXES,
  LIFESTYLE_AXIS_IDS,
  MAX_SELECTED_LIFESTYLE_AXES,
} from "@tokyo/shared";

import { AxisPictogram } from "./AxisPictogram";
import { CheckIcon } from "./icons";
import { SegmentedControl } from "./SegmentedControl";

const DEFAULT_IMPORTANCE: Importance = "medium";

const IMPORTANCE_LABELS: Record<Importance, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  essential: "Essential",
};

interface LifestylePickerProps {
  readonly preferences: Record<LifestyleAxisId, Importance | undefined>;
  readonly onChange: (next: Record<LifestyleAxisId, Importance | undefined>) => void;
}

export function LifestylePicker({ preferences, onChange }: LifestylePickerProps) {
  const reducedMotion = useReducedMotion();
  const selectedIds = LIFESTYLE_AXIS_IDS.filter((id) => preferences[id] !== undefined);
  const selectedCount = selectedIds.length;

  function toggleAxis(id: LifestyleAxisId): void {
    const isSelected = preferences[id] !== undefined;
    if (!isSelected && selectedCount >= MAX_SELECTED_LIFESTYLE_AXES) return;
    onChange({ ...preferences, [id]: isSelected ? undefined : DEFAULT_IMPORTANCE });
  }

  function rateAxis(id: LifestyleAxisId, value: Importance): void {
    onChange({ ...preferences, [id]: value });
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] text-ink-muted">
          Choose {MAX_SELECTED_LIFESTYLE_AXES > 1 ? `up to ${MAX_SELECTED_LIFESTYLE_AXES}` : "one"}{" "}
          things everyday life depends on, then weigh each one.
        </p>
        <p className="label-utility text-[10px] text-ink-muted" aria-live="polite">
          {selectedCount} of {MAX_SELECTED_LIFESTYLE_AXES} selected
        </p>
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-px border border-line-strong bg-line-strong sm:grid-cols-4"
        role="group"
        aria-label="Lifestyle priorities"
      >
        {LIFESTYLE_AXIS_IDS.map((id) => {
          const isSelected = preferences[id] !== undefined;
          const disabled = !isSelected && selectedCount >= MAX_SELECTED_LIFESTYLE_AXES;
          return (
            <motion.button
              key={id}
              layout={!reducedMotion}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => toggleAxis(id)}
              whileTap={reducedMotion || disabled ? undefined : { scale: 0.97 }}
              className={`group relative flex min-h-24 flex-col items-start justify-between gap-3 p-3 text-left text-[12.5px] leading-tight font-semibold transition-colors ${
                isSelected
                  ? "bg-moss text-paper-soft"
                  : "bg-paper-soft text-ink hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              }`}
            >
              <AxisPictogram
                axis={id}
                tone={isSelected ? "inverse" : "solid"}
                className={`size-9 transition-colors ${isSelected ? "" : "group-hover:bg-moss"}`}
              />
              {LIFESTYLE_AXES[id].label}
              <AnimatePresence>
                {isSelected && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute top-2.5 right-2.5 grid size-5 place-items-center bg-vermilion text-white"
                    initial={reducedMotion ? false : { scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 520, damping: 26 }}
                  >
                    <CheckIcon className="size-3.5" />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {selectedIds.length > 0 && (
          <motion.div
            className="mt-4 divide-y divide-line overflow-hidden border-y border-line"
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {selectedIds.map((id) => (
              <div
                key={id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex items-center gap-2.5 text-[14px] font-semibold">
                  <AxisPictogram axis={id} className="size-6" />
                  {LIFESTYLE_AXES[id].label}
                </span>
                <SegmentedControl<Importance>
                  legend={`${LIFESTYLE_AXES[id].label} importance`}
                  value={preferences[id] ?? DEFAULT_IMPORTANCE}
                  options={IMPORTANCE_OPTIONS.map((option) => ({
                    value: option,
                    label: IMPORTANCE_LABELS[option],
                  }))}
                  onChange={(value) => rateAxis(id, value)}
                />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
