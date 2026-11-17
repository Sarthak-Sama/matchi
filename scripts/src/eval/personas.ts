// Scripted personas: does the whole agent behave? (docs/plans/agent-harness-plan.md,
// "Evaluation", "Scripted personas".)
//
// Seven personas as data (user messages plus checks), checks that apply to every
// transcript, and a runner that replays each persona against a RUNNING API:
//   POST /v1/agent/session            -> { sessionId }
//   POST /v1/agent/turn {sessionId, message}   -> text/event-stream of AgentStreamEvent frames
// It needs a live model behind the API, so it is not run in CI or by the unit tests.
// The check functions are pure and are unit-tested on hand-built (synthetic) transcripts.
//
// Usage:
//   npx tsx scripts/src/eval/personas.ts [--base-url http://localhost:4000] [--persona id] [--out path]
//   Base URL: --base-url, else AGENT_BASE_URL, else http://localhost:4000 (the API's PORT default).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentStreamEventSchema } from '@tokyo/shared';
import type { AgentStateView, AgentStreamEvent, Profile, ShortlistItem } from '@tokyo/shared';

export const DEFAULT_BASE_URL = 'http://localhost:4000';
/** Harness limit from api/src/agent/loop.ts (MAX_TOOL_CALLS_PER_TURN). */
export const TOOL_BUDGET_PER_TURN = 6;

// ---------- Transcript model ----------

export interface Turn {
  message: string;
  httpStatus: number;
  events: AgentStreamEvent[];
  /** Frames that did not parse as an AgentStreamEvent (raw text, trimmed). */
  invalidFrames: string[];
}
export interface Transcript {
  persona: string;
  sessionId: string | null;
  turns: Turn[];
  /** Facts fetched after the conversation by Persona.afterRun (e.g. a compare call). */
  probes: Record<string, unknown>;
}
export interface CheckResult {
  name: string;
  pass: boolean;
  /** 'must' = a failure fails the persona; 'expected' = reported, heuristic or implied by the persona's wording. */
  severity: 'must' | 'expected';
  detail: string;
}
export type Check = (t: Transcript) => CheckResult;

// ---------- Transcript helpers ----------

type Ev<T extends AgentStreamEvent['type']> = Extract<AgentStreamEvent, { type: T }>;
const eventsOfType = <T extends AgentStreamEvent['type']>(turn: Turn, type: T): Ev<T>[] =>
  turn.events.filter((e): e is Ev<T> => e.type === type);

export const replyText = (turn: Turn): string => eventsOfType(turn, 'text').map((e) => e.delta).join('');
export const turnState = (turn: Turn): AgentStateView | null => eventsOfType(turn, 'state').at(-1)?.state ?? null;
export const finalState = (t: Transcript): AgentStateView | null => {
  for (let i = t.turns.length - 1; i >= 0; i--) {
    const s = turnState(t.turns[i]!);
    if (s) return s;
  }
  return null;
};
const shortlistOf = (s: AgentStateView | null): ShortlistItem[] => s?.recommendation?.shortlist ?? [];
const asRecord = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** Successful tool results by tool name, in order, across the whole transcript. */
export function toolResults(t: Transcript, name?: string): unknown[] {
  const out: unknown[] = [];
  for (const turn of t.turns) for (const e of eventsOfType(turn, 'tool_result')) if (e.ok && (name === undefined || e.name === name)) out.push(e.result);
  return out;
}
const isHarnessCall = (id: string): boolean => id.startsWith('harness_');
const ok = (name: string, pass: boolean, detail: string, severity: CheckResult['severity'] = 'must'): CheckResult => ({ name, pass, severity, detail });

const ANSWER_EVIDENCE = new Set(['pick_from_set', 'prefer_area', 'reject_area']);
/** Error codes that mean the model sent a bad call (as opposed to a legitimate "no" such as a refused anchor). */
const MODEL_FAULT_CODES = new Set(['invalid_input', 'unknown_tool', 'unknown_area', 'unknown_evidence_id', 'unknown_layout', 'same_area']);

// ---------- Checks applied to every transcript ----------

export const streamCompleted: Check = (t) => {
  const bad: string[] = [];
  t.turns.forEach((turn, i) => {
    if (turn.httpStatus !== 200) bad.push(`turn ${i + 1}: HTTP ${turn.httpStatus}`);
    if (turn.invalidFrames.length > 0) bad.push(`turn ${i + 1}: ${turn.invalidFrames.length} invalid frame(s)`);
    for (const e of eventsOfType(turn, 'error')) bad.push(`turn ${i + 1}: error ${e.code ?? ''} ${e.message}`.trim());
    if (turn.events.at(-1)?.type !== 'done') bad.push(`turn ${i + 1}: stream did not end with done`);
  });
  return ok('stream completes without errors', bad.length === 0, bad.join('; ') || `${t.turns.length} turn(s) ended with done`);
};

export const groundingPassesEveryReply: Check = (t) => {
  const bad: string[] = [];
  t.turns.forEach((turn, i) => {
    if (replyText(turn) === '') return;
    const last = eventsOfType(turn, 'grounding').at(-1);
    if (!last) bad.push(`turn ${i + 1}: reply without a grounding event`);
    else if (!last.pass) bad.push(`turn ${i + 1}: grounding failed on ${last.failures.map((f) => f.figure).join(', ')}`);
  });
  return ok('grounding passes on every reply', bad.length === 0, bad.join('; ') || 'final grounding event passed on every reply');
};

export const noFirmLimitViolation: Check = (t) => {
  const bad: string[] = [];
  t.turns.forEach((turn, i) => {
    const state = turnState(turn);
    if (!state) return;
    const { budget, commuteCap } = state.profile;
    for (const item of shortlistOf(state)) {
      if (budget?.firm && item.rentYen > budget.value) bad.push(`turn ${i + 1}: ${item.localityId} rent ${Math.round(item.rentYen)} over firm budget ${budget.value}`);
      if (commuteCap?.firm && item.commuteMinutes !== null && item.commuteMinutes > commuteCap.value) {
        bad.push(`turn ${i + 1}: ${item.localityId} commute ${Math.round(item.commuteMinutes)} over firm cap ${commuteCap.value}`);
      }
    }
    // recommend tool results carry rounded figures (rent to 1,000 yen, whole minutes): allow the rounding.
    for (const r of eventsOfType(turn, 'tool_result')) {
      if (!r.ok || r.name !== 'recommend') continue;
      const list = asRecord(r.result)?.['shortlist'];
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const item = asRecord(raw);
        const rent = item?.['rent_yen'];
        const commute = item?.['commute_minutes'];
        const id = String(item?.['area_id'] ?? '?');
        if (budget?.firm && typeof rent === 'number' && rent > budget.value + 500) bad.push(`turn ${i + 1}: recommend result ${id} rent ${rent} over firm budget ${budget.value}`);
        if (commuteCap?.firm && typeof commute === 'number' && commute > commuteCap.value + 0.5) bad.push(`turn ${i + 1}: recommend result ${id} commute ${commute} over firm cap ${commuteCap.value}`);
      }
    }
  });
  return ok('no area breaking a firm limit is recommended', bad.length === 0, bad.join('; ') || 'every shortlisted area is inside the firm limits');
};

export const everyToolCallValidated: Check = (t) => {
  const bad: string[] = [];
  t.turns.forEach((turn, i) => {
    const results = new Map(eventsOfType(turn, 'tool_result').map((r) => [r.id, r]));
    for (const call of eventsOfType(turn, 'tool_call')) {
      const r = results.get(call.id);
      if (!r) {
        bad.push(`turn ${i + 1}: ${call.name} (${call.id}) has no result`);
        continue;
      }
      if (!r.ok) {
        const code = asRecord(r.result)?.['code'];
        if (typeof code === 'string' && MODEL_FAULT_CODES.has(code)) bad.push(`turn ${i + 1}: ${call.name} rejected with ${code}`);
      }
    }
  });
  return ok('every tool call validates', bad.length === 0, bad.join('; ') || 'no tool call was rejected as invalid');
};

export const toolBudgetRespected: Check = (t) => {
  const bad: string[] = [];
  const notes: string[] = [];
  t.turns.forEach((turn, i) => {
    const calls = eventsOfType(turn, 'tool_call').filter((c) => !isHarnessCall(c.id));
    const refused = eventsOfType(turn, 'tool_result').filter((r) => !isHarnessCall(r.id) && !r.ok && asRecord(r.result)?.['code'] === 'budget_exceeded').length;
    const executed = calls.length - refused;
    if (executed > TOOL_BUDGET_PER_TURN) bad.push(`turn ${i + 1}: ${executed} tool calls executed`);
    if (refused > 0) notes.push(`turn ${i + 1}: ${refused} call(s) refused by the harness`);
  });
  return ok('tool budget respected (6 per turn)', bad.length === 0, bad.join('; ') || `within budget${notes.length ? ` (${notes.join('; ')})` : ''}`);
};

export const GENERIC_CHECKS: readonly Check[] = [streamCompleted, groundingPassesEveryReply, noFirmLimitViolation, everyToolCallValidated, toolBudgetRespected];

// ---------- Per-persona check helpers ----------

/** Number of agent replies that ask something (a question mark in the reply). */
export const questionsAsked = (t: Transcript): number => t.turns.filter((turn) => /[?？]/.test(replyText(turn))).length;

export const answerEvidenceCount = (t: Transcript): number => (finalState(t)?.evidence ?? []).filter((e) => ANSWER_EVIDENCE.has(e.type)).length;

export const atMostQuestions =
  (max: number): Check =>
  (t) => {
    const asked = questionsAsked(t);
    const answered = answerEvidenceCount(t);
    return ok(`at most ${max} questions`, asked <= max && answered <= max, `${asked} reply(ies) with a question, ${answered} answer item(s) logged`);
  };

export const noShortlistedOver =
  (maxRentYen: number): Check =>
  (t) => {
    const bad: string[] = [];
    t.turns.forEach((turn, i) => {
      for (const item of shortlistOf(turnState(turn))) if (item.rentYen > maxRentYen) bad.push(`turn ${i + 1}: ${item.localityId} rent ${Math.round(item.rentYen)}`);
    });
    return ok(`no shortlisted area over ${maxRentYen.toLocaleString('en-US')} yen`, bad.length === 0, bad.join('; ') || 'every shortlisted rent is at or under the budget');
  };

const profileOf = (t: Transcript): Profile | null => finalState(t)?.profile ?? null;

export const budgetSetFirm =
  (maxYen: number): Check =>
  (t) => {
    const b = profileOf(t)?.budget;
    return ok('budget stored as a firm limit', !!b && b.firm && b.value <= maxYen, b ? `budget ${b.value} firm=${b.firm}` : 'no budget in the profile');
  };

export const evidenceMentions =
  (features: readonly string[]): Check =>
  (t) => {
    const logged = finalState(t)?.evidence ?? [];
    const seen = new Set<string>();
    for (const e of logged) {
      if ('feature' in e) seen.add(e.feature);
      if (e.type === 'compare_importance') {
        seen.add(e.more);
        seen.add(e.less);
      }
    }
    const mult = profileOf(t)?.enoughMultipliers ?? {};
    for (const k of Object.keys(mult)) seen.add(k);
    const missing = features.filter((f) => !seen.has(f));
    return ok(`evidence covers ${features.join(' and ')}`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all present', 'expected');
  };

export const bothAnchorsInProfile: Check = (t) => {
  const anchors = profileOf(t)?.anchors ?? [];
  const periods = new Set(anchors.map((a) => a.period));
  const pass = anchors.length >= 2 && periods.has('peak') && periods.has('offpeak');
  return ok('both anchors in the profile (one peak, one off-peak)', pass, `${anchors.length} anchor(s); periods: ${[...periods].join(', ') || 'none'}`);
};

export const lateNightFlagShown: Check = (t) => {
  const state = finalState(t);
  const flagged = (state?.profile.anchors ?? []).some((a) => a.lateReturn === true);
  const onCards = shortlistOf(state).some((s) => s.confidence.lateReturnNotCovered);
  const said = t.turns.some((turn) => /last train|late[- ]night|late return|終電/i.test(replyText(turn)));
  return ok('late-night flag shown', flagged && onCards && said, `anchor flagged: ${flagged}; flag on shortlist cards: ${onCards}; mentioned in a reply: ${said}`);
};

export const distinctAnchorsReachable: Check = (t) => {
  const state = finalState(t);
  const anchors = state?.profile.anchors ?? [];
  const keys = new Set(anchors.map((a) => a.stationId ?? JSON.stringify(a.point ?? a.id)));
  const list = shortlistOf(state);
  const reachable = list.length > 0 && list.every((s) => Number.isFinite(s.monthlyTravelHours) && s.monthlyTravelHours > 0 && s.commuteMinutes !== null);
  const refused = toolResults(t, 'set_profile').flatMap((r) => {
    const x = asRecord(r)?.['refused_anchors'];
    return Array.isArray(x) ? x : [];
  });
  return ok(
    'shortlist areas are reachable from both anchors',
    anchors.length >= 2 && keys.size >= 2 && refused.length === 0 && reachable,
    `${anchors.length} anchor(s), ${keys.size} distinct, ${refused.length} refused, ${list.length} shortlisted, all with finite travel to every anchor: ${reachable}`,
  );
};

const SHIMOKITAZAWA_NAME = /下北沢|北沢|代沢|shimokita|kitazawa|daizawa/i;

/** Area ids that lookup/tool results returned for a name matching the pattern. */
export function areaIdsNamed(t: Transcript, pattern: RegExp): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk);
    const rec = asRecord(node);
    if (!rec) return;
    const id = rec['area_id'];
    if (typeof id === 'string' && pattern.test(JSON.stringify(rec['names'] ?? ''))) ids.add(id);
    Object.values(rec).forEach(walk);
  };
  toolResults(t).forEach(walk);
  return [...ids];
}

export const likedAreaId = (t: Transcript, pattern: RegExp = SHIMOKITAZAWA_NAME): string | null => {
  const named = new Set(areaIdsNamed(t, pattern));
  const logged = (finalState(t)?.evidence ?? []).filter((e) => e.type === 'like_area');
  for (const e of logged) if (e.type === 'like_area' && (named.size === 0 || named.has(e.area))) return e.area;
  return null;
};
export const topPickId = (t: Transcript): string | null => shortlistOf(finalState(t))[0]?.localityId ?? null;

export const likeAreaItemExists: Check = (t) => {
  const id = likedAreaId(t);
  return ok('a like_area item exists for the named area', id !== null, id ? `like_area ${id}` : 'no like_area evidence for an area matching the name');
};

/** The runner stores probes.compareTopVsLiked = { a, b, diffRent } from POST /compare (a = top pick, b = liked area). */
export const topPickCheaperThanLiked: Check = (t) => {
  const p = asRecord(t.probes['compareTopVsLiked']);
  const diffRent = p?.['diffRent'];
  if (typeof diffRent !== 'number') return ok("top pick's rent is below the liked area's", false, 'no compare probe data (needs a running API; afterRun not executed or failed)');
  // Comparison.diff.rent is (a minus b) of the rent TERM, which is negative rent: positive means a is cheaper.
  return ok("top pick's rent is below the liked area's", diffRent > 0, `rent term difference (top minus liked) ${Math.round(diffRent)} yen per month; positive = top pick cheaper`);
};

export const surprisingItemFlagged: Check = (t) => {
  let flagged = 0;
  for (const r of toolResults(t, 'observe')) {
    const items = asRecord(r)?.['items'];
    if (Array.isArray(items)) flagged += items.filter((i) => asRecord(i)?.['surprising'] === true).length;
  }
  return ok('a surprising item is flagged', flagged > 0, `${flagged} observed item(s) flagged surprising`);
};

const RAISES_CONFLICT = /quiet|noise|noisy|calm|earlier|said|told|mentioned|contradict|conflict|surpris|different from|unexpected|静か|騒/i;
/** Heuristic: in the first turn that flagged a surprising item, or the next one, the reply speaks about the conflict. */
export const agentRaisesIt: Check = (t) => {
  const flaggedTurn = t.turns.findIndex((turn) =>
    eventsOfType(turn, 'tool_result').some((r) => r.name === 'observe' && r.ok && (asRecord(r.result)?.['items'] as unknown[] | undefined)?.some((i) => asRecord(i)?.['surprising'] === true)),
  );
  if (flaggedTurn < 0) return ok('the agent raises the surprise', false, 'no surprising item to raise', 'expected');
  const text = [t.turns[flaggedTurn], t.turns[flaggedTurn + 1]].map((x) => (x ? replyText(x) : '')).join(' ');
  const pass = RAISES_CONFLICT.test(text) && /[?？]/.test(text);
  return ok('the agent raises the surprise', pass, pass ? 'reply mentions the earlier statement and asks about it (keyword heuristic)' : 'no conflict language plus a question in the reply (keyword heuristic)', 'expected');
};

export const anchorRefusedWithReason: Check = (t) => {
  const refused = toolResults(t, 'set_profile').flatMap((r) => {
    const x = asRecord(r)?.['refused_anchors'];
    return Array.isArray(x) ? x : [];
  });
  const reasoned = refused.filter((r) => typeof asRecord(r)?.['reason'] === 'string' && String(asRecord(r)?.['message'] ?? '') !== '');
  const lookupEmpty = toolResults(t, 'lookup').some((r) => {
    const m = asRecord(r)?.['matches'];
    return Array.isArray(m) && m.length === 0;
  });
  const anchors = profileOf(t)?.anchors ?? [];
  const pass = anchors.length === 0 && (reasoned.length > 0 || lookupEmpty);
  return ok('the anchor is refused with a reason', pass, `${reasoned.length} refusal(s) with reason; empty lookup: ${lookupEmpty}; anchors left in profile: ${anchors.length}`);
};

const COMMUTE_FIGURE = /\d+(?:\.\d+)?\s*(?:minutes?|mins?|min\b|分|hours?|hrs?|時間)/i;
export const noCommuteInvented: Check = (t) => {
  const state = finalState(t);
  const cardMinutes = shortlistOf(state).filter((s) => s.commuteMinutes !== null).length;
  const figures = t.turns.flatMap((turn, i) => (COMMUTE_FIGURE.test(replyText(turn)) ? [`turn ${i + 1}: "${replyText(turn).match(COMMUTE_FIGURE)![0]}"`] : []));
  return ok('no commute figure is invented', cardMinutes === 0 && figures.length === 0, `${cardMinutes} shortlist card(s) with a commute; commute-like figures in replies: ${figures.join('; ') || 'none'}`);
};

export const emptyShortlistWithRelax: Check = (t) => {
  const rec = finalState(t)?.recommendation ?? null;
  const empty = !!rec && rec.shortlist.length === 0;
  const relax = rec?.relax ?? [];
  return ok('empty shortlist with relax options', empty && relax.length > 0, rec ? `${rec.shortlist.length} shortlisted, ${relax.length} relax option(s)` : 'no recommendation in the final state');
};

export const neverNothingFoundAlone: Check = (t) => {
  const text = replyText(t.turns.at(-1) ?? { message: '', httpStatus: 0, events: [], invalidFrames: [] }).trim();
  const bare = text.length < 40 || /^(sorry,? )?(nothing|no (areas?|results?|matches?)) (was |were )?found\.?$/i.test(text);
  const offersRelax = /budget|commute|minutes|raise|relax|loosen|予算|通勤/i.test(text);
  return ok('never "nothing found" alone', !bare && offersRelax, `last reply ${text.length} chars; mentions a way to relax: ${offersRelax}`);
};

// ---------- Personas ----------

export type PersonaMessage = string | ((prior: Transcript) => string);
export interface AfterRunContext {
  baseUrl: string;
  transcript: Transcript;
  fetchImpl: typeof fetch;
}
export interface Persona {
  id: string;
  title: string;
  messages: readonly PersonaMessage[];
  checks: readonly Check[];
  afterRun?: (ctx: AfterRunContext) => Promise<Record<string, unknown>>;
}

const cardName = (s: ShortlistItem): string => s.nameEn ?? s.nameJa;

/** Liveliness of a card: the more it costs in calm and the more road/rail exposure it carries, the livelier. Lowest sum of those two terms. */
export function liveliestCard(items: readonly ShortlistItem[]): ShortlistItem | null {
  let best: ShortlistItem | null = null;
  let bestScore = Infinity;
  for (const s of items) {
    const score = s.breakdown.features.residential_calm + s.breakdown.features.road_rail_exposure;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
const livelyMessage =
  (lead: string) =>
  (prior: Transcript): string => {
    const card = liveliestCard(shortlistOf(finalState(prior)));
    return card ? `${lead} ${cardName(card)} looks best to me.` : `${lead} the liveliest one looks best to me.`;
  };
const firstCardMessage = (prior: Transcript): string => {
  const card = shortlistOf(finalState(prior))[0];
  return card ? `The first one, ${cardName(card)}, looks good.` : 'The first one looks good.';
};

export const PERSONAS: readonly Persona[] = [
  {
    id: 'student',
    title: 'Student, one campus',
    messages: [
      "I'm a student at Waseda, next to Takadanobaba station, there five days a week. I need a 1K for 70,000 yen a month at most, that is a hard limit. I like having a konbini nearby and food that's open late at night.",
      'I would take anything sensible. Which one is the best?',
    ],
    checks: [noShortlistedOver(70_000), atMostQuestions(6), budgetSetFirm(70_000), evidenceMentions(['konbini', 'late_night'])],
  },
  {
    id: 'school_late_shift',
    title: 'School plus late shift',
    messages: [
      "I study at Komaba (Komaba-Todaimae station) three mornings a week, and I work a night shift at a bar in Shibuya four nights a week. The shift ends after the last train, so I come home late. 1K, around 90,000 yen a month.",
      'Yes, the shift ends after midnight. Please show me what you have.',
    ],
    checks: [bothAnchorsInProfile, lateNightFlagShown],
  },
  {
    id: 'two_commutes',
    title: 'Two commutes',
    messages: [
      "My partner and I both commute five days a week. I work in Ikebukuro, they work in Shinagawa. We want a 2LDK, up to 220,000 yen a month, and neither of us wants more than 50 minutes each way.",
    ],
    checks: [distinctAnchorsReachable],
  },
  {
    id: 'like_shimokitazawa',
    title: '"Like Shimokitazawa but cheaper"',
    messages: [
      'I like Shimokitazawa but I need something cheaper. I work in Shinjuku five days a week and want a 1K.',
      firstCardMessage,
    ],
    checks: [likeAreaItemExists, topPickCheaperThanLiked],
    async afterRun({ baseUrl, transcript, fetchImpl }) {
      const a = topPickId(transcript);
      const b = likedAreaId(transcript);
      if (!a || !b || !transcript.sessionId) return {};
      const res = await fetchImpl(`${baseUrl}/v1/agent/session/${encodeURIComponent(transcript.sessionId)}/compare`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a, b }),
      });
      if (!res.ok) return {};
      const diff = asRecord(asRecord(asRecord(await res.json())?.['result'])?.['diff']);
      const diffRent = diff?.['rent'];
      return typeof diffRent === 'number' ? { compareTopVsLiked: { a, b, diffRent } } : {};
    },
  },
  {
    id: 'contradictor',
    title: 'The contradictor',
    messages: [
      'I work in Shinjuku five days a week and want a 1K around 100,000 yen. Quiet is essential for me, I cannot stand noise.',
      livelyMessage('Honestly, the lively one,'),
      livelyMessage('Yes, again the lively one,'),
    ],
    checks: [surprisingItemFlagged, agentRaisesIt],
  },
  {
    id: 'out_of_coverage',
    title: 'Out of coverage',
    messages: ['I work in Yokohama, in the city center, five days a week. I want a 1K for about 90,000 yen.'],
    checks: [anchorRefusedWithReason, noCommuteInvented],
  },
  {
    id: 'impossible_limits',
    title: 'Impossible limits',
    messages: [
      'I work in Shinjuku five days a week. I need a 1LDK for 50,000 yen a month or less and no more than 15 minutes each way. Those are hard limits.',
    ],
    checks: [emptyShortlistWithRelax, neverNothingFoundAlone],
  },
];

export function runChecks(t: Transcript, persona: Persona): CheckResult[] {
  return [...GENERIC_CHECKS.map((c) => c(t)), ...persona.checks.map((c) => c(t))];
}
export const personaPasses = (results: readonly CheckResult[]): boolean => results.every((r) => r.pass || r.severity === 'expected');

// ---------- Runner ----------

/** Parses a text/event-stream body into AgentStreamEvents; frames that do not validate go to `invalid`. */
export function parseSse(body: string): { events: AgentStreamEvent[]; invalid: string[] } {
  const events: AgentStreamEvent[] = [];
  const invalid: string[] = [];
  for (const frame of body.replace(/\r\n/g, '\n').split('\n\n')) {
    const trimmed = frame.trim();
    if (trimmed === '') continue;
    const data = trimmed
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    try {
      const parsed = AgentStreamEventSchema.safeParse(JSON.parse(data));
      if (parsed.success) events.push(parsed.data as AgentStreamEvent);
      else invalid.push(trimmed.slice(0, 200));
    } catch {
      invalid.push(trimmed.slice(0, 200));
    }
  }
  return { events, invalid };
}

export async function runPersona(persona: Persona, baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<Transcript> {
  const transcript: Transcript = { persona: persona.id, sessionId: null, turns: [], probes: {} };
  const created = await fetchImpl(`${baseUrl}/v1/agent/session`, { method: 'POST' });
  if (!created.ok) throw new Error(`POST /v1/agent/session answered ${created.status}`);
  const sessionId = (asRecord(await created.json())?.['sessionId'] as string | undefined) ?? null;
  if (!sessionId) throw new Error('POST /v1/agent/session returned no sessionId');
  transcript.sessionId = sessionId;

  for (const m of persona.messages) {
    const message = typeof m === 'string' ? m : m(transcript);
    const res = await fetchImpl(`${baseUrl}/v1/agent/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
    });
    const text = await res.text();
    const parsed = res.ok ? parseSse(text) : { events: [], invalid: [text.slice(0, 200)] };
    transcript.turns.push({ message, httpStatus: res.status, events: parsed.events, invalidFrames: parsed.invalid });
    if (!res.ok) break;
  }
  if (persona.afterRun) {
    try {
      transcript.probes = await persona.afterRun({ baseUrl, transcript, fetchImpl });
    } catch {
      transcript.probes = {};
    }
  }
  return transcript;
}

export function formatReport(persona: Persona, results: readonly CheckResult[]): string {
  const lines = [`${personaPasses(results) ? 'PASS' : 'FAIL'}  ${persona.title} (${persona.id})`];
  for (const r of results) lines.push(`  [${r.pass ? 'ok' : r.severity === 'must' ? 'FAIL' : 'warn'}] ${r.name}: ${r.detail}`);
  return lines.join('\n');
}

// ---------- CLI ----------

function arg(name: string, argv: readonly string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: readonly string[]): Promise<void> {
  const baseUrl = (arg('--base-url', argv) ?? process.env['AGENT_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const only = arg('--persona', argv);
  const out = resolve(arg('--out', argv) ?? resolve(dirname(fileURLToPath(import.meta.url)), 'out/personas.json'));
  const personas = PERSONAS.filter((p) => only === undefined || p.id === only);
  if (personas.length === 0) throw new Error(`No persona "${only}". Known: ${PERSONAS.map((p) => p.id).join(', ')}`);

  const report: { persona: string; pass: boolean; checks: CheckResult[]; transcript: Transcript }[] = [];
  for (const persona of personas) {
    const transcript = await runPersona(persona, baseUrl);
    const results = runChecks(transcript, persona);
    console.log(formatReport(persona, results));
    report.push({ persona: persona.id, pass: personaPasses(results), checks: results, transcript });
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${out}`);
  if (report.some((r) => !r.pass)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
