// Unit tests for the persona check functions. Every transcript below is HAND-BUILT and SYNTHETIC:
// none of it came from a live model or a live API.
import { describe, expect, it } from 'vitest';
import type { AgentStateView, AgentStreamEvent, ShortlistItem } from '@tokyo/shared';

import {
  PERSONAS,
  agentRaisesIt,
  anchorRefusedWithReason,
  answerEvidenceCount,
  atMostQuestions,
  bothAnchorsInProfile,
  distinctAnchorsReachable,
  emptyShortlistWithRelax,
  everyToolCallValidated,
  expectedScore,
  groundingPassesEveryReply,
  lateNightFlagShown,
  likeAreaItemExists,
  liveliestCard,
  neverNothingFoundAlone,
  noCommuteInvented,
  noFirmLimitViolation,
  noMarkupLeaks,
  noShortlistedOver,
  parseSse,
  personaPasses,
  runChecks,
  streamCompleted,
  surprisingItemFlagged,
  toolBudgetRespected,
  topPickCheaperThanLiked,
  type Transcript,
  type Turn,
} from './personas.js';

const card = (id: string, over: Partial<ShortlistItem> = {}): ShortlistItem => {
  const features = Object.fromEntries(['residential_calm', 'road_rail_exposure'].map((k) => [k, 0]));
  return {
    localityId: id,
    nameEn: id,
    nameJa: id,
    wardNameEn: null,
    lat: 35.68,
    lon: 139.76,
    nearestStation: null,
    safety: null,
    rentYen: 60000,
    commuteMinutes: 20,
    monthlyTravelHours: 30,
    pBest: 0.2,
    regretYen: 0,
    role: null,
    breakdown: { features } as unknown as ShortlistItem['breakdown'],
    vsMedian: {} as ShortlistItem['vsMedian'],
    confidence: { rent: 'near_price_point', landValueNearestM: 10, access: 'high', commuteBandMinutes: 3, lateReturnNotCovered: false },
    ...over,
  };
};

const state = (over: { profile?: object; shortlist?: ShortlistItem[]; evidence?: object[]; relax?: object[] } = {}): AgentStateView =>
  ({
    profile: { anchors: [], enoughMultipliers: {}, ...(over.profile ?? {}) },
    evidence: over.evidence ?? [],
    belief: { params: [], ess: 1000, lowConfidence: false, scale: 100000 },
    recommendation: { shortlist: over.shortlist ?? [], feasibleCount: 0, riskYen: 0, shouldStop: false, stopReason: null, nextQuestion: null, excluded: {}, ess: 1000, ...(over.relax ? { relax: over.relax } : {}) },
    riskYen: 0,
    excluded: null,
  }) as unknown as AgentStateView;

const turn = (events: AgentStreamEvent[], message = 'hi'): Turn => ({ message, httpStatus: 200, events, invalidFrames: [] });
const text = (delta: string): AgentStreamEvent => ({ type: 'text', delta });
const grounding = (pass: boolean, figure = '99 minutes'): AgentStreamEvent => ({ type: 'grounding', pass, failures: pass ? [] : [{ figure, context: '' }] });
const done: AgentStreamEvent = { type: 'done' };
const call = (id: string, name: string, input: unknown = {}): AgentStreamEvent => ({ type: 'tool_call', id, name, input });
const result = (id: string, name: string, ok: boolean, res: unknown): AgentStreamEvent => ({ type: 'tool_result', id, name, ok, result: res });
const st = (s: AgentStateView): AgentStreamEvent => ({ type: 'state', state: s });
const tr = (turns: Turn[], probes: Record<string, unknown> = {}): Transcript => ({ persona: 'synthetic', sessionId: 's1', turns, probes });

describe('generic checks', () => {
  it('streamCompleted', () => {
    expect(streamCompleted(tr([turn([text('a'), done])])).status).toBe('pass');
    expect(streamCompleted(tr([turn([text('a')])])).status).toBe('fail');
    expect(streamCompleted(tr([turn([{ type: 'error', message: 'x', code: 'TURN_FAILED' }, done])])).status).toBe('fail');
    expect(streamCompleted(tr([{ ...turn([done]), httpStatus: 500 }])).status).toBe('fail');
    expect(streamCompleted(tr([{ ...turn([done]), invalidFrames: ['junk'] }])).status).toBe('fail');
  });

  it('groundingPassesEveryReply uses the last grounding event of each reply', () => {
    expect(groundingPassesEveryReply(tr([turn([text('hi'), grounding(true), done])])).status).toBe('pass');
    // a failed first check followed by a passing retry is fine
    expect(groundingPassesEveryReply(tr([turn([grounding(false), text('hi'), grounding(true), done])])).status).toBe('pass');
    expect(groundingPassesEveryReply(tr([turn([text('hi'), grounding(false), done])])).status).toBe('fail');
    expect(groundingPassesEveryReply(tr([turn([text('hi'), done])])).status).toBe('fail');
    expect(groundingPassesEveryReply(tr([turn([done])])).status).toBe('pass'); // no reply, nothing to ground
  });

  it('noFirmLimitViolation checks state cards and recommend results', () => {
    const profile = { budget: { value: 70000, firm: true }, commuteCap: { value: 30, firm: true } };
    const good = turn([st(state({ profile, shortlist: [card('a')] })), done]);
    expect(noFirmLimitViolation(tr([good])).status).toBe('pass');
    const overBudget = turn([st(state({ profile, shortlist: [card('a', { rentYen: 70001 })] })), done]);
    expect(noFirmLimitViolation(tr([overBudget])).status).toBe('fail');
    const overCap = turn([st(state({ profile, shortlist: [card('a', { commuteMinutes: 31 })] })), done]);
    expect(noFirmLimitViolation(tr([overCap])).status).toBe('fail');
    const soft = turn([st(state({ profile: { budget: { value: 70000, firm: false } }, shortlist: [card('a', { rentYen: 90000 })] })), done]);
    expect(noFirmLimitViolation(tr([soft])).status).toBe('pass');
    // recommend results are judged against the profile set_profile had left at that moment
    const profileSet = (budget: object, cap: object) =>
      result('p1', 'set_profile', true, { profile: { anchors: [{ id: 'a1', cap: null }], budget, commute_cap: cap } });
    const firm = profileSet({ yen: 70000, firm: true }, { minutes: 30, firm: true });
    const viaTool = turn([firm, result('t1', 'recommend', true, { shortlist: [{ area_id: 'b', rent_yen: 75000, commute_minutes: 10 }] }), st(state({ profile })), done]);
    expect(noFirmLimitViolation(tr([viaTool])).status).toBe('fail');
    // rounding tolerance: 70,000 budget, 70,000 rounded rent is fine
    const rounded = turn([firm, result('t1', 'recommend', true, { shortlist: [{ area_id: 'b', rent_yen: 70000, commute_minutes: 30 }] }), st(state({ profile })), done]);
    expect(noFirmLimitViolation(tr([rounded])).status).toBe('pass');
    // the limit in force is the one from the latest set_profile: loosened, the same shortlist is fine; before any, nothing is firm
    const shortlist75k = result('t2', 'recommend', true, { shortlist: [{ area_id: 'b', rent_yen: 75000, commute_minutes: 10 }] });
    const loosened = turn([firm, profileSet({ yen: 80000, firm: true }, { minutes: 30, firm: true }), shortlist75k, done]);
    expect(noFirmLimitViolation(tr([loosened])).status).toBe('pass');
    expect(noFirmLimitViolation(tr([turn([shortlist75k, done])])).status).toBe('pass');
    // the main anchor's own cap beats the profile-level cap
    const anchorCap = result('p2', 'set_profile', true, { profile: { anchors: [{ id: 'a1', cap: { minutes: 15, firm: true } }], commute_cap: { minutes: 30, firm: true } } });
    const slow = result('t3', 'recommend', true, { shortlist: [{ area_id: 'c', rent_yen: 50000, commute_minutes: 20 }] });
    expect(noFirmLimitViolation(tr([turn([anchorCap, slow, done])])).status).toBe('fail');
  });

  it('everyToolCallValidated flags missing results and model-fault errors only', () => {
    expect(everyToolCallValidated(tr([turn([call('1', 'lookup'), result('1', 'lookup', true, {}), done])])).status).toBe('pass');
    expect(everyToolCallValidated(tr([turn([call('1', 'lookup'), done])])).status).toBe('fail');
    expect(everyToolCallValidated(tr([turn([call('1', 'observe'), result('1', 'observe', false, { code: 'invalid_input' }), done])])).status).toBe('fail');
    expect(everyToolCallValidated(tr([turn([call('1', 'lookup'), result('1', 'lookup', false, { code: 'lookup_failed' }), done])])).status).toBe('pass');
  });

  it('toolBudgetRespected counts executed model calls, ignoring harness calls and refused ones', () => {
    const calls = (n: number, prefix = 'c'): AgentStreamEvent[] =>
      Array.from({ length: n }, (_, i) => [call(`${prefix}${i}`, 'lookup'), result(`${prefix}${i}`, 'lookup', true, {})]).flat();
    expect(toolBudgetRespected(tr([turn([...calls(6), done])])).status).toBe('pass');
    expect(toolBudgetRespected(tr([turn([...calls(7), done])])).status).toBe('fail');
    expect(toolBudgetRespected(tr([turn([...calls(6), ...calls(2, 'harness_recommend_'), done])])).status).toBe('pass');
    const refused: AgentStreamEvent[] = [call('x', 'lookup'), result('x', 'lookup', false, { code: 'budget_exceeded' })];
    expect(toolBudgetRespected(tr([turn([...calls(6), ...refused, done])])).status).toBe('pass');
  });
});

describe('persona checks', () => {
  it('student: budget cap and question count', () => {
    const ok = tr([turn([text('Which?'), st(state({ shortlist: [card('a', { rentYen: 65000 })] })), done])]);
    expect(noShortlistedOver(70000)(ok).status).toBe('pass');
    const over = tr([turn([st(state({ shortlist: [card('a', { rentYen: 72000 })] })), done])]);
    expect(noShortlistedOver(70000)(over).status).toBe('fail');
    const many = tr(Array.from({ length: 7 }, () => turn([text('Which one?'), done])));
    expect(atMostQuestions(6)(many).status).toBe('fail');
    expect(atMostQuestions(6)(ok).status).toBe('pass');
    const evidence = Array.from({ length: 7 }, () => ({ type: 'pick_from_set', id: 'e', chosen: 'a', set: ['a', 'b'] }));
    expect(answerEvidenceCount(tr([turn([st(state({ evidence })), done])]))).toBe(7);
  });

  it('school plus late shift', () => {
    const anchors = [
      { id: 'a1', label: 'campus', tripsPerWeek: 3, period: 'peak' },
      { id: 'a2', label: 'bar', tripsPerWeek: 4, period: 'offpeak', lateReturn: true },
    ];
    const good = tr([turn([text('Note: last trains are not in the data.'), st(state({ profile: { anchors }, shortlist: [card('a', { confidence: { ...card('a').confidence, lateReturnNotCovered: true } })] })), done])]);
    expect(bothAnchorsInProfile(good).status).toBe('pass');
    expect(lateNightFlagShown(good).status).toBe('pass');
    const one = tr([turn([st(state({ profile: { anchors: [anchors[0]] } })), done])]);
    expect(bothAnchorsInProfile(one).status).toBe('fail');
    const unflagged = tr([turn([text('Here you go.'), st(state({ profile: { anchors }, shortlist: [card('a')] })), done])]);
    expect(lateNightFlagShown(unflagged).status).toBe('fail');
  });

  it('two commutes', () => {
    const anchors = [
      { id: 'a1', label: 'N', stationId: 'st-n', tripsPerWeek: 5, period: 'peak' },
      { id: 'a2', label: 'S', stationId: 'st-s', tripsPerWeek: 5, period: 'peak' },
    ];
    const t = (shortlist: ShortlistItem[], refused: unknown[] = []) =>
      tr([turn([result('1', 'set_profile', true, { refused_anchors: refused }), st(state({ profile: { anchors }, shortlist })), done])]);
    expect(distinctAnchorsReachable(t([card('a')])).status).toBe('pass');
    expect(distinctAnchorsReachable(t([card('a', { monthlyTravelHours: NaN })])).status).toBe('fail');
    expect(distinctAnchorsReachable(t([])).status).toBe('fail');
    expect(distinctAnchorsReachable(t([card('a')], [{ reason: 'unknown_station' }])).status).toBe('fail');
  });

  it('like an area but cheaper', () => {
    const lookup = result('1', 'lookup', true, { kind: 'area', matches: [{ area_id: 'kita', names: { untrusted_text: { name_ja: '北沢' } } }] });
    const evidence = [{ type: 'like_area', id: 'e1', area: 'kita', strength: 'normal' }];
    const t = (probes: Record<string, unknown>) => tr([turn([lookup, st(state({ evidence, shortlist: [card('cheap')] })), done])], probes);
    expect(likeAreaItemExists(t({})).status).toBe('pass');
    expect(topPickCheaperThanLiked(t({ compareTopVsLiked: { diffRent: 5000 } })).status).toBe('pass');
    expect(topPickCheaperThanLiked(t({ compareTopVsLiked: { diffRent: -100 } })).status).toBe('fail');
    expect(topPickCheaperThanLiked(t({})).status).toBe('fail');
    const wrongArea = tr([turn([lookup, st(state({ evidence: [{ type: 'like_area', id: 'e1', area: 'other' }] })), done])]);
    expect(likeAreaItemExists(wrongArea).status).toBe('fail');
    expect(likeAreaItemExists(tr([turn([done])])).status).toBe('fail');
    // evidence without a lookup that found the name is not enough
    expect(likeAreaItemExists(tr([turn([st(state({ evidence })), done])])).status).toBe('fail');
  });

  it('contradictor', () => {
    const flagged = result('1', 'observe', true, { items: [{ ok: true, surprising: true }] });
    const calm = result('1', 'observe', true, { items: [{ ok: true, surprising: false }] });
    expect(surprisingItemFlagged(tr([turn([call('1', 'observe'), flagged, done])])).status).toBe('pass');
    expect(surprisingItemFlagged(tr([turn([call('1', 'observe'), calm, done])])).status).toBe('fail');
    const raised = tr([turn([flagged, text('Earlier you said quiet is essential, but you picked the lively one. Which matters more?'), done])]);
    expect(agentRaisesIt(raised).status).toBe('pass');
    const silent = tr([turn([flagged, text('Great choice.'), done])]);
    expect(agentRaisesIt(silent).status).toBe('fail');
    expect(agentRaisesIt(tr([turn([calm, text('Which matters more?'), done])])).status).toBe('fail');
  });

  it('liveliestCard picks the lowest calm plus exposure term', () => {
    const mk = (id: string, calm: number, exposure: number) => card(id, { breakdown: { features: { residential_calm: calm, road_rail_exposure: exposure } } as unknown as ShortlistItem['breakdown'] });
    expect(liveliestCard([mk('quiet', 3000, -500), mk('loud', 200, -4000)])?.localityId).toBe('loud');
    expect(liveliestCard([])).toBeNull();
  });

  it('out of coverage', () => {
    const refused = result('1', 'set_profile', true, { refused_anchors: [{ anchorId: 'a', reason: 'unknown_station', message: 'Unknown station' }] });
    const asked = call('1', 'set_profile');
    const good = tr([turn([asked, refused, text('I cannot place Yokohama in my data, so I have no commute figure.'), st(state({ profile: { anchors: [] } })), done])]);
    expect(anchorRefusedWithReason(good).status).toBe('pass');
    expect(noCommuteInvented(good).status).toBe('pass');
    const invented = tr([turn([asked, refused, text('It is about 35 minutes from here.'), st(state({ profile: { anchors: [] } })), done])]);
    expect(noCommuteInvented(invented).status).toBe('fail');
    const stillAnchored = tr([turn([asked, st(state({ profile: { anchors: [{ id: 'a', label: 'x', tripsPerWeek: 5, period: 'peak' }] } })), done])]);
    expect(anchorRefusedWithReason(stillAnchored).status).toBe('fail');
    expect(anchorRefusedWithReason(tr([turn([text('Yokohama is out of my data.'), done])])).status).toBe('n/a');
    const cardWithCommute = tr([turn([st(state({ shortlist: [card('a')] })), done])]);
    expect(noCommuteInvented(cardWithCommute).status).toBe('fail');
  });

  it('impossible limits', () => {
    const relax = [{ limit: 'budget', step: 0.2, newValue: 60000, areasGained: 12, yenGained: 900, binding: true }];
    const good = tr([turn([text('Nothing fits those limits, but raising the budget by 20 percent would open 12 areas.'), st(state({ shortlist: [], relax })), done])]);
    expect(emptyShortlistWithRelax(good).status).toBe('pass');
    expect(neverNothingFoundAlone(good).status).toBe('pass');
    const bare = tr([turn([text('Nothing found.'), st(state({ shortlist: [], relax })), done])]);
    expect(neverNothingFoundAlone(bare).status).toBe('fail');
    const noRelax = tr([turn([text('Nothing fits those limits, sorry about that.'), st(state({ shortlist: [] })), done])]);
    expect(emptyShortlistWithRelax(noRelax).status).toBe('fail');
    expect(neverNothingFoundAlone(noRelax).status).toBe('fail');
    const nonEmpty = tr([turn([st(state({ shortlist: [card('a')], relax })), done])]);
    expect(emptyShortlistWithRelax(nonEmpty).status).toBe('fail');
  });
});

describe('runner pieces', () => {
  it('parseSse parses valid frames and reports invalid ones', () => {
    const body =
      'event: text\ndata: {"type":"text","delta":"hi"}\n\n' +
      'event: done\ndata: {"type":"done"}\n\n' +
      'event: bogus\ndata: {"type":"nope"}\n\n' +
      'event: text\ndata: not json\n\n';
    const { events, invalid } = parseSse(body);
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
    expect(invalid).toHaveLength(2);
  });

  it('defines the twelve personas with unique ids and at least one check each', () => {
    expect(PERSONAS).toHaveLength(12);
    expect(new Set(PERSONAS.map((p) => p.id)).size).toBe(12);
    for (const p of PERSONAS) {
      expect(p.messages.length).toBeGreaterThan(0);
      expect(p.checks.length).toBeGreaterThan(0);
    }
  });

  it('runChecks combines generic and persona checks; expected-severity failures do not fail a persona', () => {
    const persona = PERSONAS.find((p) => p.id === 'impossible_limits')!;
    const relax = [{ limit: 'budget', step: 0.2, newValue: 60000, areasGained: 12, yenGained: 900, binding: true }];
    const t = tr([turn([text('Nothing fits, but raising the budget would open areas.'), grounding(true), st(state({ shortlist: [], relax })), done])]);
    const results = runChecks(t, persona);
    expect(results).toHaveLength(6 + persona.checks.length);
    expect(personaPasses(results)).toBe(true);
    // no turn records were read, so the markup check has nothing to judge
    expect(results.find((r) => r.name.includes('markup'))?.status).toBe('n/a');
    const records = { turnRecords: [{ markupLeaked: false, fallbackUsed: false, firstGrounding: { pass: false, unmatched: ['9 min'], markup: false }, finalGrounding: { pass: true, unmatched: [], markup: false } }] };
    expect(noMarkupLeaks({ ...t, probes: records }).status).toBe('pass');
    expect(noMarkupLeaks({ ...t, probes: { turnRecords: [{ ...records.turnRecords[0], markupLeaked: true }] } }).status).toBe('fail');
    expect(noMarkupLeaks({ ...t, probes: { turnRecords: [] } }).status).toBe('fail');
    expect(expectedScore([{ name: 'x', status: 'pass', severity: 'expected', detail: '' }, { name: 'y', status: 'fail', severity: 'expected', detail: '' }, { name: 'z', status: 'n/a', severity: 'expected', detail: '' }])).toEqual({ passed: 1, total: 2 });
    expect(personaPasses([{ name: 'x', status: 'fail', severity: 'expected', detail: '' }])).toBe(true);
    expect(personaPasses([{ name: 'x', status: 'fail', severity: 'must', detail: '' }])).toBe(false);
  });

  it('message functions use the prior transcript', () => {
    const persona = PERSONAS.find((p) => p.id === 'like_shimokitazawa')!;
    const fn = persona.messages[1] as (t: Transcript) => string;
    const prior = tr([turn([st(state({ shortlist: [card('Oyamadai')] })), done])]);
    expect(fn(prior)).toContain('Oyamadai');
    expect(fn(tr([]))).toBe('The first one looks good.');
  });
});
