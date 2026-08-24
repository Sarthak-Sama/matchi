"use client";

/**
 * Two-step lifestyle picker: SELECT which axes matter (up to
 * `MAX_SELECTED_LIFESTYLE_AXES`), then RATE each selected axis low →
 * essential. Kept as its own component because the shape is genuinely
 * two-step — a single "not rated / low / medium / high / essential"
 * dropdown per axis (the previous stopgap) conflates "I don't care about
 * this" with "I haven't rated it yet" and doesn't read as a menu of nine
 * with 4-5 picks, which is the product intent.
 *
 * Selecting an axis assigns it `DEFAULT_IMPORTANCE` immediately, and
 * deselecting clears it back to `undefined` (omitted from the request
 * entirely). This is a deliberate choice: it is the only way to select an
 * axis without ever producing a "selected but unrated" state, which the API
 * contract has no representation for (`preferences` is `Record<axisId,
 * Importance | undefined>` — there is no third "selected, no rating yet"
 * value to hold).
 */

import type { Importance, LifestyleAxisId } from "@tokyo/shared";
import {
  IMPORTANCE_OPTIONS,
  LIFESTYLE_AXES,
  LIFESTYLE_AXIS_IDS,
  MAX_SELECTED_LIFESTYLE_AXES,
} from "@tokyo/shared";

/** Assigned the moment an axis is selected, so it is always already valid to submit. */
const DEFAULT_IMPORTANCE: Importance = "medium";

interface LifestylePickerProps {
  readonly preferences: Record<LifestyleAxisId, Importance | undefined>;
  readonly onChange: (next: Record<LifestyleAxisId, Importance | undefined>) => void;
}

export function LifestylePicker({ preferences, onChange }: LifestylePickerProps) {
  const selectedCount = LIFESTYLE_AXIS_IDS.filter((id) => preferences[id] !== undefined).length;

  function toggleAxis(id: LifestyleAxisId): void {
    const isSelected = preferences[id] !== undefined;
    if (!isSelected && selectedCount >= MAX_SELECTED_LIFESTYLE_AXES) return;
    onChange({ ...preferences, [id]: isSelected ? undefined : DEFAULT_IMPORTANCE });
  }

  function rateAxis(id: LifestyleAxisId, value: Importance): void {
    onChange({ ...preferences, [id]: value });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        Pick 4–5 priorities that matter most ({selectedCount} of {MAX_SELECTED_LIFESTYLE_AXES} max
        selected), then rate each from low to essential.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {LIFESTYLE_AXIS_IDS.map((id) => {
          const importance = preferences[id];
          const isSelected = importance !== undefined;
          const disableSelect = !isSelected && selectedCount >= MAX_SELECTED_LIFESTYLE_AXES;
          return (
            <div key={id} className="rounded border border-neutral-300 p-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={disableSelect}
                  onChange={() => toggleAxis(id)}
                />
                {LIFESTYLE_AXES[id].label}
              </label>
              {isSelected && (
                <select
                  aria-label={`${LIFESTYLE_AXES[id].label} importance`}
                  value={importance}
                  onChange={(event) => rateAxis(id, event.target.value as Importance)}
                  className="mt-1 rounded border border-neutral-400 px-2 py-1 text-sm"
                >
                  {IMPORTANCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
