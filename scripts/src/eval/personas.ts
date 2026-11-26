// Scripted personas: does the whole agent behave? (docs/plans/agent-harness-plan.md,
// "Evaluation", "Scripted personas".)
//
// Twelve personas as data (user messages plus checks), checks that apply to every
// transcript, and a runner that replays each persona --repeat times against a RUNNING API:
//   POST /v1/agent/session            -> { sessionId }
//   POST /v1/agent/turn {sessionId, message}   -> text/event-stream of AgentStreamEvent frames
// It needs a live model behind the API, so it is not run in CI or by the unit tests.
// The check functions are pure and are unit-tested on hand-built (synthetic) transcripts.
//
// Usage:
//   pnpm eval:personas [--repeat 5] [--base-url http://localhost:4000] [--persona id] [--out path] [--allow-prod]
//   Base URL: --base-url, else AGENT_BASE_URL, else http://localhost:4000 (the API's PORT default).
//   Production needs --allow-prod; local and staging do not (see personas/run-info.ts).
//   DATABASE_URL (the database behind the API under test) lets the run read the server's turn records
//   for the markup-leak check; without it that check is n/a. AGENT_MODEL names the model in the run summary.
//   Output: a timestamped file in scripts/src/eval/out/ and one summary line appended to history.jsonl.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentStreamEventSchema } from '@tokyo/shared';
import type { AgentStateView, AgentStreamEvent, Profile, ShortlistItem } from '@tokyo/shared';
import type { Pool } from 'pg';

import { createPool } from '../lib/db.js';
import { assertMayTarget, collectRunInfo, type RunInfo } from './personas/run-info.js';
import { wilsonInterval, type Interval } from './personas/stats.js';
import { fetchTurnRecords, type TurnRecordPayload } from './personas/turn-records.js';

export const DEFAULT_BASE_URL = 'http://localhost:4000';
/** Harness limit from api/src/agent/loop.ts (MAX_TOOL_CALLS_PER_TURN). */
export const TOOL_BUDGET_PER_TURN = 6;
/** Turns the agent keeps verbatim (api/src/agent/loop.ts CONTEXT_TURNS); a longer persona must still hold its turn-1 limits. */
export const CONTEXT_TURNS = 8;
export const DEFAULT_REPEAT = 5;

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
export type CheckStatus = 'pass' | 'fail' | 'n/a';
export interface CheckResult {
  name: string;
  /** 'n/a' = the check had nothing to judge (its precondition did not occur, or its data source is absent). */
  status: CheckStatus;
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
const ok = (name: string, pass: boolean, detail: string, severity: CheckResult['severity'] = 'must'): CheckResult => ({
  name,
  status: pass ? 'pass' : 'fail',
  severity,
  detail,
});
const notApplicable = (name: string, detail: string, severity: CheckResult['severity'] = 'must'): CheckResult => ({ name, status: 'n/a', severity, detail });

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

/** The firm limits in force at some moment: monthly rent, and one-way minutes to the main anchor. */
interface FirmLimits {
  budgetYen: number | null;
  mainCommuteMinutes: number | null;
}
const NO_LIMITS: FirmLimits = { budgetYen: null, mainCommuteMinutes: null };

const firmValue = (limit: { value: number; firm: boolean } | undefined): number | null => (limit?.firm ? limit.value : null);
/** The main anchor's own cap wins over the older profile-level commuteCap (shared/src/engine/types.ts). */
export const mainAnchorCap = (p: Profile): Profile['commuteCap'] => p.anchors[0]?.cap ?? p.commuteCap;
const firmLimitsOf = (p: Profile): FirmLimits => ({ budgetYen: firmValue(p.budget), mainCommuteMinutes: firmValue(mainAnchorCap(p)) });

/** Reads the profile as set_profile reports it (api/src/agent/tools.ts formatProfile). */
function firmLimitsOfSetProfile(result: unknown): FirmLimits {
  const profile = asRecord(asRecord(result)?.['profile']);
  const firm = (raw: unknown, key: string): number | null => {
    const limit = asRecord(raw);
    const value = limit?.[key];
    return limit?.['firm'] === true && typeof value === 'number' ? value : null;
  };
  const anchors = profile?.['anchors'];
  const cap = (Array.isArray(anchors) ? asRecord(asRecord(anchors[0])?.['cap']) : null) ?? asRecord(profile?.['commute_cap']);
  return { budgetYen: firm(profile?.['budget'], 'yen'), mainCommuteMinutes: firm(cap, 'minutes') };
}

function limitBreaches(limits: FirmLimits, item: { id: string; rentYen: number | null; commuteMinutes: number | null }, slack: { yen: number; minutes: number }): string[] {
  const out: string[] = [];
  if (limits.budgetYen !== null && item.rentYen !== null && item.rentYen > limits.budgetYen + slack.yen) out.push(`${item.id} rent ${Math.round(item.rentYen)} over firm budget ${limits.budgetYen}`);
  if (limits.mainCommuteMinutes !== null && item.commuteMinutes !== null && item.commuteMinutes > limits.mainCommuteMinutes + slack.minutes) {
    out.push(`${item.id} commute ${Math.round(item.commuteMinutes)} over firm cap ${limits.mainCommuteMinutes}`);
  }
  return out;
}

const numberOrNull = (x: unknown): number | null => (typeof x === 'number' ? x : null);

/**
 * State cards are judged against the profile in the same state. A recommend result is judged against the profile as the
 * latest set_profile left it, replayed in event order, so a limit that was loosened or dropped mid-turn is not held against it.
 * Cards and results carry only the commute to the main anchor, so the cap of a second anchor cannot be seen here.
 */
export const noFirmLimitViolation: Check = (t) => {
  const bad: string[] = [];
  let limits = NO_LIMITS;
  t.turns.forEach((turn, i) => {
    const where = `turn ${i + 1}`;
    for (const e of turn.events) {
      if (e.type === 'tool_result' && e.ok && e.name === 'set_profile') limits = firmLimitsOfSetProfile(e.result);
      if (e.type === 'state') {
        const stateLimits = firmLimitsOf(e.state.profile);
        for (const item of shortlistOf(e.state)) bad.push(...limitBreaches(stateLimits, { id: item.localityId, rentYen: item.rentYen, commuteMinutes: item.commuteMinutes }, { yen: 0, minutes: 0 }).map((m) => `${where}: ${m}`));
      }
      if (e.type === 'tool_result' && e.ok && e.name === 'recommend') {
        const list = asRecord(e.result)?.['shortlist'];
        // recommend tool results carry rounded figures (rent to 1,000 yen, whole minutes): allow the rounding.
        for (const raw of Array.isArray(list) ? list : []) {
          const item = asRecord(raw);
          const found = { id: `recommend result ${String(item?.['area_id'] ?? '?')}`, rentYen: numberOrNull(item?.['rent_yen']), commuteMinutes: numberOrNull(item?.['commute_minutes']) };
          bad.push(...limitBreaches(limits, found, { yen: 500, minutes: 0.5 }).map((m) => `${where}: ${m}`));
        }
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

/** Needs probes.turnRecords from the runner (the session's agent_events turn rows); n/a without a database to read. */
export const noMarkupLeaks: Check = (t) => {
  const name = 'no tool-call markup leaked (server turn records)';
  const error = t.probes['turnRecordsError'];
  if (typeof error === 'string') return ok(name, false, `turn records could not be read: ${error}`);
  const records = t.probes['turnRecords'] as TurnRecordPayload[] | undefined;
  if (records === undefined) return notApplicable(name, 'DATABASE_URL not set, so the server turn records were not read');
  const answered = t.turns.filter((turn) => turn.httpStatus === 200).length;
  const leaked = records.filter((r) => r.markupLeaked || r.finalGrounding?.markup).length;
  const firstFailed = records.filter((r) => r.firstGrounding && !r.firstGrounding.pass).length;
  const finalFailed = records.filter((r) => r.finalGrounding && !r.finalGrounding.pass).length;
  const fallbacks = records.filter((r) => r.fallbackUsed).length;
  const detail = `${records.length} record(s) for ${answered} answered turn(s); leaks ${leaked}; first-pass grounding failed ${firstFailed}, final ${finalFailed}; fallback replies ${fallbacks}`;
  return ok(name, leaked === 0 && records.length >= answered, detail);
};

export const GENERIC_CHECKS: readonly Check[] = [streamCompleted, groundingPassesEveryReply, noFirmLimitViolation, everyToolCallValidated, toolBudgetRespected, noMarkupLeaks];

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

export const commuteCapSetFirm =
  (maxMinutes: number): Check =>
  (t) => {
    const profile = profileOf(t);
    const cap = profile ? mainAnchorCap(profile) : undefined;
    return ok('commute cap stored as a firm limit', !!cap && cap.firm && cap.value <= maxMinutes, cap ? `cap ${cap.value} min firm=${cap.firm}` : 'no commute cap in the profile');
  };

export const anchorInProfile: Check = (t) => {
  const anchors = profileOf(t)?.anchors ?? [];
  return ok('the workplace is an anchor in the profile', anchors.length > 0, `${anchors.length} anchor(s)`);
};

/** A reply to a Japanese message should be Japanese; kana is what distinguishes a Japanese sentence from one that only names places in kanji. */
export const repliesInJapanese: Check = (t) => {
  const replies = t.turns.map((turn, i) => ({ i, text: replyText(turn) })).filter((r) => r.text !== '');
  const english = replies.filter((r) => !/[\u3040-\u30ff]/.test(r.text)).map((r) => r.i + 1);
  return ok('every reply is in Japanese', replies.length > 0 && english.length === 0, english.length ? `no kana in the reply of turn(s) ${english.join(', ')}` : `${replies.length} reply(ies) in Japanese`, 'expected');
};

/** After a long conversation the shortlist is still being served, not lost with the turns that fell out of context. */
export const shortlistInFinalTurn: Check = (t) => {
  const last = t.turns.at(-1);
  const count = last ? shortlistOf(turnState(last)).length : 0;
  return ok('the last turn still shows a shortlist', count > 0, `${count} shortlisted in the last turn`);
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

/** The like_area item for an area that a lookup actually returned under that name; null when the lookup found nothing. */
export const likedAreaId = (t: Transcript, pattern: RegExp = SHIMOKITAZAWA_NAME): string | null => {
  const named = new Set(areaIdsNamed(t, pattern));
  for (const e of finalState(t)?.evidence ?? []) if (e.type === 'like_area' && named.has(e.area)) return e.area;
  return null;
};
export const topPickId = (t: Transcript): string | null => shortlistOf(finalState(t))[0]?.localityId ?? null;

export const likeAreaItemExists: Check = (t) => {
  const name = 'a like_area item exists for the named area';
  if (areaIdsNamed(t, SHIMOKITAZAWA_NAME).length === 0) return ok(name, false, 'no lookup returned an area matching the name');
  const id = likedAreaId(t);
  return ok(name, id !== null, id ? `like_area ${id}` : 'no like_area evidence for the area the lookup found');
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
  const name = 'the anchor is refused with a reason';
  const setProfileRan = t.turns.some((turn) => eventsOfType(turn, 'tool_call').some((c) => c.name === 'set_profile'));
  if (!setProfileRan) return notApplicable(name, 'set_profile never ran, so no anchor was offered for refusal');
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
  return ok(name, pass, `${reasoned.length} refusal(s) with reason; empty lookup: ${lookupEmpty}; anchors left in profile: ${anchors.length}`);
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

const firstCardMessageJa = (prior: Transcript): string => {
  const card = shortlistOf(finalState(prior))[0];
  return card ? `最初の${card.nameJa}がよさそうです。` : '最初のものがよさそうです。';
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
  {
    id: 'ja_student',
    title: 'Japanese: student, one campus',
    messages: [
      '早稲田大学に通う学生です。高田馬場駅の近くで、週5日通学します。1Kで家賃は7万円以下、これは絶対に超えられません。',
      '静かで住みやすいところがいいです。おすすめはどこですか？',
    ],
    checks: [noShortlistedOver(70_000), budgetSetFirm(70_000), anchorInProfile, repliesInJapanese],
  },
  {
    id: 'ja_commuter',
    title: 'Japanese: commute limit and budget',
    messages: [
      '渋谷で働いていて、週5日出勤します。1LDKで家賃は12万円まで、通勤は片道30分以内が絶対条件です。',
      '買い物に便利で、夜遅くまで開いているお店が近くにあると嬉しいです。',
    ],
    checks: [noShortlistedOver(120_000), budgetSetFirm(120_000), commuteCapSetFirm(30), repliesInJapanese],
  },
  {
    id: 'ja_like_area',
    title: 'Japanese: "like Shimokitazawa but cheaper"',
    messages: [
      '下北沢が好きですが、もう少し安いところがいいです。新宿に週5日通っていて、1Kで家賃は10万円が上限です。',
      firstCardMessageJa,
    ],
    checks: [likeAreaItemExists, noShortlistedOver(100_000), budgetSetFirm(100_000), repliesInJapanese],
  },
  {
    id: 'mixed_language',
    title: 'Mixed Japanese and English',
    messages: [
      'I work in 新宿 five days a week and want a 1K. 家賃は8万円まで、that is a hard limit です。',
      'Which one is the quietest? 静かなところがいいです。',
    ],
    checks: [noShortlistedOver(80_000), budgetSetFirm(80_000), anchorInProfile],
  },
  {
    id: 'long_conversation',
    title: `Twelve turns, past the ${CONTEXT_TURNS}-turn context window`,
    messages: [
      'I work in Shinjuku five days a week and want a 1K. 75,000 yen a month is my hard limit; I will not go above it.',
      'I like having a supermarket close by.',
      'A bit of greenery nearby would be nice too, a park or a river.',
      'Late-night food matters less to me than quiet streets.',
      'Actually I cook a lot, so good groceries matter more than restaurants.',
      'I do not mind a slightly longer commute if the area is calmer.',
      'What does the shortlist look like now?',
      'Which of those would be the safest to walk home in?',
      'I would also like a gym within walking distance.',
      'Honestly, I am flexible on most things now.',
      'Show me the best few options again.',
      'Any of these would work. Which is the single best pick?',
    ],
    checks: [noShortlistedOver(75_000), budgetSetFirm(75_000), shortlistInFinalTurn],
  },
];

export function runChecks(t: Transcript, persona: Persona): CheckResult[] {
  return [...GENERIC_CHECKS.map((c) => c(t)), ...persona.checks.map((c) => c(t))];
}
export const personaPasses = (results: readonly CheckResult[]): boolean => results.every((r) => r.status !== 'fail' || r.severity === 'expected');

export interface ExpectedScore {
  passed: number;
  total: number;
}
/** The heuristic checks, scored apart from the pass/fail verdict; n/a checks are not counted. */
export function expectedScore(results: readonly CheckResult[]): ExpectedScore {
  const scored = results.filter((r) => r.severity === 'expected' && r.status !== 'n/a');
  return { passed: scored.filter((r) => r.status === 'pass').length, total: scored.length };
}

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

const reportTag = (r: CheckResult): string => (r.status === 'pass' ? 'ok' : r.status === 'n/a' ? 'n/a' : r.severity === 'must' ? 'FAIL' : 'warn');

export function formatReport(persona: Persona, results: readonly CheckResult[]): string {
  const lines = [`${personaPasses(results) ? 'PASS' : 'FAIL'}  ${persona.title} (${persona.id})`];
  for (const r of results) lines.push(`  [${reportTag(r)}] ${r.name}: ${r.detail}`);
  return lines.join('\n');
}

// ---------- Repeated runs ----------

export interface PersonaRun {
  persona: string;
  run: number;
  pass: boolean;
  expected: ExpectedScore;
  checks: CheckResult[];
  transcript: Transcript;
}
export interface PersonaSummary {
  persona: string;
  runs: number;
  passes: number;
  /** Wilson 95% interval on passes / runs. */
  interval: Interval;
  expectedPassed: number;
  expectedTotal: number;
}

export function summarise(persona: string, runs: readonly PersonaRun[]): PersonaSummary {
  const passes = runs.filter((r) => r.pass).length;
  return {
    persona,
    runs: runs.length,
    passes,
    interval: wilsonInterval(passes, runs.length),
    expectedPassed: runs.reduce((n, r) => n + r.expected.passed, 0),
    expectedTotal: runs.reduce((n, r) => n + r.expected.total, 0),
  };
}

const percent = (x: number): string => `${Math.round(x * 100)}%`;
export const formatSummary = (s: PersonaSummary): string =>
  `${s.persona}: ${s.passes}/${s.runs} passed (${percent(s.passes / s.runs)}), 95% interval ${percent(s.interval.low)} to ${percent(s.interval.high)}; expected checks ${s.expectedPassed}/${s.expectedTotal}`;

/** Reads the session's server-side turn records into the transcript's probes; a failed read is recorded, not thrown. */
async function attachTurnRecords(transcript: Transcript, pool: Pool | null): Promise<void> {
  if (pool === null || transcript.sessionId === null) return;
  try {
    transcript.probes['turnRecords'] = await fetchTurnRecords(pool, transcript.sessionId);
  } catch (err) {
    transcript.probes['turnRecordsError'] = err instanceof Error ? err.message : String(err);
  }
}

// ---------- CLI ----------

function arg(name: string, argv: readonly string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseRepeat(raw: string | undefined): number {
  const repeat = raw === undefined ? DEFAULT_REPEAT : Number(raw);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`--repeat must be a whole number of at least 1, got "${raw}"`);
  return repeat;
}

const evalDir = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = resolve(evalDir, 'history.jsonl');

function historyLine(info: RunInfo, startedAt: Date, repeat: number, summaries: readonly PersonaSummary[]): string {
  const personas = Object.fromEntries(
    summaries.map((s) => [s.persona, { passes: s.passes, runs: s.runs, low: s.interval.low, high: s.interval.high, expectedPassed: s.expectedPassed, expectedTotal: s.expectedTotal }]),
  );
  return JSON.stringify({ at: startedAt.toISOString(), ...info, repeat, personas });
}

export async function main(argv: readonly string[]): Promise<void> {
  const baseUrl = (arg('--base-url', argv) ?? process.env['AGENT_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  assertMayTarget(baseUrl, argv.includes('--allow-prod'));
  const repeat = parseRepeat(arg('--repeat', argv));
  const only = arg('--persona', argv);
  const startedAt = new Date();
  const out = resolve(arg('--out', argv) ?? resolve(evalDir, `out/personas-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`));
  const personas = PERSONAS.filter((p) => only === undefined || p.id === only);
  if (personas.length === 0) throw new Error(`No persona "${only}". Known: ${PERSONAS.map((p) => p.id).join(', ')}`);

  const info = await collectRunInfo(baseUrl);
  const pool = process.env['DATABASE_URL'] ? createPool() : null;
  if (pool === null) console.warn('warning: DATABASE_URL is not set, so the markup-leak check on the server turn records is n/a in every run.');

  const runs: PersonaRun[] = [];
  try {
    for (const persona of personas) {
      for (let run = 1; run <= repeat; run++) {
        const transcript = await runPersona(persona, baseUrl);
        await attachTurnRecords(transcript, pool);
        const checks = runChecks(transcript, persona);
        const pass = personaPasses(checks);
        console.log(pass ? `PASS  ${persona.id} run ${run}/${repeat}` : `run ${run}/${repeat}\n${formatReport(persona, checks)}`);
        runs.push({ persona: persona.id, run, pass, expected: expectedScore(checks), checks, transcript });
      }
    }
  } finally {
    await pool?.end();
  }

  const summaries = personas.map((p) => summarise(p.id, runs.filter((r) => r.persona === p.id)));
  console.log(`\n${summaries.map(formatSummary).join('\n')}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ startedAt: startedAt.toISOString(), info, repeat, summaries, runs }, null, 2) + '\n');
  appendFileSync(HISTORY_PATH, historyLine(info, startedAt, repeat, summaries) + '\n');
  console.log(`Wrote ${out} and appended to ${HISTORY_PATH}`);
  if (runs.some((r) => !r.pass)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
