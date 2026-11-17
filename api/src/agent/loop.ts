// One turn: build context, call the model, run tools, auto-recommend after a
// state change, check grounding (one retry), then emit state and done.
import type { AgentStateView, AgentStreamEvent, GroundingFailure, NextQuestion } from "@tokyo/shared";

import { buildView } from "../routes/agent-direct.js";
import type { Figure } from "./grounding.js";
import { checkGrounding } from "./grounding.js";
import type { ChatMessage, ModelClient, ModelToolCall } from "./model-client.js";
import { buildSystemPrompt } from "./prompt.js";
import type { AgentTools, ToolContext, ToolResult } from "./tools.js";
import { MUTATING_TOOLS, toPercent } from "./tools.js";

export const MAX_TOOL_CALLS_PER_TURN = 6;
/** Including the one grounding retry: up to 6 tool-phase calls plus 1 retry. */
export const MAX_MODEL_CALLS_PER_TURN = 7;
/** Turns (user + assistant exchanges) kept verbatim in context. */
export const CONTEXT_TURNS = 8;
export const MAX_TURNS_PER_SESSION = 40;

export interface RunTurnInput {
  message: string;
  model: ModelClient;
  tools: AgentTools;
  toolContext: ToolContext;
  columnComments: Readonly<Record<string, string>>;
  emit: (event: AgentStreamEvent) => void;
  signal?: AbortSignal;
}

function sentenceAround(text: string, raw: string): string {
  const sentences = text.split(/(?<=[.!?。！？])\s*/);
  return (sentences.find((s) => s.includes(raw)) ?? raw).trim();
}

function toFailures(text: string, unmatched: readonly Figure[]): GroundingFailure[] {
  return unmatched.map((f) => ({ figure: f.raw, context: sentenceAround(text, f.raw) }));
}

/** Second miss: drop the sentences carrying unmatched figures; the cards still show. */
function dropSentences(text: string, unmatched: readonly Figure[]): string {
  const bad = (s: string) => unmatched.some((f) => s.includes(f.raw));
  // Line by line so Markdown structure survives: a table row or list item with
  // an unmatched figure goes whole; prose lines lose only those sentences.
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(?:\||[-*•]\s|\d+[.)]\s)/.test(line)) return bad(line) ? null : line;
      const kept = line
        .split(/(?<=[.!?。！？])\s*/)
        .filter((s) => !bad(s))
        .join(" ");
      return line.trim() !== "" && kept.trim() === "" ? null : kept;
    })
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function correctionMessage(unmatched: readonly Figure[]): string {
  return (
    `Your reply contains figures that are not in this turn's tool results: ${unmatched.map((f) => f.raw).join(", ")}. ` +
    "Rewrite the reply using only figures copied exactly from the tool results, or leave those figures out."
  );
}

// Model tool-call markup written as plain text (DeepSeek DSML and similar):
// "<｜DSML｜ ...", fullwidth "＜", zero-width characters or spaces in between,
// "<tool_call>", "<function_calls>", "<｜tool▁calls▁begin｜>".
const MARKUP =
  /[<＜][\s\u200B-\u200D\uFEFF]*[｜|]|[｜|][\s\u200B-\u200D\uFEFF]*DSML|<[\s\u200B-\u200D\uFEFF]*\/?[\s\u200B-\u200D\uFEFF]*(?:tool_?calls?|function_?calls?|invoke)\b|tool[▁_ ]calls?[▁_ ]begin/i;

export const hasToolMarkup = (text: string): boolean => MARKUP.test(text);

/** Cuts from the first tool-call marker to the end; `flagged` says one was found. */
export function sanitizeReply(text: string): { text: string; flagged: boolean } {
  const at = text.search(MARKUP);
  if (at === -1) return { text: text.trim(), flagged: false };
  return { text: text.slice(0, at).trim(), flagged: true };
}

const messageOf = (t: { role: string; content: string }): ChatMessage =>
  t.role === "assistant" ? { role: "assistant", content: t.content } : { role: "user", content: t.content };

/** Stored assistant turns that still carry markup (sessions polluted earlier) are left out of context. */
const isMessages = (turns: readonly { role: string; content: string }[]): ChatMessage[] =>
  turns.filter((t) => !(t.role === "assistant" && hasToolMarkup(t.content))).map(messageOf);

function areaName(ctx: ToolContext, view: AgentStateView, id: string): string | null {
  const item = view.recommendation?.shortlist.find((s) => s.localityId === id);
  if (item) return item.nameEn ?? item.nameJa;
  const index = ctx.features.areaIndex.get(id);
  const area = index === undefined ? undefined : ctx.features.areas[index];
  return area ? (area.name_en ?? area.name_ja) : null;
}

function questionSentence(q: NextQuestion, ctx: ToolContext, view: AgentStateView): string | null {
  if (q.kind === "profile_fact") {
    return {
      anchor: "Where will you travel to most often?",
      trips_per_week: "How many days a week do you make that trip?",
      layout: "What layout are you looking for?",
      budget: "What is your monthly budget?",
    }[q.missing];
  }
  if (q.kind === "pair") {
    const a = areaName(ctx, view, q.a);
    const b = areaName(ctx, view, q.b);
    return a !== null && b !== null ? `Which would you prefer, ${a} or ${b}?` : null;
  }
  const names = q.set.map((id) => areaName(ctx, view, id)).filter((n): n is string => n !== null);
  return names.length > 0 ? `Which of these appeals to you most: ${names.join(", ")}?` : null;
}

/**
 * Built only from the current state view, so its one figure (the top area's
 * chance of being best, as a whole percent like the tools round it) is in the
 * state the page shows. `figures` is what grounding must be allowed to see.
 */
export function fallbackReply(view: AgentStateView, ctx: ToolContext): { text: string; figures: unknown[] } {
  const rec = view.recommendation;
  const top = rec?.shortlist[0];
  const parts: string[] = [];
  const figures: unknown[] = [];
  if (top) {
    const percent = toPercent(top.pBest);
    figures.push({ chance_best_percent: percent });
    parts.push(`${top.nameEn ?? top.nameJa} is the strongest match so far, with a ${String(percent)}% chance of being best.`);
  }
  const question = rec?.nextQuestion ? questionSentence(rec.nextQuestion, ctx, view) : null;
  parts.push(question ?? "The cards show the details.");
  return { text: parts.join(" "), figures };
}

/** Never throws: a failure becomes an `error` event, and `done` is always last. */
export async function runTurn(input: RunTurnInput): Promise<void> {
  const { emit, toolContext: ctx, model, tools } = input;
  const session = ctx.session;
  try {
    const userTurns = session.turns.filter((t) => t.role === "user").length;
    if (userTurns >= MAX_TURNS_PER_SESSION) {
      emit({ type: "error", code: "TURN_LIMIT", message: `This session has reached ${String(MAX_TURNS_PER_SESSION)} turns; start a new one.` });
      return;
    }

    const before = buildView(session.engine);
    const snapshot = session.engine.snapshot();
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({ view: before, questionsAsked: snapshot.questionsAsked, columnComments: input.columnComments }),
      },
      ...isMessages(session.turns.slice(-CONTEXT_TURNS * 2)),
      { role: "user", content: input.message },
    ];

    const toolResults: unknown[] = [];
    let toolCallsUsed = 0;
    let modelCalls = 0;
    let autoId = 0;
    let finalText: string | null = null;
    /** Tool executions this turn, harness recommends included. */
    let ran = 0;

    const runOne = async (call: ModelToolCall, harness = false): Promise<ToolResult> => {
      let parsedInput: unknown = call.arguments;
      try {
        parsedInput = JSON.parse(call.arguments);
      } catch {
        // Passed through raw; the tool reports invalid_input.
      }
      ran++;
      emit({ type: "tool_call", id: call.id, name: call.name, input: parsedInput });
      let result: ToolResult;
      if (!harness && toolCallsUsed >= MAX_TOOL_CALLS_PER_TURN) {
        result = { ok: false, error: { code: "budget_exceeded", message: `At most ${String(MAX_TOOL_CALLS_PER_TURN)} tool calls per turn; answer now.` } };
      } else {
        if (!harness) toolCallsUsed++;
        result = await tools.run(call.name, call.arguments, ctx);
      }
      emit({ type: "tool_result", id: call.id, name: call.name, ok: result.ok, result: result.ok ? result.result : result.error });
      if (result.ok) toolResults.push(result.result);
      return result;
    };

    // Tool phase: up to MAX - 1 model calls, keeping one for the grounding retry.
    // Tools are always offered. If the last tool-phase call still asks for tools,
    // they are not run and the turn ends on the fallback reply.
    let failed = false;
    let exhausted = false;
    try {
      while (finalText === null && modelCalls < MAX_MODEL_CALLS_PER_TURN - 1) {
        modelCalls++;
        const response = await model.complete({
          messages,
          tools: tools.specs,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        if (response.toolCalls.length === 0) {
          finalText = response.text;
          break;
        }
        if (modelCalls >= MAX_MODEL_CALLS_PER_TURN - 1) {
          exhausted = true;
          break;
        }

        const assistant: ChatMessage & { role: "assistant" } = {
          role: "assistant",
          content: response.text === "" ? null : response.text,
          tool_calls: [...response.toolCalls],
        };
        const toolMessages: ChatMessage[] = [];
        let stale = false;
        for (const call of response.toolCalls) {
          const result = await runOne(call);
          if (result.ok && MUTATING_TOOLS.has(call.name)) stale = true;
          if (result.ok && call.name === "recommend") stale = false;
          toolMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        if (stale) {
          // A changed belief with a stale shortlist must never reach the page.
          const call: ModelToolCall = { id: `harness_recommend_${String(++autoId)}`, name: "recommend", arguments: "{}" };
          const result = await runOne(call, true);
          assistant.tool_calls!.push(call);
          toolMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        messages.push(assistant, ...toolMessages);
      }
    } catch (err) {
      // Before any tool ran, keep the plain error path; after, answer from the state.
      if (ran === 0) throw err;
      failed = true;
    }

    const profile = () => session.engine.snapshot().profile;
    const after: AgentStateView = buildView(session.engine);
    const fallback = fallbackReply(after, ctx);
    let extraFigures: unknown[] = [];
    const useFallback = (): string => {
      extraFigures = fallback.figures;
      return fallback.text;
    };

    let text: string;
    if (failed || exhausted) {
      text = useFallback();
    } else {
      const clean = sanitizeReply(finalText ?? "");
      text = clean.flagged || clean.text === "" ? useFallback() : clean.text;
    }
    let checkedText = text;
    let check = checkGrounding({ reply: text, toolResults: [...toolResults, ...extraFigures], profile: profile() });
    if (!check.pass && extraFigures.length === 0) {
      emit({ type: "grounding", pass: false, failures: toFailures(text, check.unmatched) });
      if (modelCalls < MAX_MODEL_CALLS_PER_TURN) {
        modelCalls++;
        messages.push({ role: "assistant", content: text }, { role: "user", content: correctionMessage(check.unmatched) });
        let retryText: string | null = null;
        try {
          const retry = await model.complete({ messages, ...(input.signal ? { signal: input.signal } : {}) });
          const clean = sanitizeReply(retry.text);
          retryText = clean.flagged || clean.text === "" ? null : clean.text;
        } catch (err) {
          if (ran === 0) throw err;
        }
        text = retryText ?? useFallback();
        checkedText = text;
        check = checkGrounding({ reply: text, toolResults: [...toolResults, ...extraFigures], profile: profile() });
      }
    }
    if (!check.pass) text = dropSentences(text, check.unmatched);

    if (text !== "") emit({ type: "text", delta: text });
    emit({ type: "grounding", pass: check.pass, failures: check.pass ? [] : toFailures(checkedText, check.unmatched) });
    emit({ type: "state", state: after });

    session.turns.push({ role: "user", content: input.message }, { role: "assistant", content: text });
  } catch (err) {
    emit({
      type: "error",
      code: "TURN_FAILED",
      message: err instanceof Error ? err.message.slice(0, 300) : "The turn failed.",
    });
  } finally {
    emit({ type: "done" });
  }
}
