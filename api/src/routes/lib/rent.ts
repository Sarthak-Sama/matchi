import type { Confidence, LayoutId, RentEstimateResult } from "@tokyo/shared";
import { estimateRent, rentStatBaseConfidence } from "@tokyo/shared";

export interface StoredRentInputs {
  readonly rentPerSqmYen: number;
  readonly managementFeeYen: number;
  readonly landPriceMultiplier: number;
  readonly landPricePointCount: number;

  readonly landPriceUsedFallback: boolean;
  readonly rentSource: string;
  readonly rentSourcePeriod: string;
}

export function recomputeRentForLayout(
  inputs: StoredRentInputs,
  layout: LayoutId,
  currentYear: number,
): RentEstimateResult {
  const baseConfidence: Confidence = rentStatBaseConfidence(
    inputs.rentSource,
    inputs.rentSourcePeriod,
    currentYear,
  );

  return estimateRent({
    layout,
    wardRentPerSqmYen: inputs.rentPerSqmYen,
    managementFeeYen: inputs.managementFeeYen,
    landPriceMultiplier: inputs.landPriceMultiplier,
    landPricePointCount: inputs.landPricePointCount,
    landPriceUsedFallback: inputs.landPriceUsedFallback,
    source: inputs.rentSource,
    sourcePeriod: inputs.rentSourcePeriod,
    baseConfidence,
    currentYear,
  });
}
