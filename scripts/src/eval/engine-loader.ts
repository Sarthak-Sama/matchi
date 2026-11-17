// Loads the engine modules from shared/src/engine at run time.
//
// @tokyo/shared does not export createEngine yet (its index.ts exports only the
// engine types and createRng), and a static relative import would put
// shared/src outside this package's tsconfig rootDir. So the modules are
// imported dynamically by file path and typed with the contract types that
// @tokyo/shared does export. Works under tsx and under vitest.
// If @tokyo/shared later exports the engine, replace this file with a plain import.
import { fileURLToPath } from 'node:url';

import type {
  AnchorTimes,
  AreaFeatures,
  BuildAreaContext,
  BuildUtilities,
  CreateEngine,
  EngineDefaults,
  ModelParams,
  Profile,
  SamplePrior,
} from '@tokyo/shared';

export interface EngineModules {
  createEngine: CreateEngine;
  samplePrior: SamplePrior;
  buildAreaContext: BuildAreaContext;
  buildUtilities: BuildUtilities;
  /** Choice-noise share: beta = BETA_SHARE * scale. The engine's own constant (evidence.ts). */
  BETA_SHARE: number;
  DEFAULTS: EngineDefaults;
}

export interface SyntheticModules {
  SYNTHETIC_PARAMS: ModelParams;
  syntheticAreas: (n?: number, seed?: number) => AreaFeatures[];
  syntheticTimes: (areas: readonly AreaFeatures[], anchorId?: string, seed?: number) => AnchorTimes;
  syntheticProfile: (overrides?: Partial<Profile>) => Profile;
}

const enginePath = (file: string): string => fileURLToPath(new URL(`../../../shared/src/engine/${file}`, import.meta.url));

export async function loadEngine(): Promise<EngineModules> {
  const [index, belief, features, recommend, evidence] = await Promise.all([
    import(/* @vite-ignore */ enginePath('index.ts')),
    import(/* @vite-ignore */ enginePath('belief.ts')),
    import(/* @vite-ignore */ enginePath('features.ts')),
    import(/* @vite-ignore */ enginePath('recommend.ts')),
    import(/* @vite-ignore */ enginePath('evidence.ts')),
  ]);
  return {
    createEngine: index.createEngine,
    samplePrior: belief.samplePrior,
    buildAreaContext: features.buildAreaContext,
    buildUtilities: recommend.buildUtilities,
    BETA_SHARE: evidence.BETA_SHARE,
    DEFAULTS: recommend.DEFAULTS,
  } as EngineModules;
}

export async function loadSynthetic(): Promise<SyntheticModules> {
  return (await import(/* @vite-ignore */ enginePath('synthetic-fixtures.ts'))) as SyntheticModules;
}
