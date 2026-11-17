// One turn: build context, call the model, run tools, auto-recommend after a
// state change, check grounding (one retry), then emit state and done.
import type { AgentStateView, AgentStreamEvent, GroundingFailure } from "@tokyo/shared";

import { buildView } from "../routes/agent-direct.js";
import type { Figure } from "./grounding.js";
import { checkGrounding } from "./grounding.js";
import type { ChatMessage, ModelClient, ModelToolCall } from "./model-client.js";
import { buildSystemPrompt } from "./prompt.js";
import type { AgentTools, ToolContext, ToolResult } from "./tools.js";
import { MUTATING_TOOLS } from "./tools.js";

export const MAX_TOOL_CALLS_PER_TURN = 6;
/** Including the one grounding retry. */
export const MAX_MODEL_CALLS_PER_TURN = 4;
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
  return text
    .split(/(?<=[.!?。！？])\s*/)
    .filter((s) => !unmatched.some((f) => s.includes(f.raw)))
    .join(" ")
    .trim();
}

function correctionMessage(unmatched: readonly Figure[]): string {
  return (
    `Your reply contains figures that are not in this turn's tool results: ${unmatched.map((f) => f.raw).join(", ")}. ` +
    "Rewrite the reply using only figures copied exactly from the tool results, or leave those figures out."
  );
}

const isMessages = (turns: readonly { role: string; content: string }[]): ChatMessage[] =>
  turns.map((t) => (t.role === "assistant" ? { role: "assistant", content: t.content } : { role: "user", content: t.content }));

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

    const runOne = async (call: ModelToolCall, harness = false): Promise<ToolResult> => {
      let parsedInput: unknown = call.arguments;
      try {
        parsedInput = JSON.parse(call.arguments);
      } catch {
        // Passed through raw; the tool reports invalid_input.
      }
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
    // The last of them is offered no tools, so it must answer in text.
    while (finalText === null && modelCalls < MAX_MODEL_CALLS_PER_TURN - 1) {
      const lastToolCall = modelCalls === MAX_MODEL_CALLS_PER_TURN - 2 || toolCallsUsed >= MAX_TOOL_CALLS_PER_TURN;
      modelCalls++;
      const response = await model.complete({
        messages,
        ...(lastToolCall ? {} : { tools: tools.specs }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (response.toolCalls.length === 0) {
        finalText = response.text;
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

    let text = finalText ?? "";
    let checkedText = text;
    const profile = () => session.engine.snapshot().profile;
    let check = checkGrounding({ reply: text, toolResults, profile: profile() });
    if (!check.pass) {
      emit({ type: "grounding", pass: false, failures: toFailures(text, check.unmatched) });
      if (modelCalls < MAX_MODEL_CALLS_PER_TURN) {
        modelCalls++;
        messages.push({ role: "assistant", content: text }, { role: "user", content: correctionMessage(check.unmatched) });
        const retry = await model.complete({ messages, ...(input.signal ? { signal: input.signal } : {}) });
        text = retry.text;
        checkedText = text;
        check = checkGrounding({ reply: text, toolResults, profile: profile() });
      }
      if (!check.pass) text = dropSentences(text, check.unmatched);
    }

    if (text !== "") emit({ type: "text", delta: text });
    emit({ type: "grounding", pass: check.pass, failures: check.pass ? [] : toFailures(checkedText, check.unmatched) });

    const after: AgentStateView = buildView(session.engine);
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
