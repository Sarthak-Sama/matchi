// Simulated users: does asking questions beat the fixed form, and does the
// engine know how sure it is? (docs/plans/agent-harness-plan.md, "Evaluation".)
//
// Hidden people come from a model the engine does not use (simulate/users.ts:
// Dirichlet feature shares of an income-scaled pool, wage-based time value,
// archetype bundles, probit answers with 10% lapses). Each one
//   - fills the fixed form (simulate/form.ts), scored by the API's own scoring;
//   - is interviewed by the engine, answering the question it asks next.
// After 0..N answers we record true regret in yen per month: the person's best
// feasible area minus the pick, both valued with the hidden person's own
// parameters. Every recommendation is also judged for calibration
// (simulate/calibration.ts): pBest of the top pick vs how often it is best, and
// reported risk vs the regret actually borne.
//
// Runs over seeds x anchors and reports bootstrap 95% intervals. No model, no
// network. Real data needs the LOCAL database only.
//
// Usage (from the repo root, never through a script that loads .env):
//   npx tsx scripts/src/eval/simulate.ts --synthetic
//   npx tsx scripts/src/eval/simulate.ts --check-baseline        (synthetic; what CI runs)
//   DATABASE_URL=<local tokyo db> npx tsx scripts/src/eval/simulate.ts
// Flags: --synthetic --check-baseline --write-baseline --people N (per seed and anchor)
//        --seeds N --questions N --seed N --anchors ID,ID,ID --out PATH --no-write
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '@tokyo/shared';
import type { AnchorTimes, AreaContext, AreaFeatures, Evidence, ModelParams, NextQuestion, Profile, Recommendation, Rng } from '@tokyo/shared';

import { loadEngine, loadSynthetic, type EngineModules } from './engine-loader.js';
import { calibrate, type Calibration, type CalibrationSample } from './simulate/calibration.js';
import { createFormFiller, formCandidates, formTopPick } from './simulate/form.js';
import { bootstrapMeans, interval95, mean, quantile, type Interval } from './simulate/stats.js';
import { acceptsTradeoff, asBelief, chooseProbit, generateUsers, type HiddenUser } from './simulate/users.js';

export { quantile };

export const DEFAULT_PEOPLE = 60;
export const DEFAULT_SEEDS = 5;
export const DEFAULT_QUESTIONS = 6;
export const DEFAULT_SEED = 20260117;
/** Real-data anchors: Shinjuku, Tokyo and Shibuya station groups in the local database (central interchanges). */
export const DEFAULT_ANCHOR_STATIONS = ['mlit-新宿-35.690-139.700', 'mlit-東京-35.681-139.767', 'mlit-渋谷-35.659-139.702'];
const SHORTLIST_K = 5;
const BASELINE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'baseline.json');

/** The gate: mean regret at the last question may rise 10% over the baseline, and ECE by 0.03 (3 points of calibration, absolute). */
export const GATE = { regretFactor: 1.1, eceTolerance: 0.03 } as const;

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

/** What one run (one seed, one anchor) measured, per person. */
export interface RunSample {
  /** Agent regret by number of questions answered: [q][person]. */
  agentRegret: number[][];
  /** The form's regret for the same people. */
  formRegret: number[];
  calibration: CalibrationSample[];
  /** Questions the engine asked each person. */
  questionsAsked: number[];
  /** How each interview ended: the engine's stop reason at the last recommendation. */
  stopReasons: Record<string, number>;
}

export interface SimulationResult extends RunSample {
  rows: RegretRow[];
  people: number;
  maxQuestions: number;
  seed: number;
  areas: number;
  feasibleAreas: number;
  scaleYen: number;
  /** People excluded because no feasible area exists for them or the form had nothing to show (should be 0). */
  skippedPeople: number;
  /** Times a person's interview ended early (the engine had no question left) and kept their last regret. */
  carriedForward: number;
  /** Observations the engine rejected (should be 0). */
  observeErrors: number;
}

export function summarise(regretByStep: readonly (readonly number[])[]): RegretRow[] {
  return regretByStep.map((values, questions) => ({
    questions,
    n: values.length,
    medianYen: quantile(values, 0.5),
    p90Yen: quantile(values, 0.9),
    meanYen: mean(values),
  }));
}

/** Hours of travel a month that `minutes` one way saves at `tripsPerWeek` round trips (the engine's own formula). */
const monthlyHours = (minutes: number, tripsPerWeek: number): number => (52 / 12) * tripsPerWeek * ((2 * minutes) / 60);

interface InterviewEnv {
  ctx: AreaContext;
  profile: Profile;
  /** The person's true value of each area, by area index. */
  value: (a: number) => number;
  user: HiddenUser;
  rng: Rng;
}

/** The hidden person's answer to the question the engine asked; null when it is not one a person answers (profile facts). */
function answerQuestion(q: NextQuestion, env: InterviewEnv): Evidence | null {
  const { ctx, value, rng } = env;
  const worth = (id: string): number => value(ctx.index.get(id)!);
  const tap = { strength: 'normal', source: 'tap' } as const;
  switch (q.kind) {
    case 'pick_from_shortlist':
      return { ...tap, type: 'pick_from_set', set: q.set, chosen: q.set[chooseProbit(q.set.map(worth), ctx.scale, rng)]! };
    case 'pair': {
      const [a, b] = chooseProbit([worth(q.a), worth(q.b)], ctx.scale, rng) === 0 ? [q.a, q.b] : [q.b, q.a];
      return { ...tap, type: 'prefer_area', a, b };
    }
    case 'time_tradeoff': {
      const trips = env.profile.anchors[0]!.tripsPerWeek;
      return { ...tap, type: 'time_tradeoff', yen: q.yen, minutes: q.minutes, accept: acceptsTradeoff(env.user, q.yen, monthlyHours(q.minutes, trips), ctx.scale, rng) };
    }
    case 'profile_fact':
      return null;
  }
}

export function runSimulation(eng: EngineModules, input: SimulationInput): SimulationResult {
  const people = input.people ?? DEFAULT_PEOPLE;
  const maxQ = input.questions ?? DEFAULT_QUESTIONS;
  const seed = input.seed ?? DEFAULT_SEED;
  const areas = [...input.areas];

  // The engine under test and the hidden people use different seeds, and different models.
  const engine = eng.createEngine(areas, input.params, seed);
  const pr = engine.setProfile(input.profile, input.anchorTimes);
  const profile = engine.snapshot().profile;
  const ctx = eng.buildAreaContext(areas, input.params, profile, input.anchorTimes);
  const hiddenSeed = (seed ^ 0x5bd1e995) >>> 0;
  const users = generateUsers(people, hiddenSeed);
  // Each person lives in one draw of the rent and travel-time errors the engine models, so "truly best" means best in their own world.
  const feasibleIdx = Array.from(ctx.feasible.keys()).filter((a) => ctx.feasible[a]);
  const truth = eng.noisyUtilities(asBelief(users, ctx.scale), ctx, profile, hiddenSeed, feasibleIdx);
  const column = new Map(feasibleIdx.map((a, c) => [a, c]));
  const nA = ctx.areas.length;
  const rng = createRng((seed ^ 0x2545f491) >>> 0);

  const filler = createFormFiller(users);
  const candidates = formCandidates(ctx, profile.layout ?? '1K');
  const monthlyBudgetYen = profile.budget?.value ?? ctx.scale;
  const maxCommuteMinutes = profile.commuteCap?.value ?? profile.anchors[0]?.cap?.value ?? 180;

  const sample: RunSample = { agentRegret: Array.from({ length: maxQ + 1 }, () => []), formRegret: [], calibration: [], questionsAsked: [], stopReasons: {} };
  let skipped = 0;
  let carried = 0;
  let observeErrors = 0;

  for (let p = 0; p < people; p++) {
    const value = (a: number): number => truth.u[p * feasibleIdx.length + column.get(a)!]!;
    let best = -Infinity;
    for (const a of feasibleIdx) if (value(a) > best) best = value(a);
    const formPick = formTopPick(eng.scoring, candidates, { monthlyBudgetYen, maxCommuteMinutes, preferences: filler.preferences(users[p]!) });
    if (!Number.isFinite(best) || formPick === null) {
      skipped++;
      continue;
    }

    // Reset the engine to the prior (the same engine object keeps its feasible set and utility matrix).
    for (const e of engine.snapshot().evidence) if (e.id) engine.removeEvidence(e.id);

    const env: InterviewEnv = { ctx, profile, value, user: users[p]!, rng };
    const regrets: number[] = [];
    const judged: CalibrationSample[] = [];
    let rec: Recommendation | undefined;
    for (let q = 0; q <= maxQ; q++) {
      rec = engine.recommend(SHORTLIST_K);
      const top = rec.shortlist[0];
      if (top === undefined) break;
      regrets.push(Math.max(0, best - value(ctx.index.get(top.localityId)!)));
      const shortlistBest = Math.max(...rec.shortlist.map((s) => value(ctx.index.get(s.localityId)!)));
      judged.push({
        pBest: top.pBest,
        topIsBest: value(ctx.index.get(top.localityId)!) >= best,
        riskYen: rec.riskYen,
        realisedRegretYen: Math.max(0, best - shortlistBest),
      });
      if (q === maxQ) break;
      const evidence = rec.shouldStop || rec.nextQuestion === null ? null : answerQuestion(rec.nextQuestion, env);
      if (evidence === null) {
        carried += maxQ - q;
        break;
      }
      if (!engine.observe(evidence).ok) observeErrors++;
    }
    if (rec === undefined || regrets.length === 0) {
      skipped++;
      continue;
    }
    while (regrets.length <= maxQ) regrets.push(regrets[regrets.length - 1]!);
    regrets.forEach((r, q) => sample.agentRegret[q]!.push(r));
    const formValue = value(ctx.index.get(formPick)!);
    sample.formRegret.push(Math.max(0, best - formValue));
    sample.calibration.push(...judged);
    sample.questionsAsked.push(judged.length - 1);
    const reason = rec.stopReason ?? 'none';
    sample.stopReasons[reason] = (sample.stopReasons[reason] ?? 0) + 1;
  }

  return {
    ...sample,
    rows: summarise(sample.agentRegret),
    people,
    maxQuestions: maxQ,
    seed,
    areas: nA,
    feasibleAreas: pr.feasibleCount,
    scaleYen: ctx.scale,
    skippedPeople: skipped,
    carriedForward: carried,
    observeErrors,
  };
}

// ---------- Pooling and report ----------

/** One row of the agent-vs-form table: mean regret with bootstrap 95% intervals, and the paired gap (form minus agent). */
export interface ComparisonRow {
  questions: number;
  agent: { meanYen: number; ci: Interval };
  form: { meanYen: number; ci: Interval };
  /** Positive when the agent has less regret than the form. */
  gap: { meanYen: number; ci: Interval };
}

export interface Pooled extends RunSample {
  runs: number;
  people: number;
}

export function pool(results: readonly SimulationResult[]): Pooled {
  const maxQ = results[0]!.maxQuestions;
  const stopReasons: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.stopReasons)) stopReasons[k] = (stopReasons[k] ?? 0) + v;
  return {
    runs: results.length,
    people: results.reduce((s, r) => s + r.formRegret.length, 0),
    agentRegret: Array.from({ length: maxQ + 1 }, (_, q) => results.flatMap((r) => r.agentRegret[q]!)),
    formRegret: results.flatMap((r) => r.formRegret),
    calibration: results.flatMap((r) => r.calibration),
    questionsAsked: results.flatMap((r) => r.questionsAsked),
    stopReasons,
  };
}

export function compare(pooled: Pooled, seed: number): ComparisonRow[] {
  const columns = [...pooled.agentRegret, pooled.formRegret];
  const formColumn = columns.length - 1;
  const resamples = bootstrapMeans(columns, seed);
  const spread = (value: (means: number[]) => number): Interval => interval95(resamples.map(value));
  return pooled.agentRegret.map((agent, q) => ({
    questions: q,
    agent: { meanYen: mean(agent), ci: spread((m) => m[q]!) },
    form: { meanYen: mean(pooled.formRegret), ci: spread((m) => m[formColumn]!) },
    gap: { meanYen: mean(pooled.formRegret) - mean(agent), ci: spread((m) => m[formColumn]! - m[q]!) },
  }));
}

const yen = (x: number): string => Math.round(x).toLocaleString('en-US');
const ci = (i: Interval): string => `[${yen(i.low)}, ${yen(i.high)}]`;

export function formatTable(result: SimulationResult): string {
  const col = (x: number): string => yen(x).padStart(10);
  const lines = ['questions  people    median yen/mo     p90 yen/mo    mean yen/mo'];
  for (const r of result.rows) {
    lines.push(`${String(r.questions).padStart(9)}  ${String(r.n).padStart(6)}  ${col(r.medianYen)}     ${col(r.p90Yen)}    ${col(r.meanYen)}`);
  }
  return lines.join('\n');
}

export function formatComparison(rows: readonly ComparisonRow[]): string {
  const lines = ['questions        agent mean [95% CI]            form mean [95% CI]        form minus agent [95% CI]'];
  for (const r of rows) {
    const cell = (c: { meanYen: number; ci: Interval }, width: number): string => `${yen(c.meanYen)} ${ci(c.ci)}`.padEnd(width);
    lines.push(`${String(r.questions).padStart(9)}    ${cell(r.agent, 28)} ${cell(r.form, 28)} ${cell(r.gap, 28)}`);
  }
  return lines.join('\n');
}

export function formatCalibration(cal: Calibration): string {
  const pct = (x: number): string => (Number.isNaN(x) ? '    -' : `${(100 * x).toFixed(1)}%`.padStart(6));
  const lines = [`Reliability of pBest (top pick of ${cal.samples} recommendations), ECE ${cal.ece.toFixed(4)}`, 'pBest bin       n   mean pBest   top pick truly best'];
  for (const b of cal.pBestBins) lines.push(`${b.from.toFixed(1)}-${b.to.toFixed(1)}  ${String(b.n).padStart(7)}   ${pct(b.meanPBest)}       ${pct(b.hitRate)}`);
  lines.push('', 'Reported risk (deciles) vs realised shortlist regret, yen/mo', 'decile       n   mean risk   realised regret');
  cal.riskBins.forEach((b, i) => lines.push(`${String(i + 1).padStart(6)}  ${String(b.n).padStart(6)}  ${yen(b.meanRiskYen).padStart(9)}   ${yen(b.meanRealisedRegretYen).padStart(10)}`));
  return lines.join('\n');
}

// ---------- Data ----------

interface Scenario {
  /** Anchor name for the report. */
  label: string;
  anchorTimes: AnchorTimes;
}

interface Dataset {
  label: 'synthetic' | 'local-database';
  areas: AreaFeatures[];
  params: ModelParams;
  profile: Profile;
  scenarios: Scenario[];
  anchorDescription: string;
}

const SYNTHETIC_ANCHORS = 3;

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
  // The fixtures pin the evidence noise shares; leaving them out makes the engine use its own fallbacks, which is what CI should measure.
  const params: ModelParams = { ...syn.SYNTHETIC_PARAMS, betaShare: undefined, tauShare: undefined };
  return {
    label: 'synthetic',
    areas,
    params,
    profile: syn.syntheticProfile({ commuteCap: { value: 60, firm: true } }),
    scenarios: Array.from({ length: SYNTHETIC_ANCHORS }, (_, i) => ({
      label: `synthetic anchor ${i + 1}`,
      anchorTimes: syn.syntheticTimes(areas, 'work', 11 + i),
    })),
    anchorDescription: `${SYNTHETIC_ANCHORS} synthetic anchors, one-way minutes 10 to 70; synthetic fixtures with an imposed urban/quiet trade-off`,
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

async function realDataset(anchorStations: readonly string[]): Promise<Dataset & { close: () => Promise<void> }> {
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
  const anchorAt = (stationId: string): Profile['anchors'][number] => ({ id: 'work', label: 'Fixed central anchor', stationId, tripsPerWeek: 5, period: 'peak' });
  const scenarios: Scenario[] = [];
  for (const stationId of anchorStations) {
    const { times, refused } = await compute([anchorAt(stationId)], store.areas);
    if (refused.length > 0) throw new Error(`Anchor refused: ${refused[0]!.message}`);
    scenarios.push({ label: stationId, anchorTimes: times });
  }
  return {
    label: 'local-database',
    areas: store.areas,
    params: store.params,
    profile: {
      anchors: [anchorAt(anchorStations[0]!)],
      layout: '1K',
      budget: { value: 100000, firm: false },
      commuteCap: { value: 60, firm: true },
      enoughMultipliers: {},
    },
    scenarios,
    anchorDescription: `station groups ${anchorStations.join(', ')}, peak, 5 trips per week, one-way minutes from the API's own transit graph`,
    close: () => pool.end(),
  };
}

// ---------- Baseline ----------

export interface Baseline {
  kind: 'matchi-eval-baseline';
  /** The CI run: synthetic fixtures. Real-data numbers are reported, never gated. */
  data: 'synthetic';
  config: { people: number; seeds: number; questions: number; seed: number };
  /** Mean regret of the agent after the last question, yen per month. */
  meanRegretAtLastQuestionYen: number;
  /** Expected calibration error of pBest. */
  ece: number;
  formMeanRegretYen: number;
  gate: { regretFactor: number; eceTolerance: number; note: string };
}

export interface Verdict {
  ok: boolean;
  failures: string[];
}

export function checkAgainstBaseline(current: { meanRegretAtLastQuestionYen: number; ece: number }, baseline: Baseline): Verdict {
  const failures: string[] = [];
  const regretLimit = baseline.meanRegretAtLastQuestionYen * baseline.gate.regretFactor;
  if (!(current.meanRegretAtLastQuestionYen <= regretLimit)) {
    failures.push(`mean regret after the last question ${yen(current.meanRegretAtLastQuestionYen)} yen/mo exceeds ${yen(regretLimit)} (baseline ${yen(baseline.meanRegretAtLastQuestionYen)} x ${baseline.gate.regretFactor})`);
  }
  const eceLimit = baseline.ece + baseline.gate.eceTolerance;
  if (!(current.ece <= eceLimit)) {
    failures.push(`ECE ${current.ece.toFixed(4)} exceeds ${eceLimit.toFixed(4)} (baseline ${baseline.ece.toFixed(4)} + ${baseline.gate.eceTolerance})`);
  }
  return { ok: failures.length === 0, failures };
}

// ---------- CLI ----------

function arg(name: string, argv: readonly string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function runAll(eng: EngineModules, data: Dataset, config: Baseline['config']): Promise<SimulationResult[]> {
  const results: SimulationResult[] = [];
  for (const scenario of data.scenarios) {
    for (let s = 0; s < config.seeds; s++) {
      results.push(
        runSimulation(eng, { areas: data.areas, params: data.params, anchorTimes: scenario.anchorTimes, profile: data.profile, people: config.people, questions: config.questions, seed: config.seed + s }),
      );
    }
  }
  return results;
}

export async function main(argv: readonly string[]): Promise<void> {
  const checkBaseline = argv.includes('--check-baseline');
  const synthetic = argv.includes('--synthetic') || checkBaseline;
  const baseline = checkBaseline ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline) : undefined;
  const config: Baseline['config'] = baseline?.config ?? {
    people: Number(arg('--people', argv) ?? DEFAULT_PEOPLE),
    seeds: Number(arg('--seeds', argv) ?? DEFAULT_SEEDS),
    questions: Number(arg('--questions', argv) ?? DEFAULT_QUESTIONS),
    seed: Number(arg('--seed', argv) ?? DEFAULT_SEED),
  };
  const anchors = arg('--anchors', argv)?.split(',') ?? DEFAULT_ANCHOR_STATIONS;
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(arg('--out', argv) ?? resolve(here, 'out/simulate.json'));

  const eng = await loadEngine();
  const data = synthetic ? await syntheticDataset() : await realDataset(anchors);
  const t0 = Date.now();
  const results = await runAll(eng, data, config);
  const seconds = (Date.now() - t0) / 1000;
  if ('close' in data) await (data as { close: () => Promise<void> }).close();

  const pooled = pool(results);
  const rows = compare(pooled, config.seed);
  const calibration = calibrate(pooled.calibration);
  const last = rows[rows.length - 1]!;
  const sum = (pick: (r: SimulationResult) => number): number => results.reduce((s, r) => s + pick(r), 0);
  const first = results[0]!;

  console.log(`Simulated users: ${pooled.people} hidden people (${config.people} per seed and anchor, ${config.seeds} seeds x ${data.scenarios.length} anchors), data = ${data.label}, ${first.areas} areas (${first.feasibleAreas} feasible)`);
  console.log(`Anchors: ${data.anchorDescription}`);
  console.log(`Limits: ${data.profile.layout}, budget ${data.profile.budget?.value} soft, commute cap ${data.profile.commuteCap?.value} min firm. Scale ${Math.round(first.scaleYen)} yen.`);
  console.log(formatComparison(rows));
  console.log(`Regret = hidden person's value of their true best feasible area minus their value of the pick, yen per month. The form's regret does not depend on questions.`);
  console.log(`Questions asked per person: mean ${mean(pooled.questionsAsked).toFixed(2)}; interviews ended by ${JSON.stringify(pooled.stopReasons)}`);
  console.log(formatCalibration(calibration));
  console.log(`Skipped people: ${sum((r) => r.skippedPeople)}; carried forward: ${sum((r) => r.carriedForward)}; observe errors: ${sum((r) => r.observeErrors)}; run time ${seconds.toFixed(1)}s`);

  const current = { meanRegretAtLastQuestionYen: last.agent.meanYen, ece: calibration.ece };
  const json = {
    kind: 'matchi-eval-simulate',
    data: data.label,
    anchor: data.anchorDescription,
    profile: data.profile,
    config: { ...config, shortlistSize: SHORTLIST_K, peopleTotal: pooled.people },
    scaleYen: first.scaleYen,
    skippedPeople: sum((r) => r.skippedPeople),
    carriedForward: sum((r) => r.carriedForward),
    observeErrors: sum((r) => r.observeErrors),
    questionsAskedMean: mean(pooled.questionsAsked),
    stopReasons: pooled.stopReasons,
    regretByQuestions: rows,
    calibration,
    runSeconds: seconds,
    note: 'Hidden people come from a different model than the engine prior; real people are still not modelled by this.',
  };
  if (!argv.includes('--no-write') && !checkBaseline) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(json, null, 2) + '\n');
    console.log(`Wrote ${outPath}`);
  }

  if (argv.includes('--write-baseline')) {
    if (data.label !== 'synthetic') throw new Error('The baseline is recorded in synthetic mode (--synthetic), which is what CI runs.');
    const recorded: Baseline = {
      kind: 'matchi-eval-baseline',
      data: 'synthetic',
      config,
      ...current,
      formMeanRegretYen: last.form.meanYen,
      gate: {
        ...GATE,
        note: 'CI fails if mean regret after the last question exceeds meanRegretAtLastQuestionYen x regretFactor, or ECE exceeds ece + eceTolerance (absolute). Rerecord with: pnpm eval:sim --synthetic --write-baseline',
      },
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(recorded, null, 2) + '\n');
    console.log(`Wrote ${BASELINE_PATH}`);
  }

  if (baseline) {
    const verdict = checkAgainstBaseline(current, baseline);
    console.log(verdict.ok ? 'Baseline check: PASS' : `Baseline check: FAIL\n  ${verdict.failures.join('\n  ')}`);
    if (!verdict.ok) process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
