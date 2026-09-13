import type { Importance, Layout, LifestyleAxisId, OptimizationRequest } from "@tokyo/shared";
import {
  LIFESTYLE_AXIS_IDS,
  MAX_SELECTED_LIFESTYLE_AXES,
  MIN_SELECTED_LIFESTYLE_AXES,
} from "@tokyo/shared";

import type { SelectedDestination } from "./useOptimizeSearch";

export interface OptimizationRequestInputs {
  readonly selectedDestination: SelectedDestination;
  readonly arrivalTime: string;
  readonly monthlyBudgetYen: number;
  readonly layout: Layout;
  readonly maxCommuteMinutes: number;
  readonly preferences: Record<LifestyleAxisId, Importance | undefined>;
}

export function buildOptimizationRequest(inputs: OptimizationRequestInputs): OptimizationRequest {
  const {
    selectedDestination,
    arrivalTime,
    monthlyBudgetYen,
    layout,
    maxCommuteMinutes,
    preferences,
  } = inputs;
  return {
    ...(selectedDestination.kind === "station"
      ? { destinationStationGroupId: selectedDestination.stationGroupId }
      : {
          destinationPoint: {
            lat: selectedDestination.lat,
            lon: selectedDestination.lon,
            label: selectedDestination.label,
          },
        }),
    arrivalTime,
    monthlyBudgetYen,
    layout,
    maxCommuteMinutes,
    preferences,
  };
}

export type SearchValidationResult =
  | { readonly ok: true; readonly destination: SelectedDestination }
  | { readonly ok: false; readonly message: string };

/** Validates the form state `runOptimize` needs before it can submit. */
export function validateSearchInputs(
  selectedDestination: SelectedDestination | null,
  preferences: Record<LifestyleAxisId, Importance | undefined>,
): SearchValidationResult {
  if (!selectedDestination) {
    return { ok: false, message: "Choose a destination from the suggestions list first." };
  }

  const selectedAxisCount = LIFESTYLE_AXIS_IDS.filter((id) => preferences[id] !== undefined).length;
  if (selectedAxisCount < MIN_SELECTED_LIFESTYLE_AXES) {
    return { ok: false, message: "Select at least one lifestyle priority before searching." };
  }
  if (selectedAxisCount > MAX_SELECTED_LIFESTYLE_AXES) {
    return {
      ok: false,
      message: `Select at most ${MAX_SELECTED_LIFESTYLE_AXES} lifestyle priorities.`,
    };
  }

  return { ok: true, destination: selectedDestination };
}
