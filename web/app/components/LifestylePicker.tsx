"use client";

import type { Importance, LifestyleAxisId } from "@tokyo/shared";
import {
  IMPORTANCE_OPTIONS,
  LIFESTYLE_AXES,
  LIFESTYLE_AXIS_IDS,
  MAX_SELECTED_LIFESTYLE_AXES,
} from "@tokyo/shared";

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

      {/* Step 1 — pick the axes. */}
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Lifestyle priorities">
        {LIFESTYLE_AXIS_IDS.map((id) => {
          const isSelected = preferences[id] !== undefined;
          const disabled = !isSelected && selectedCount >= MAX_SELECTED_LIFESTYLE_AXES;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => toggleAxis(id)}
              className={`flex min-h-11 items-center gap-2 border px-3.5 text-[13px] font-medium transition-colors ${
                isSelected
                  ? "border-moss bg-moss text-white"
                  : "border-line-strong text-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
              }`}
            >
              {isSelected && <CheckIcon className="size-3.5" />}
              {LIFESTYLE_AXES[id].label}
            </button>
          );
        })}
      </div>

      {/* Step 2 — weigh each selected axis. */}
      {selectedIds.length > 0 && (
        <div className="mt-4 divide-y divide-line border-y border-line">
          {selectedIds.map((id) => (
            <div
              key={id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-[14px] font-medium">{LIFESTYLE_AXES[id].label}</span>
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
        </div>
      )}
    </div>
  );
}
