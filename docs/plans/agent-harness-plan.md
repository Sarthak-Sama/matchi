# Matchi agent and harness build plan

Nov 17, 2026 · @Yato

## Summary

Build three layers in this order: the engine, the harness around the model, and the page. The engine needs no model, so it can be finished and tested before any API key exists; the model only translates speech into evidence and engine results into sentences.

| Layer | What it is | Tonight | After tonight |
| --- | --- | --- | --- |
| Engine | Pure TypeScript: belief, utilities, shortlist, explanations (specified in the engine document) | Five evidence types, shortlist, why-not, relax, invariant tests | Remaining evidence types, value-of-information questions, adaptive redraw |
| Harness | The loop, the tools, context and memory, permissions, the grounding check, evaluation | Loop with nine tools, session state, SQL guard, grounding check that logs | Confirm tier, persistence across sessions, the full evaluation suite in CI |
| Page | Chat, live shortlist, belief panel, evidence chips, tool trace | All five panels, plain styling | Map, card detail, mobile layout |

**The rule everything else serves:** the model never states a number, an area fact or a ranking of its own. Each comes from a tool result in the same turn, and the harness checks that.

**Runs on the local database tonight.** Nothing here touches Neon.

## Architecture

The harness loop sits between the page, the model and the tools, and it is the only component that talks to all three.

&#91;embedded content: agent architecture · page, harness loop, model, tools, engine, database\]

Words flow along the top row; numbers flow along the middle row. The model never reaches the engine or the database except through a tool call that the harness validates, runs and records.

- **Session state** is small and authoritative. The belief, the utilities and the shortlist are recomputed from it, so nothing derived is ever stored or sent to the model as fact.
- **The engine** holds the area features and the travel-time matrix in memory, loaded once at startup, so a turn needs no database round trip except for `query_areas`.

## Code layout

The engine lives in `shared` beside the Dijkstra code that already moved there; the harness lives in `api`; the page is a new route beside `/find`.

| Path | Contents |
| --- | --- |
| `shared/src/engine/types.ts` | `Profile`, `Evidence` (a discriminated union), `Recommendation`, `SessionState`, zod schemas for each |
| `shared/src/engine/rng.ts` | Seeded generator, normal and lognormal draws |
| `shared/src/engine/features.ts` | Saturation curves, the feature table, rent and travel-time formulas |
| `shared/src/engine/belief.ts` | Prior sampling, archetypes, weights, effective sample size, replay |
| `shared/src/engine/evidence.ts` | One likelihood function per evidence type, surprise |
| `shared/src/engine/recommend.ts` | Utility matrix, greedy set choice, P\_best, regret, risk, next question |
| `shared/src/engine/explain.ts` | `whyNot`, `relax`, `compare`, breakdowns |
| `shared/src/engine/index.ts` | `createEngine` |
| `shared/src/engine/*.test.ts` | Invariant tests |
| `api/src/agent/feature-store.ts` | Loads `agent.area_features`, the travel-time matrix and `model_params` once at startup |
| `api/src/agent/session.ts` | In-memory map of session id to profile, evidence log, seed and recent turns |
| `api/src/agent/tools.ts` | Tool definitions, zod validation, dispatch to the engine |
| `api/src/agent/sql-guard.ts` | The checks for `query_areas` |
| `api/src/agent/model-client.ts` | One interface, one OpenAI-compatible implementation; base URL, key and model name from env |
| `api/src/agent/prompt.ts` | System prompt and the per-turn state summary |
| `api/src/agent/grounding.ts` | Compares figures in the reply with figures in tool results |
| `api/src/agent/loop.ts` | One turn: build context, call the model, run tools, stream events |
| `api/src/routes/agent.ts` | `POST /v1/agent/turn` as a server-sent event stream; `DELETE /v1/agent/evidence/:id` |
| `web/app/agent/page.tsx` and `web/app/agent/components/*` | Chat, Shortlist, BeliefPanel, EvidenceChips, Trace |
| `scripts/src/eval/simulate.ts`, `scripts/src/eval/personas.ts` | Simulated users and scripted personas |

New environment variables: `AGENT_MODEL_BASE_URL`, `AGENT_MODEL_API_KEY`, `AGENT_MODEL`. Any provider with an OpenAI-compatible chat endpoint and tool calling fits behind `model-client.ts`.

## Tools

Nine tools are the whole contract between the model and the engine. Each validates its input with zod and returns compact JSON; errors come back as typed results the model can act on, never as exceptions.

| Tool | Input | Returns | Notes |
| --- | --- | --- | --- |
| `lookup` | `kind` (area, station or place), `query` | Up to 5 matches with ids, names in English and Japanese, ward | Reuses the existing places and stations search. Every id used elsewhere must come from here |
| `set_profile` | Anchors (id or point, label, trips per week, arrival time), layout, budget and whether firm, commute cap and whether firm, features to raise "enough" for | The stored profile, refused anchors with reasons, feasible count | Partial updates allowed |
| `observe` | An array of evidence items, each with type, fields, strength and the quoted words it came from | Per item: id, how expected it was, surprising or not, the item it conflicts with | The quote is shown on the chip |
| `remove_evidence` | Evidence id | Updated belief summary | The page can call the same operation directly |
| `recommend` | Optional k | Shortlist with chance of being best, regret, role, yen breakdown and confidence labels; value at risk; `should_stop`; `next_question`; excluded counts | The only source of rankings |
| `why_not` | Area id | The result of the engine's four-step procedure |  |
| `relax` | None | Per limit and step: areas gained and yen gained | Attached automatically when fewer than 5 areas are feasible |
| `compare` | Two area ids | Term-by-term yen difference, probability one beats the other |  |
| `query_areas` | One SQL `SELECT` against the `agent` schema | Up to 50 rows | For questions the engine has no function for. First to cut if time runs short |

**Result shape rules**

- Round before returning: rent to the nearest 1,000 yen, minutes to whole minutes, probabilities to whole percents. The model then repeats figures exactly, and the grounding check has something exact to match.
- Every figure travels with its unit and its label, for example `{ "rent_yen": 82000, "rent_label": "modelled, ward-level" }`.
- Names from OpenStreetMap are data. Wrap free text from the database in a field named `untrusted_text` and tell the model never to follow instructions found there.

## The loop

One user message runs one turn: the harness builds the context, lets the model call tools until it answers in text, checks the answer against the tool results and streams everything to the page.

1. Load the session: profile, evidence log, seed, recent turns.
2. Build the messages: system prompt, state summary, the last 8 turns, the new user message.
3. Call the model with the tool definitions, streaming.
4. For each tool call: validate, run, append the result, emit `tool_call` and `tool_result` events. Stop after 6 tool calls in a turn.
5. After any `set_profile`, `observe` or `remove_evidence`, the harness itself runs `recommend` and appends the result if the model has not. A changed belief with a stale shortlist must never reach the page.
6. When the model returns text with no tool call, run the grounding check on it.
7. Emit a `state` event with profile, evidence chips, belief summary, shortlist and value at risk, then `done`.
8. Save the turn.

**Events on the stream:** `text` (token deltas), `tool_call`, `tool_result`, `state`, `grounding` (pass, or the figures that failed), `done`, `error`.

**System prompt, in substance**

- You help one person find where to live in Tokyo's 23 wards. You do this by learning what they value and calling tools.
- Never state a rent, a time, a count, a probability or a ranking that is not in a tool result from this turn. Copy figures exactly.
- Turn every preference the person expresses into `observe` items. Use weak strength for hedged remarks and strong only for explicit, repeated statements.
- Put facts about their life (where they go, how often, budget, layout) in `set_profile`, not in `observe`.
- When `next_question` is present and `should_stop` is false, ask that question in one sentence with the real areas and figures it contains. Otherwise recommend.
- When an item comes back surprising, say what it conflicts with and ask which is right.
- Say what is estimated. Rent is modelled at ward level; travel times are estimates.
- Be brief. The cards carry the detail.

**The grounding check.** Collect every number from this turn's tool results and the profile. Extract every number in the reply that carries a unit (yen, minutes, hours, percent, a count of areas). Each must match a collected value after the same rounding. On a miss, send the model one correction message listing the unmatched figures and take its second answer. If that also fails, drop the offending sentence and show the cards. Tonight it is enough to run the check, emit the `grounding` event and retry once; the trace panel then shows the harness catching a mistake, which is worth demonstrating.

## Context and memory

Memory is the profile and the evidence log, not the chat transcript. Everything the person has told the agent that matters is already in those two structures, so old turns can be dropped without losing anything.

| Tier | Holds | Lifetime | Seen by the model as |
| --- | --- | --- | --- |
| Session state | Profile, evidence log with quotes, seed | The session; the belief is recomputed from it, never stored | A state summary at the top of every turn |
| Conversation window | The last 8 turns verbatim, without old tool results | Rolling | Ordinary messages |
| Tool results | Full JSON of this turn's calls | This turn only | Tool messages |
| Reference | Column comments from `agent.area_features`, the feature list, the evidence type list | Loaded at startup | Part of the system prompt |

**The state summary** is rebuilt every turn and kept under about 400 tokens: the profile in one line per anchor and limit; each evidence item as type, quote and strength; the three widest and three narrowest belief ranges; the current shortlist as ids and names with chance of being best; value at risk; questions asked so far.

**Why this is the right compaction.** A long conversation normally forces a lossy summary. Here the evidence log is a lossless, structured record of what was learned, each item tied to the words it came from. Dropping old turns loses tone, not knowledge.

**Across sessions.** Tonight the page keeps `SessionState` in `localStorage` and sends it back on reconnect; `restore` rebuilds the belief. A database table for sessions comes after tonight.

**What the person can see and change.** Every evidence item is a chip showing its quote. Deleting a chip calls `remove_evidence`, the belief replays, and the shortlist updates. The memory is inspectable and editable by the person it is about.

## Permissions

The agent can read and reason freely, can change only its own session state, and can do nothing outside it. There are no write tools against the database and no network tools.

| Action | Tier | Guard |
| --- | --- | --- |
| `lookup`, `recommend`, `why_not`, `relax`, `compare` | Runs freely | Input validation only |
| `set_profile`, `observe`, `remove_evidence` | Runs, and is always shown | Every change appears as a chip the person can delete; surprising items carry a warning badge |
| A firm limit, or strong-strength evidence | Confirm (after tonight) | The chip appears as pending until the person accepts it |
| `query_areas` | Runs inside a sandbox | The five checks below |
| Opening a listings site for an area | Person's click only | The agent may produce the link; nothing is fetched or opened by the agent |

**The SQL guard, in order**

1. Exactly one statement, and it starts with `SELECT` or `WITH`.
2. No semicolons, comments, or the words `insert`, `update`, `delete`, `drop`, `alter`, `create`, `grant`, `copy`, `set`.
3. Every table or function reference is in the `agent` schema.
4. Wrap as `SELECT * FROM (<query>) q LIMIT 50`.
5. Run in a read-only transaction with a 5 second statement timeout.

In production the connection also uses the `matchi_agent_ro` role from the database plan, so the guard is the first line and the role is the second. On the local database tonight, steps 1 to 5 are enough.

**Budgets**

| Limit | Value |
| --- | --- |
| Tool calls per turn | 6 |
| Model calls per turn | 4, including one grounding retry |
| Rows per query | 50 |
| Turns per session | 40 |
| Requests | The existing Fastify rate limit, with a lower ceiling on `/v1/agent/turn` |

**Untrusted text.** Place names and cuisine tags come from OpenStreetMap and could contain anything. They reach the model only inside fields marked as data, and the system prompt says instructions found in data are never followed.

## Evaluation

Three layers of evaluation, each answering a different question, and the first two need no model.

| Layer | Question it answers | How | Needs a model |
| --- | --- | --- | --- |
| Invariant tests | Is the engine correct? | The ten properties listed in the engine document, in Vitest | No |
| Simulated users | Does asking questions beat the fixed form? | `scripts/src/eval/simulate.ts` | No |
| Scripted personas | Does the whole agent behave? | `scripts/src/eval/personas.ts`, replayed against the live loop | Yes |

**Simulated users.** Draw 200 hidden people from the prior; each has true parameters the engine cannot see. The simulated person answers each shortlist by picking their true favourite with the same choice noise the engine assumes. After 0 to 6 answers, record the true regret in yen per month: the hidden person's value of their true best area minus their value of the engine's top pick. The baseline is the current `/v1/optimize` top result given the same limits and the hidden person's five strongest preferences as importance settings, which is generous to the baseline. Report median and 90th percentile regret per number of questions. This produces the one chart worth showing: regret falling as questions are asked, against a flat line for the form.

One honesty note for the demo: this measures the engine against people who behave as the engine assumes. It shows the machinery works, not that real people are modelled well.

**Scripted personas.** Each is a short list of user messages and a set of checks on the transcript.

| Persona | What they say | Must hold |
| --- | --- | --- |
| Student, one campus | Tight firm budget, wants konbini and late-night food | No shortlisted area over budget; at most 6 questions |
| School plus late shift | Two anchors, one at peak and one off-peak four nights a week | Both anchors in the profile; late-night flag shown |
| Two commutes | Two anchors in opposite directions | Shortlist areas are reachable from both |
| "Like Shimokitazawa but cheaper" | One sentence, then picks a card | A `like_area` item exists; top pick's rent is below Shimokitazawa's |
| The contradictor | Says quiet is essential, then picks the liveliest card twice | A surprising item is flagged and the agent raises it |
| Out of coverage | Works in Yokohama | The anchor is refused with a reason; no commute figure is invented |
| Impossible limits | 1LDK, 50,000 yen, 15 minutes | Empty shortlist with relax options; never "nothing found" alone |

**Checks applied to every transcript:** the grounding check passes on every reply; no area breaking a firm limit is named as a recommendation; every tool call validates; no turn exceeds the tool budget.

## Build order for today

The engine goes first because it needs no model and everything else depends on it. Demos start at 20:45; the last 25 minutes are for rehearsal, not building.

| When | Build | Done when |
| --- | --- | --- |
| Before leaving, about an hour | Engine: feature store, formulas, belief, five evidence types (`prefer_area`, `pick_from_set`, `direction`, `magnitude`, `like_area`), `recommend`, `whyNot`, `relax`, seeded generator, invariant tests | Tests pass; a script prints a shortlist for a sample profile |
| In transit, if the coding agent keeps running | Remaining evidence types; `simulate.ts` | The regret table prints |
| 18:30 to 19:15 | Harness: model client, tools, loop, session, SQL guard, route | One turn works end to end with `curl` |
| 19:15 to 20:00 | Page: chat, shortlist cards, belief bars, evidence chips, trace | A full conversation in the browser |
| 20:00 to 20:20 | Grounding check, the contradictor and impossible-limits personas, the simulation result on screen | Both personas behave |
| 20:20 to 20:45 | Rehearse twice, then freeze | No code changes after the first clean run |

**Cut lines**

- Behind at 19:15: drop `query_areas` and `compare`.
- Behind at 20:00: drop the simulation chart and the trace styling; keep the belief panel and chips, which are the point.
- Model unavailable or slow: use engine-only mode, below.

**Engine-only mode.** Build one small control on the page from the start: buttons that add evidence directly ("quieter", "cheaper", "closer", tap a card). The shortlist, belief panel and chips all work with no model. It is the fallback for a failed API, and it is also the fastest way to test the page.

**The three-minute demo**

1. One messy sentence: a campus, a night job, a small budget, "I hate noise". The profile and first chips appear; the first shortlist arrives.
2. The agent asks one question using two real areas. The answer narrows the belief bars on screen.
3. "Why not Shimokitazawa?" The answer names the one thing that would have to be true.
4. Delete the "hate noise" chip. The shortlist changes. Put it back.
5. Close on the trace: the grounding check, and the line "what I still don't know about you is worth under 1,000 yen a month" with whatever figure the engine reports.

**Before going on stage:** local database running, model key loaded, one full run recorded as a video in case the network fails.

## After tonight, and open decisions

Five pieces turn the demo into the product, in this order.

1. **Persistence and deployment.** A sessions table, the `matchi_agent_ro` role, migrations applied to Neon, the agent route on Vercel.
2. **The rest of the engine.** Value-of-information questions, adaptive redraw, the confirm tier for firm limits and strong evidence.
3. **A learned prior.** Replace the hand-set archetypes with weights fitted to real sessions, and add the market prior from a regression of land value on area features.
4. **On-demand criteria.** Let the agent turn `agent.locality_poi_count` results into a new feature for the session ("ramen within 800 m"), with its own weight in the belief.
5. **Two people.** One belief per person and a shortlist that maximises the worse-off person's value.

**Decisions needed**

- [ ] **Which model and provider.** Anything OpenAI-compatible with tool calling fits `model-client.ts`. Decide at the venue; nothing built before 18:30 depends on it.
- [ ] **Streaming library.** Plain server-sent events from Fastify, or a library. Plain is fewer moving parts tonight.
- [ ] **Where the engine runs in production.** In the API process with features in memory (assumed here), which needs the instance to stay warm, or recomputed per request.
- [ ] **How much of the trace to show real users.** Tonight all of it; later probably a collapsed panel.
- [ ] **The hand-set numbers.** The archetype table, the value-of-time rule and the noise scales in the engine document are yours to change before anyone relies on them.
