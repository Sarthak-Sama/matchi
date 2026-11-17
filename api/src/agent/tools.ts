// The nine agent tools: zod-validated input, compact rounded JSON out, and
// typed error results instead of exceptions (docs/plans/agent-harness-plan.md, "Tools").
import { AnchorSchema, EvidenceSchema, FeatureKeySchema, LimitSchema, ProfileSchema } from "@tokyo/shared";
import type {
  AreaFeatures,
  BeliefSummary,
  Breakdown,
  ComputeAnchorTimes,
  Comparison,
  Profile,
  ProfileResult,
  Recommendation,
  RelaxOption,
  WhyNot,
} from "@tokyo/shared";
import { z } from "zod";

import type { DbPool } from "../db.js";
import {
  escapeLikeWildcards,
  similarityScoreSql,
  STATION_GROUP_MATCH_COLUMNS,
  textMatchSql,
} from "../routes/lib/text-ranking.js";
import type { FeatureStore } from "./feature-store.js";
import type { AgentSession } from "./session.js";
import { guardAgentSql } from "./sql-guard.js";

// ---------- Context and result types ----------

/** A pg Pool satisfies this; connect() is needed only by query_areas. */
export interface AgentPool extends DbPool {
  connect?: () => Promise<{ query(text: string, params?: unknown[]): Promise<unknown>; release(): void }>;
}

export interface ToolContext {
  session: AgentSession;
  features: Pick<FeatureStore, "areas" | "areaIndex">;
  computeAnchorTimes: ComputeAnchorTimes;
  pool: AgentPool;
  /** AGENT_QUERY_AREAS === "1". */
  queryAreasEnabled: boolean;
}

export type ToolErrorCode =
  | "invalid_input"
  | "unknown_tool"
  | "unknown_area"
  | "unknown_evidence_id"
  | "unknown_layout"
  | "same_area"
  | "profile_incomplete"
  | "anchor_times_unavailable"
  | "lookup_failed"
  | "engine_error"
  | "budget_exceeded"
  | "disabled"
  | "sql_rejected"
  | "query_failed";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: unknown;
}

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: ToolError };

export const TOOL_NAMES = [
  "lookup",
  "set_profile",
  "observe",
  "remove_evidence",
  "recommend",
  "why_not",
  "relax",
  "compare",
  "query_areas",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
/** Tools after which the harness makes sure a fresh recommend is in the turn. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["set_profile", "observe", "remove_evidence"]);

interface ToolDef<S extends z.ZodType> {
  name: ToolName;
  description: string;
  schema: S;
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}

const fail = (code: ToolErrorCode, message: string, details?: unknown): ToolResult => ({
  ok: false,
  error: details === undefined ? { code, message } : { code, message, details },
});
const ok = (result: unknown): ToolResult => ({ ok: true, result });

// ---------- Rounding and labels ----------

/** Rent: nearest 1,000 yen. */
export const roundRent = (yen: number): number => Math.round(yen / 1000) * 1000;
/** Other yen amounts (regret, risk, breakdown terms): nearest 100 yen. */
export const roundYen = (yen: number): number => Math.round(yen / 100) * 100;
export const roundMinutes = (m: number): number => Math.round(m);
/** Probability in [0,1] to whole percent. */
export const toPercent = (p: number): number => Math.round(p * 100);
const roundHours = (h: number): number => Math.round(h * 10) / 10;
const finiteOrNull = <T>(v: number | null | undefined, f: (n: number) => T): T | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : f(v);

function areaNames(area: AreaFeatures | undefined): { untrusted_text: Record<string, string | null> } | null {
  if (area === undefined) return null;
  return {
    untrusted_text: {
      name_en: area.name_en,
      name_ja: area.name_ja,
      ward_name_en: area.ward_name_en,
      ward_name_ja: area.ward_name_ja,
    },
  };
}

function areaRef(ctx: ToolContext, id: string): Record<string, unknown> {
  const idx = ctx.features.areaIndex.get(id);
  const area = idx === undefined ? undefined : ctx.features.areas[idx];
  return { area_id: id, names: areaNames(area) };
}

function formatBreakdown(b: Breakdown): Record<string, unknown> {
  const features: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.features)) features[k] = roundYen(v);
  return {
    unit: "yen per month",
    label: "value at the mean of the belief; negative is a cost",
    rent: roundRent(b.rent),
    time_cost: roundYen(b.timeCost),
    features,
    budget_penalty: roundYen(b.budgetPenalty),
    cap_penalty: roundYen(b.capPenalty),
    total: roundYen(b.total),
  };
}

export function formatBelief(belief: BeliefSummary): Record<string, unknown> {
  return {
    effective_samples: { value: Math.round(belief.ess), unit: "samples", label: "effective sample size" },
    low_confidence: belief.lowConfidence,
    scale_yen: roundRent(belief.scale),
    scale_label: "budget, or median modelled rent of reachable areas",
    params: belief.params.map((p) =>
      p.shareOfBudget
        ? {
            param: p.param,
            unit: "percent of scale",
            label: "worth per month at the 10th, 50th and 90th percentile",
            p10: toPercent(p.shareOfBudget.p10),
            median: toPercent(p.shareOfBudget.median),
            p90: toPercent(p.shareOfBudget.p90),
          }
        : {
            param: p.param,
            unit: "none",
            label: "10th, 50th and 90th percentile",
            p10: Math.round(p.p10 * 100) / 100,
            median: Math.round(p.median * 100) / 100,
            p90: Math.round(p.p90 * 100) / 100,
          },
    ),
  };
}

function formatRelax(options: readonly RelaxOption[]): Record<string, unknown>[] {
  return options.map((o) => ({
    limit: o.limit,
    step: o.limit === "budget" ? { percent: toPercent(o.step), label: "budget raised by" } : { minutes: roundMinutes(o.step), label: "commute cap raised by" },
    new_value:
      o.limit === "budget"
        ? { yen: roundRent(o.newValue), label: "new monthly budget" }
        : { minutes: roundMinutes(o.newValue), label: "new one-way commute cap" },
    areas_gained: { count: o.areasGained, unit: "areas", label: "areas that become feasible" },
    yen_gained: { yen: roundYen(o.yenGained), label: "expected gain in value per month" },
    binding: o.binding,
  }));
}

export function formatRecommendation(rec: Recommendation, ctx: ToolContext): Record<string, unknown> {
  const nq = rec.nextQuestion;
  return {
    shortlist: rec.shortlist.map((item) => ({
      area_id: item.localityId,
      names: {
        untrusted_text: { name_en: item.nameEn, name_ja: item.nameJa, ward_name_en: item.wardNameEn },
      },
      rent_yen: roundRent(item.rentYen),
      rent_label: "modelled monthly rent, ward-level estimate",
      commute_minutes: finiteOrNull(item.commuteMinutes, roundMinutes),
      commute_label: "estimated one-way minutes to the main anchor",
      monthly_travel_hours: finiteOrNull(item.monthlyTravelHours, roundHours),
      monthly_travel_label: "estimated hours of travel per month",
      chance_best_percent: toPercent(item.pBest),
      chance_best_label: "chance this is the best area for you",
      regret_yen: roundYen(item.regretYen),
      regret_label: "expected yen per month lost if this is picked and is not best",
      role: item.role,
      breakdown: formatBreakdown(item.breakdown),
      vs_median: formatBreakdown(item.vsMedian),
      confidence: {
        rent: item.confidence.rent,
        access: item.confidence.access,
        commute_band_minutes: roundMinutes(item.confidence.commuteBandMinutes),
        commute_band_label: "plus or minus on the commute estimate",
        late_return_not_covered: item.confidence.lateReturnNotCovered,
      },
      ...(item.similarNearby ? { similar_nearby: item.similarNearby } : {}),
    })),
    feasible_count: { count: rec.feasibleCount, unit: "areas", label: "areas within your firm limits" },
    value_at_risk_yen: roundYen(rec.riskYen),
    value_at_risk_label: "expected yen per month lost by stopping now",
    should_stop: rec.shouldStop,
    stop_reason: rec.stopReason,
    next_question:
      nq === null
        ? null
        : nq.kind === "pair"
          ? {
              kind: "pair",
              a: areaRef(ctx, nq.a),
              b: areaRef(ctx, nq.b),
              a_beats_b_percent: toPercent(nq.pABeatsB),
              a_beats_b_label: "chance the first area beats the second",
            }
          : nq.kind === "pick_from_shortlist"
            ? { kind: "pick_from_shortlist", set: nq.set.map((id) => areaRef(ctx, id)) }
            : nq,
    excluded: { ...rec.excluded, unit: "areas", label: "areas excluded, by first reason" },
    ...(rec.relax ? { relax: formatRelax(rec.relax) } : {}),
    ...(rec.alternative
      ? {
          alternative: {
            ...areaRef(ctx, rec.alternative.localityId),
            param: rec.alternative.param,
            weight_percent: toPercent(rec.alternative.weight),
            weight_label: "share of the belief under which this area wins",
          },
        }
      : {}),
  };
}

function formatProfile(p: Profile): Record<string, unknown> {
  return {
    anchors: p.anchors.map((a, i) => ({
      id: a.id,
      label: a.label,
      main: i === 0,
      station_id: a.stationId ?? null,
      point: a.point ?? null,
      trips_per_week: a.tripsPerWeek,
      period: a.period,
      late_return: a.lateReturn ?? false,
    })),
    layout: p.layout ?? null,
    budget: p.budget ? { yen: p.budget.value, firm: p.budget.firm, label: "monthly rent budget" } : null,
    commute_cap: p.commuteCap
      ? { minutes: p.commuteCap.value, firm: p.commuteCap.firm, label: "one-way minutes to the main anchor" }
      : null,
    enough_multipliers: p.enoughMultipliers,
  };
}

function formatWhyNot(w: WhyNot, ctx: ToolContext): Record<string, unknown> {
  const base = areaRef(ctx, w.localityId);
  switch (w.kind) {
    case "unknown_area":
    case "is_top_pick":
      return { kind: w.kind, ...base };
    case "fails_firm_limit":
      return {
        kind: w.kind,
        ...base,
        limit: w.limit,
        by: w.unit === "yen" ? roundRent(w.by) : w.unit === "minutes" ? roundMinutes(w.by) : w.by,
        unit: w.unit,
        label: "amount by which the area misses the limit",
      };
    case "wins_for_some":
      return {
        kind: w.kind,
        ...base,
        param: w.param,
        weight_percent: toPercent(w.weight),
        weight_label: "share of the belief under which this area wins",
        ratio: Math.round(w.ratio * 10) / 10,
        ratio_label: "how far that parameter differs from your median",
      };
    case "needs_weight_change":
      return {
        kind: w.kind,
        ...base,
        term: w.term,
        factor: Math.round(w.factor * 10) / 10,
        factor_label: "multiplier on that term needed to make it the top pick",
        gap_yen: roundYen(w.gapYen),
        gap_label: "yen per month behind the top pick",
      };
    case "dominated":
      return { kind: w.kind, ...base, gap_yen: roundYen(w.gapYen), gap_label: "yen per month behind the top pick" };
  }
}

function formatComparison(c: Comparison, ctx: ToolContext): Record<string, unknown> {
  return {
    a: areaRef(ctx, c.a),
    b: areaRef(ctx, c.b),
    diff: { ...formatBreakdown(c.diff), label: "first area minus second, yen per month at the mean of the belief" },
    a_beats_b_percent: toPercent(c.pABeatsB),
    a_beats_b_label: "chance the first area beats the second",
  };
}

// ---------- Lookup SQL (same helpers and shape as routes/places.ts and routes/stations.ts) ----------

const LOOKUP_LIMIT = 5;

const LOOKUP_STATIONS_SQL = `
  SELECT
    sg.station_group_id AS id,
    sg.name_en AS "nameEn",
    sg.name_ja AS "nameJa",
    ST_Y(sg.point) AS lat,
    ST_X(sg.point) AS lon
  FROM public.station_groups sg
  WHERE ${textMatchSql(STATION_GROUP_MATCH_COLUMNS, "$1")}
  ORDER BY ${similarityScoreSql(STATION_GROUP_MATCH_COLUMNS, "$1")} DESC, sg.name_en ASC
  LIMIT $2
`;

const POI_MATCH_COLUMNS = { text: ["p.name", "p.name_en"], arrays: ["p.aliases"] } as const;
const LOOKUP_PLACES_SQL = `
  SELECT kind, id, "nameEn", "nameJa", category, lat, lon
  FROM (
    SELECT 'station' AS kind, sg.station_group_id AS id, sg.name_en AS "nameEn", sg.name_ja AS "nameJa",
      NULL::text AS category, ST_Y(sg.point) AS lat, ST_X(sg.point) AS lon, 0 AS destination_priority,
      ${similarityScoreSql(STATION_GROUP_MATCH_COLUMNS, "$1")} AS score
    FROM public.station_groups sg
    WHERE ${textMatchSql(STATION_GROUP_MATCH_COLUMNS, "$1")}
    UNION ALL
    SELECT 'poi' AS kind, 'poi:' || p.id AS id, p.name_en AS "nameEn", p.name AS "nameJa",
      p.category AS category, ST_Y(p.point) AS lat, ST_X(p.point) AS lon,
      CASE WHEN p.category = 'landmark' THEN 0 ELSE 1 END AS destination_priority,
      ${similarityScoreSql(POI_MATCH_COLUMNS, "$1")} AS score
    FROM public.pois p
    WHERE COALESCE(p.name_en, p.name) IS NOT NULL AND ${textMatchSql(POI_MATCH_COLUMNS, "$1")}
  ) matches
  ORDER BY destination_priority ASC, score DESC, "nameEn" ASC
  LIMIT $2
`;

interface LookupRow {
  kind?: "station" | "poi";
  id: string;
  nameEn: string | null;
  nameJa: string | null;
  category?: string | null;
  lat: number;
  lon: number;
}

const point = (lat: number, lon: number) => ({
  lat: Math.round(lat * 1e5) / 1e5,
  lon: Math.round(lon * 1e5) / 1e5,
  label: "WGS84 degrees",
});

function searchAreas(areas: readonly AreaFeatures[], query: string): AreaFeatures[] {
  const q = query.normalize("NFKC").toLowerCase();
  const fields = (a: AreaFeatures) =>
    [a.name_en, a.name_ja, a.ward_name_en, a.ward_name_ja].map((s) => (s ?? "").normalize("NFKC").toLowerCase());
  const scored: { area: AreaFeatures; score: number }[] = [];
  for (const area of areas) {
    const [en, ja, wardEn, wardJa] = fields(area);
    let score = -1;
    if (en === q || ja === q) score = 3;
    else if (en!.startsWith(q) || ja!.startsWith(q)) score = 2;
    else if (en!.includes(q) || ja!.includes(q)) score = 1;
    else if (wardEn!.includes(q) || wardJa!.includes(q)) score = 0;
    if (score >= 0) scored.push({ area, score });
  }
  scored.sort((a, b) => b.score - a.score || a.area.locality_id.localeCompare(b.area.locality_id));
  return scored.slice(0, LOOKUP_LIMIT).map((s) => s.area);
}

// ---------- Tool definitions ----------

const AreaIdSchema = z.string().min(1).max(100);

const ProfileAnchorInputSchema = AnchorSchema.extend({ id: z.string().min(1).optional() });
const SetProfileInputSchema = z
  .object({
    anchors: z.array(ProfileAnchorInputSchema).max(5).optional(),
    layout: z.string().min(1).optional(),
    budget: LimitSchema.optional(),
    commuteCap: LimitSchema.optional(),
    enoughMultipliers: z.partialRecord(FeatureKeySchema, z.number().positive()).optional(),
  })
  .strict();

function defineTools(layouts: () => readonly string[]) {
  const lookup: ToolDef<z.ZodType<{ kind: "area" | "station" | "place"; query: string }>> = {
    name: "lookup",
    description:
      "Find areas, stations or places by name (English or Japanese). Returns up to 5 matches with ids. " +
      "Every area id, station id or point used in other tools must come from here.",
    schema: z.object({ kind: z.enum(["area", "station", "place"]), query: z.string().min(1).max(100) }).strict(),
    async run({ kind, query }, ctx) {
      if (kind === "area") {
        const matches = searchAreas(ctx.features.areas, query).map((a) => ({
          area_id: a.locality_id,
          ward_code: a.ward_code,
          names: areaNames(a),
          point: point(a.lat, a.lon),
        }));
        return ok({ kind, matches });
      }
      try {
        const sql = kind === "station" ? LOOKUP_STATIONS_SQL : LOOKUP_PLACES_SQL;
        const result = (await ctx.pool.query(sql, [escapeLikeWildcards(query), LOOKUP_LIMIT])) as { rows: LookupRow[] };
        const matches = result.rows.map((r) => ({
          kind: r.kind ?? "station",
          // A station id goes in anchor.stationId; a place goes in anchor.point.
          ...(r.kind === "poi" ? { place_id: r.id } : { station_id: r.id }),
          names: { untrusted_text: { name_en: r.nameEn, name_ja: r.nameJa, category: r.category ?? null } },
          point: point(r.lat, r.lon),
        }));
        return ok({ kind, matches });
      } catch {
        return fail("lookup_failed", "The search could not be run; try again or use another kind.");
      }
    },
  };

  const setProfile: ToolDef<typeof SetProfileInputSchema> = {
    name: "set_profile",
    description:
      "Store facts about the person's life: anchors (places they travel to, each with a station id from lookup " +
      "or a point, trips per week, peak or offpeak), layout, budget (monthly yen, firm or not), commute cap " +
      "(one-way minutes to the first anchor, firm or not), and per-feature 'enough' multipliers. Partial updates: " +
      "fields left out keep their value; anchors, when given, replace the list (the first is the main anchor).",
    schema: SetProfileInputSchema,
    async run(input, ctx) {
      const engine = ctx.session.engine;
      const current = engine.snapshot().profile;
      if (input.layout !== undefined && !layouts().includes(input.layout)) {
        return fail("unknown_layout", `Unknown layout "${input.layout}".`, { allowed: layouts() });
      }
      const merged = ProfileSchema.safeParse({
        ...current,
        ...(input.anchors
          ? { anchors: input.anchors.map((a, i) => ({ ...a, id: a.id ?? `anchor_${String(i + 1)}` })) }
          : {}),
        ...(input.layout !== undefined ? { layout: input.layout } : {}),
        ...(input.budget ? { budget: input.budget } : {}),
        ...(input.commuteCap ? { commuteCap: input.commuteCap } : {}),
        ...(input.enoughMultipliers
          ? { enoughMultipliers: { ...current.enoughMultipliers, ...input.enoughMultipliers } }
          : {}),
      });
      if (!merged.success) return fail("invalid_input", "The merged profile is not valid.", merged.error.issues);
      const profile = merged.data;

      let anchorResult: Awaited<ReturnType<ComputeAnchorTimes>>;
      try {
        anchorResult = await ctx.computeAnchorTimes(profile.anchors, ctx.features.areas as AreaFeatures[]);
      } catch {
        return fail("anchor_times_unavailable", "Travel times could not be computed right now; the profile was not changed.");
      }
      const { times, refused } = anchorResult;
      ctx.session.anchorTimes = times;
      const engineResult = engine.setProfile(profile, times);
      // Same merge as routes/agent-direct.ts: our refusals carry the real reason.
      const ours = new Set(refused.map((r) => r.anchorId));
      const result: ProfileResult = {
        ...engineResult,
        refusedAnchors: [
          ...refused,
          ...engineResult.refusedAnchors.filter((r) => !(r.reason === "no_times" && ours.has(r.anchorId))),
        ],
      };
      return ok({
        profile: formatProfile(result.profile),
        refused_anchors: result.refusedAnchors,
        feasible_count: { count: result.feasibleCount, unit: "areas", label: "areas within your firm limits" },
        missing: result.missing,
      });
    },
  };

  const observeSchema = z.object({ items: z.array(EvidenceSchema).min(1).max(10) }).strict();
  const observe: ToolDef<typeof observeSchema> = {
    name: "observe",
    description:
      "Record what the person values as evidence items. Each item has a type, its fields, a strength " +
      "(weak for hedged remarks, strong only for explicit repeated statements) and the quote it came from. " +
      "Area ids must come from lookup or a tool result.",
    schema: observeSchema,
    run({ items }, ctx) {
      const results = items.map((item) => {
        const r = ctx.session.engine.observe(item);
        if (!r.ok) return { ok: false, type: item.type, error: r.error };
        return {
          ok: true,
          id: r.id,
          type: item.type,
          how_expected_percent: toPercent(r.predictive),
          how_expected_label: "chance the current belief gave this answer",
          surprising: r.surprising,
          conflicts_with: r.conflictsWith ?? null,
        };
      });
      return ok({ items: results });
    },
  };

  const removeSchema = z.object({ id: z.string().min(1) }).strict();
  const removeEvidence: ToolDef<typeof removeSchema> = {
    name: "remove_evidence",
    description: "Remove one evidence item by id; the belief is replayed without it.",
    schema: removeSchema,
    run({ id }, ctx) {
      const engine = ctx.session.engine;
      if (!engine.snapshot().evidence.some((e) => e.id === id)) {
        return fail("unknown_evidence_id", `No evidence item "${id}" in this session.`);
      }
      engine.removeEvidence(id);
      return ok({ removed: id, belief: formatBelief(engine.beliefSummary()) });
    },
  };

  const recommendSchema = z.object({ k: z.number().int().min(1).max(10).optional() }).strict();
  const recommend: ToolDef<typeof recommendSchema> = {
    name: "recommend",
    description:
      "The shortlist with each area's chance of being best, regret, role, yen breakdown and confidence; value at " +
      "risk; should_stop; next_question; excluded counts. The only source of rankings.",
    schema: recommendSchema,
    run({ k }, ctx) {
      let rec: Recommendation;
      try {
        rec = ctx.session.engine.recommend(k);
      } catch (err) {
        return fail("profile_incomplete", err instanceof Error ? err.message : "No recommendation is possible yet.");
      }
      return ok(formatRecommendation(rec, ctx));
    },
  };

  const whyNotSchema = z.object({ area_id: AreaIdSchema }).strict();
  const whyNot: ToolDef<typeof whyNotSchema> = {
    name: "why_not",
    description: "Explain why an area is not the top pick.",
    schema: whyNotSchema,
    run({ area_id }, ctx) {
      if (!ctx.features.areaIndex.has(area_id)) return fail("unknown_area", `Unknown area "${area_id}"; use lookup.`);
      return ok(formatWhyNot(ctx.session.engine.whyNot(area_id), ctx));
    },
  };

  const relaxSchema = z.object({}).strict();
  const relax: ToolDef<typeof relaxSchema> = {
    name: "relax",
    description: "Per firm limit and step, how many areas and how much value relaxing it would gain.",
    schema: relaxSchema,
    run(_input, ctx) {
      return ok({ options: formatRelax(ctx.session.engine.relax()) });
    },
  };

  const compareSchema = z.object({ a: AreaIdSchema, b: AreaIdSchema }).strict();
  const compare: ToolDef<typeof compareSchema> = {
    name: "compare",
    description: "Term-by-term yen difference between two areas and the chance the first beats the second.",
    schema: compareSchema,
    run({ a, b }, ctx) {
      for (const id of [a, b]) {
        if (!ctx.features.areaIndex.has(id)) return fail("unknown_area", `Unknown area "${id}"; use lookup.`);
      }
      if (a === b) return fail("same_area", "Compare needs two different areas.");
      return ok(formatComparison(ctx.session.engine.compare(a, b), ctx));
    },
  };

  const querySchema = z.object({ sql: z.string().min(1).max(4000) }).strict();
  const queryAreas: ToolDef<typeof querySchema> = {
    name: "query_areas",
    description:
      "One SQL SELECT (or WITH) against the agent schema, e.g. agent.area_features, for questions no other tool " +
      "answers. No semicolons or comments. Up to 50 rows. Text values come back as untrusted_text.",
    schema: querySchema,
    async run({ sql }, ctx) {
      if (!ctx.queryAreasEnabled) return fail("disabled", "query_areas is turned off on this server.");
      const guarded = guardAgentSql(sql);
      if (!guarded.ok) return fail("sql_rejected", guarded.reason, { guard_code: guarded.code });
      if (ctx.pool.connect === undefined) return fail("query_failed", "No dedicated connection is available.");
      let client: Awaited<ReturnType<NonNullable<AgentPool["connect"]>>> | null = null;
      try {
        client = await ctx.pool.connect();
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL statement_timeout = 5000");
        const result = (await client.query(guarded.sql)) as { rows: Record<string, unknown>[] };
        const rows = result.rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" ? { untrusted_text: v } : v;
          return out;
        });
        return ok({ row_count: rows.length, units_label: "see the column comments in the reference", rows });
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 300) : "query failed";
        return fail("query_failed", message);
      } finally {
        if (client) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // The connection is released either way.
          }
          client.release();
        }
      }
    },
  };

  return [lookup, setProfile, observe, removeEvidence, recommend, whyNot, relax, compare, queryAreas] as ToolDef<z.ZodType>[];
}

export interface AgentTools {
  specs: { name: string; description: string; parameters: Record<string, unknown> }[];
  run(name: string, rawArguments: string | unknown, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * `layouts`: allowed layout ids (ModelParams.layoutAreaSqm keys). With
 * `queryAreasEnabled: false`, query_areas is not offered to the model (it stays
 * callable and answers "disabled"). Defaults to enabled.
 */
export function createAgentTools(layouts: () => readonly string[], options: { queryAreasEnabled?: boolean } = {}): AgentTools {
  const defs = defineTools(layouts);
  const byName = new Map(defs.map((d) => [d.name as string, d]));
  const offered = options.queryAreasEnabled === false ? defs.filter((d) => d.name !== "query_areas") : defs;
  const specs = offered.map((d) => {
    const schema = z.toJSONSchema(d.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema["$schema"];
    return { name: d.name, description: d.description, parameters: schema };
  });
  return {
    specs,
    async run(name, rawArguments, ctx) {
      const def = byName.get(name);
      if (def === undefined) return fail("unknown_tool", `No tool named "${name}".`, { tools: TOOL_NAMES });
      let parsedJson: unknown = rawArguments;
      if (typeof rawArguments === "string") {
        try {
          parsedJson = rawArguments.trim() === "" ? {} : JSON.parse(rawArguments);
        } catch {
          return fail("invalid_input", "Arguments are not valid JSON.");
        }
      }
      const parsed = def.schema.safeParse(parsedJson);
      if (!parsed.success) {
        return fail(
          "invalid_input",
          "Input failed validation.",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      try {
        return await def.run(parsed.data, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 300) : "The tool failed.";
        // Engine.compare throws Error{code:'unknown_area'} for ids it cannot use.
        const code = (err as { code?: unknown } | null)?.code;
        if (code === "unknown_area") return fail("unknown_area", message);
        return fail("engine_error", message);
      }
    },
  };
}
