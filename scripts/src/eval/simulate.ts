// Simulated users: does asking questions beat the fixed form?
// (docs/plans/agent-harness-plan.md, "Evaluation", "Simulated users".)
//
// Hidden people are drawn from the engine's own prior (belief.ts samplePrior,
// a different seed from the engine's). Each answers every shortlist by picking
// their true favourite with the engine's own choice noise (evidence.ts
// BETA_SHARE * scale, i.e. a softmax / Gumbel choice on the noise-free utility).
// The answer goes back as pick_from_set evidence. After 0..N answers we record
// true regret in yen per month: the person's best feasible area minus the
// engine's top pick, both valued with the hidden person's own parameters.
//
// No model, no network. Real data needs the LOCAL database only.
//
// Usage (from the repo root, never through a script that loads .env):
//   npx tsx scripts/src/eval/simulate.ts --synthetic
//   DATABASE_URL=<local tokyo db> npx tsx scripts/src/eval/simulate.ts
// Flags: --synthetic --people N --questions N --seed N --anchor STATION_GROUP_ID --out PATH --no-write
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '@tokyo/shared';
import type { AnchorTimes, AreaFeatures, ModelParams, Profile } from '@tokyo/shared';

import { loadEngine, loadSynthetic, type EngineModules } from './engine-loader.js';

export const DEFAULT_PEOPLE = 200;
export const DEFAULT_QUESTIONS = 6;
export const DEFAULT_SEED = 20260117;
/** Real-data anchor: Shinjuku station group in the local database (a central interchange). */
export const DEFAULT_ANCHOR_STATION = 'mlit-新宿-35.690-139.700';
const SHORTLIST_K = 5;

export interface SimulationInput {
  areas: readonly AreaFeatures[];
  params: ModelParams;
  anchorTimes: AnchorTimes;
  profile: Profile;
  people?: number;
  questions?: number;
  seed?: number;
}

export interface RegretRow {
  questions: number;
  /** People with a defined regret at this step. */
  n: number;
  medianYen: number;
  p90Yen: number;
  meanYen: number;
}

export interface SimulationResult {
  rows: RegretRow[];
  people: number;
  maxQuestions: number;
  seed: number;
  areas: number;
  feasibleAreas: number;
  scaleYen: number;
  choiceNoiseYen: number;
  /** People excluded because no feasible area exists for them (should be 0). */
  skippedPeople: number;
  /** Times a person could not be asked (fewer than 2 areas on the shortlist) and kept their last regret. */
  carriedForward: number;
  /** Observations the engine rejected (should be 0). */
  observeErrors: number;
}

/** Linear-interpolated quantile of a list (copy is sorted). NaN for an empty list. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const v = [...values].sort((a, b) => a - b);
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

export function summarise(regretByStep: readonly (readonly number[])[]): RegretRow[] {
  return regretByStep.map((values, questions) => ({
    questions,
    n: values.length,
    medianYen: quantile(values, 0.5),
    p90Yen: quantile(values, 0.9),
    meanYen: values.length ? values.reduce((s, x) => s + x, 0) / values.length : NaN,
  }));
}

export function runSimulation(eng: EngineModules, input: SimulationInput): SimulationResult {
  const people = input.people ?? DEFAULT_PEOPLE;
  const maxQ = input.questions ?? DEFAULT_QUESTIONS;
  const seed = input.seed ?? DEFAULT_SEED;
  const areas = [...input.areas];

  // The engine under test. Its prior uses engineSeed; hidden people use another.
  const engineSeed = seed;
  const hiddenSeed = (seed ^ 0x5bd1e995) >>> 0;
  const engine = eng.createEngine(areas, input.params, engineSeed);
  const pr = engine.setProfile(input.profile, input.anchorTimes);

  // Truth: same area context the engine builds (same pure function, same inputs).
  const ctx = eng.buildAreaContext(areas, input.params, engine.snapshot().profile, input.anchorTimes);
  const hidden = eng.samplePrior(ctx.scale, hiddenSeed, people);
  const truth = eng.buildUtilities(hidden, ctx, engine.snapshot().profile, hiddenSeed);
  const nA = ctx.areas.length;
  const beta = eng.BETA_SHARE * ctx.scale;
  const rng = createRng((seed ^ 0x2545f491) >>> 0);
  const gumbel = (): number => -Math.log(-Math.log(Math.max(rng.next(), 1e-12)));

  const regretByStep: number[][] = Array.from({ length: maxQ + 1 }, () => []);
  let skipped = 0;
  let carried = 0;
  let observeErrors = 0;

  for (let p = 0; p < people; p++) {
    const row = p * nA;
    let best = -Infinity;
    for (let a = 0; a < nA; a++) if (ctx.feasible[a] && truth.u[row + a]! > best) best = truth.u[row + a]!;
    if (!Number.isFinite(best)) {
      skipped++;
      continue;
    }

    // Reset the engine to the prior (the same engine object keeps its feasible set and utility matrix).
    for (const e of engine.snapshot().evidence) if (e.id) engine.removeEvidence(e.id);

    let last = NaN;
    for (let q = 0; q <= maxQ; q++) {
      const rec = engine.recommend(SHORTLIST_K);
      const top = rec.shortlist[0];
      if (top === undefined) {
        skipped++;
        break;
      }
      const topIdx = ctx.index.get(top.localityId)!;
      last = Math.max(0, best - truth.u[row + topIdx]!);
      regretByStep[q]!.push(last);
      if (q === maxQ) break;

      const set = rec.shortlist.map((s) => s.localityId);
      if (set.length < 2) {
        for (let r = q + 1; r <= maxQ; r++) regretByStep[r]!.push(last);
        carried += maxQ - q;
        break;
      }
      let chosen = set[0]!;
      let chosenScore = -Infinity;
      for (const id of set) {
        const score = truth.u[row + ctx.index.get(id)!]! / beta + gumbel();
        if (score > chosenScore) {
          chosenScore = score;
          chosen = id;
        }
      }
      const res = engine.observe({ type: 'pick_from_set', chosen, set, strength: 'normal' });
      if (!res.ok) observeErrors++;
    }
  }

  return {
    rows: summarise(regretByStep),
    people,
    maxQuestions: maxQ,
    seed,
    areas: nA,
    feasibleAreas: pr.feasibleCount,
    scaleYen: ctx.scale,
    choiceNoiseYen: beta,
    skippedPeople: skipped,
    carriedForward: carried,
    observeErrors,
  };
}

export function formatTable(result: SimulationResult): string {
  const yen = (x: number): string => Math.round(x).toLocaleString('en-US').padStart(10);
  const lines = ['questions  people    median yen/mo     p90 yen/mo    mean yen/mo'];
  for (const r of result.rows) {
    lines.push(`${String(r.questions).padStart(9)}  ${String(r.n).padStart(6)}  ${yen(r.medianYen)}     ${yen(r.p90Yen)}    ${yen(r.meanYen)}`);
  }
  return lines.join('\n');
}

// ---------- Data ----------

interface Dataset {
  label: 'synthetic' | 'local-database';
  areas: AreaFeatures[];
  params: ModelParams;
  anchorTimes: AnchorTimes;
  profile: Profile;
  anchorDescription: string;
}

/**
 * The raw synthetic fixtures have one area that is best for about 94% of hidden
 * people (checked: 187 of 200), so regret is trivially near zero. For the
 * no-DB run we therefore impose an urban/quiet trade-off on top of the fixtures:
 * each area gets a seeded "urbanity" z in [0, 1]; rent, shops, bars and road
 * exposure rise with z, residential calm and green space fall with z.
 * Still synthetic: it only gives the engine something to learn.
 */
export function withUrbanTradeoff(areas: readonly AreaFeatures[], seed = 5): AreaFeatures[] {
  const rng = createRng(seed);
  return areas.map((a) => {
    const z = rng.next();
    const scale = (n: number, lo: number, span: number): number => Math.round(n * (lo + span * z));
    return {
      ...a,
      rent_per_sqm_yen: 2000 + 3500 * z,
      supermarket_count: scale(a.supermarket_count, 0.4, 1.2),
      restaurant_count: scale(a.restaurant_count, 0.2, 1.6),
      cafe_count: scale(a.cafe_count, 0.2, 1.6),
      convenience_count: scale(a.convenience_count, 0.3, 1.4),
      cuisine_variety_count: scale(a.cuisine_variety_count, 0.2, 1.6),
      late_night_count: scale(a.late_night_count, 0.1, 1.8),
      bar_count: scale(a.bar_count ?? 0, 0.1, 1.8),
      green_space_share: a.green_space_share * (1.4 - 1.2 * z),
      residential_zoning_share: Math.max(0, Math.min(1, 1 - 0.9 * z)),
      road_rail_exposure_share: 0.1 + 0.7 * z,
    };
  });
}

async function syntheticDataset(): Promise<Dataset> {
  const syn = await loadSynthetic();
  const areas = withUrbanTradeoff(syn.syntheticAreas(150));
  return {
    label: 'synthetic',
    areas,
    params: syn.SYNTHETIC_PARAMS,
    anchorTimes: syn.syntheticTimes(areas, 'work'),
    profile: syn.syntheticProfile({ commuteCap: { value: 60, firm: true } }),
    anchorDescription: 'synthetic one-way minutes (10 to 70) to one synthetic anchor; synthetic fixtures with an imposed urban/quiet trade-off',
  };
}

/** Refuses anything that is not a local Postgres. The URL is never printed. */
export function assertLocalDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set. Real-data mode needs the LOCAL tokyo database (see .env.example); or pass --synthetic.');
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || /neon/i.test(url)) {
    throw new Error('Refusing to run: DATABASE_URL does not point at a local Postgres');
  }
  return url;
}

async function realDataset(anchorStation: string): Promise<Dataset & { close: () => Promise<void> }> {
  const url = assertLocalDatabaseUrl(process.env['DATABASE_URL']);
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url });
  const api = (file: string): string => fileURLToPath(new URL(`../../../api/src/${file}`, import.meta.url));
  const [{ loadFeatureStore }, { createComputeAnchorTimes }, { loadRailEdges }, { buildGraphs }] = await Promise.all([
    import(/* @vite-ignore */ api('agent/feature-store.ts')),
    import(/* @vite-ignore */ api('agent/anchor-times.ts')),
    import(/* @vite-ignore */ api('domain/transit/loader.ts')),
    import(/* @vite-ignore */ api('domain/transit/graph.ts')),
  ]);
  const store = (await loadFeatureStore(pool)) as { areas: AreaFeatures[]; params: ModelParams };
  const graphs = buildGraphs(await loadRailEdges(pool));
  const compute = createComputeAnchorTimes({ pool, graphs }) as (
    anchors: Profile['anchors'],
    areas: readonly AreaFeatures[],
  ) => Promise<{ times: AnchorTimes; refused: { anchorId: string; message: string }[] }>;
  const anchor: Profile['anchors'][number] = {
    id: 'work',
    label: 'Fixed central anchor',
    stationId: anchorStation,
    tripsPerWeek: 5,
    period: 'peak',
  };
  const { times, refused } = await compute([anchor], store.areas);
  if (refused.length > 0) throw new Error(`Anchor refused: ${refused[0]!.message}`);
  return {
    label: 'local-database',
    areas: store.areas,
    params: store.params,
    anchorTimes: times,
    profile: {
      anchors: [anchor],
      layout: '1K',
      budget: { value: 100000, firm: false },
      commuteCap: { value: 60, firm: true },
      enoughMultipliers: {},
    },
    anchorDescription: `station group ${anchorStation}, peak, 5 trips per week, one-way minutes from the API's own transit graph`,
    close: () => pool.end(),
  };
}

// ---------- CLI ----------

function arg(name: string, argv: readonly string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: readonly string[]): Promise<void> {
  const synthetic = argv.includes('--synthetic');
  const people = Number(arg('--people', argv) ?? DEFAULT_PEOPLE);
  const questions = Number(arg('--questions', argv) ?? DEFAULT_QUESTIONS);
  const seed = Number(arg('--seed', argv) ?? DEFAULT_SEED);
  const anchorStation = arg('--anchor', argv) ?? DEFAULT_ANCHOR_STATION;
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(arg('--out', argv) ?? resolve(here, 'out/simulate.json'));

  const eng = await loadEngine();
  const data = synthetic ? await syntheticDataset() : await realDataset(anchorStation);
  const t0 = Date.now();
  const result = runSimulation(eng, {
    areas: data.areas,
    params: data.params,
    anchorTimes: data.anchorTimes,
    profile: data.profile,
    people,
    questions,
    seed,
  });
  const seconds = (Date.now() - t0) / 1000;
  if ('close' in data) await (data as { close: () => Promise<void> }).close();

  console.log(`Simulated users: ${people} hidden people, data = ${data.label}, ${result.areas} areas (${result.feasibleAreas} feasible), seed ${seed}`);
  console.log(`Anchor: ${data.anchorDescription}`);
  console.log(`Limits: 1K, budget ${data.profile.budget?.value} soft, commute cap ${data.profile.commuteCap?.value} min firm. Scale ${Math.round(result.scaleYen)} yen, choice noise beta ${Math.round(result.choiceNoiseYen)} yen.`);
  console.log(formatTable(result));
  console.log(`Regret = hidden person's value of their true best feasible area minus their value of the engine's top pick, yen per month.`);
  console.log(`Skipped people: ${result.skippedPeople}; carried forward: ${result.carriedForward}; observe errors: ${result.observeErrors}; run time ${seconds.toFixed(1)}s`);
  console.log('Baseline (/v1/optimize): NOT DONE. See the "baseline" field in the JSON for the reason.');

  const json = {
    kind: 'matchi-eval-simulate',
    data: data.label,
    anchor: data.anchorDescription,
    profile: data.profile,
    config: { people, questions, seed, shortlistSize: SHORTLIST_K, engineSeedEqualsSeed: true },
    areas: result.areas,
    feasibleAreas: result.feasibleAreas,
    scaleYen: result.scaleYen,
    choiceNoiseYen: result.choiceNoiseYen,
    skippedPeople: result.skippedPeople,
    carriedForward: result.carriedForward,
    observeErrors: result.observeErrors,
    regretByQuestions: result.rows,
    baseline: {
      done: false,
      reason:
        '/v1/optimize scoring takes a different candidate model (importance levels over 8 lifestyle axes, its own rent and commute estimate). Mapping the 12 hidden weights onto those levels is a judgement call, so no baseline number is reported.',
    },
    runSeconds: seconds,
    note: 'Measures the engine against people who behave as the engine assumes; it does not show that real people are modelled well.',
  };
  if (!argv.includes('--no-write')) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(json, null, 2) + '\n');
    console.log(`Wrote ${outPath}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
