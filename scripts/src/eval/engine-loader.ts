// The engine comes from @tokyo/shared, the entry point the API uses, so the
// simulation tests the code that ships. The two things @tokyo/shared does not
// carry are loaded by file path at run time, because a static relative import
// would put them outside this package's tsconfig rootDir: the API's form
// scoring (api/src/domain/scoring.ts) and the synthetic fixtures.
import { fileURLToPath } from 'node:url';

import { buildAreaContext, createEngine, DEFAULTS, noisyUtilities } from '@tokyo/shared';
import type { AnchorTimes, AreaFeatures, Confidence, ModelParams, OptimizationRequest, Profile } from '@tokyo/shared';

/** The part of the API's scoring Candidate that the form scoring reads. */
export interface FormCandidate {
  localityId: string;
  nameEn: string;
  nameJa: string;
  wardCode: string;
  wardNameEn: string;
  wardNameJa: string;
  centroid: { lat: number; lon: number };
  rent: { medianYen: number; layout: string; confidence: Confidence; sourcePeriod: string };
  commute: { totalMinutes: number; confidence: Confidence; path: [] };
  lifestyle: Record<string, number | string | null>;
}

type FormRequest = Pick<OptimizationRequest, 'monthlyBudgetYen' | 'maxCommuteMinutes' | 'preferences'>;

/** api/src/domain/scoring.ts, typed for what the simulation calls. */
export interface ScoringModules {
  applyHardFilters(candidates: readonly FormCandidate[], request: FormRequest): { feasible: readonly FormCandidate[] };
  scoreCandidate(candidate: FormCandidate, request: FormRequest): { localityId: string };
  rankCandidates<T extends { localityId: string }>(scored: readonly T[]): T[];
}

export interface EngineModules {
  createEngine: typeof createEngine;
  buildAreaContext: typeof buildAreaContext;
  noisyUtilities: typeof noisyUtilities;
  DEFAULTS: typeof DEFAULTS;
  scoring: ScoringModules;
}

export interface SyntheticModules {
  SYNTHETIC_PARAMS: ModelParams;
  syntheticAreas: (n?: number, seed?: number) => AreaFeatures[];
  syntheticTimes: (areas: readonly AreaFeatures[], anchorId?: string, seed?: number) => AnchorTimes;
  syntheticProfile: (overrides?: Partial<Profile>) => Profile;
}

const sourcePath = (file: string): string => fileURLToPath(new URL(`../../../${file}`, import.meta.url));

export async function loadEngine(): Promise<EngineModules> {
  const scoring = (await import(/* @vite-ignore */ sourcePath('api/src/domain/scoring.ts'))) as ScoringModules;
  return { createEngine, buildAreaContext, noisyUtilities, DEFAULTS, scoring };
}

export async function loadSynthetic(): Promise<SyntheticModules> {
  return (await import(/* @vite-ignore */ sourcePath('shared/src/engine/synthetic-fixtures.ts'))) as SyntheticModules;
}
