// Calibration of what the engine claims: is the top pick best as often as its
// pBest says, and does the risk it reports match the regret people really bear?
import { mean } from './stats.js';

/** One recommendation, judged against the hidden person's truth. */
export interface CalibrationSample {
  /** pBest of the top pick. */
  pBest: number;
  /** Whether the top pick really is the person's best feasible area. */
  topIsBest: boolean;
  /** riskYen of the shortlist. */
  riskYen: number;
  /** Their value of the best feasible area minus their value of the best area on the shortlist, yen per month. */
  realisedRegretYen: number;
}

export const CALIBRATION_BINS = 10;

export interface PBestBin {
  from: number;
  to: number;
  n: number;
  meanPBest: number;
  /** Share of recommendations in the bin whose top pick was truly best. */
  hitRate: number;
}

export interface RiskBin {
  n: number;
  meanRiskYen: number;
  meanRealisedRegretYen: number;
}

export interface Calibration {
  samples: number;
  pBestBins: PBestBin[];
  riskBins: RiskBin[];
  /** Expected calibration error of pBest: the sample-weighted mean gap between pBest and the hit rate. */
  ece: number;
}

export function calibrate(samples: readonly CalibrationSample[]): Calibration {
  const pBestBins: PBestBin[] = [];
  let gap = 0;
  for (let b = 0; b < CALIBRATION_BINS; b++) {
    const from = b / CALIBRATION_BINS;
    const to = (b + 1) / CALIBRATION_BINS;
    const inBin = samples.filter((s) => s.pBest >= from && (s.pBest < to || (b === CALIBRATION_BINS - 1 && s.pBest <= to)));
    const meanPBest = mean(inBin.map((s) => s.pBest));
    const hitRate = mean(inBin.map((s) => (s.topIsBest ? 1 : 0)));
    if (inBin.length > 0) gap += (inBin.length / samples.length) * Math.abs(meanPBest - hitRate);
    pBestBins.push({ from, to, n: inBin.length, meanPBest, hitRate });
  }
  return { samples: samples.length, pBestBins, riskBins: riskBins(samples), ece: samples.length > 0 ? gap : NaN };
}

/** Samples sorted by reported risk and cut into ten equal-count groups, each with the regret people in it actually bore. */
function riskBins(samples: readonly CalibrationSample[]): RiskBin[] {
  const sorted = [...samples].sort((a, b) => a.riskYen - b.riskYen);
  return Array.from({ length: CALIBRATION_BINS }, (_, b) => {
    const inBin = sorted.slice(Math.floor((b * sorted.length) / CALIBRATION_BINS), Math.floor(((b + 1) * sorted.length) / CALIBRATION_BINS));
    return { n: inBin.length, meanRiskYen: mean(inBin.map((s) => s.riskYen)), meanRealisedRegretYen: mean(inBin.map((s) => s.realisedRegretYen)) };
  });
}
