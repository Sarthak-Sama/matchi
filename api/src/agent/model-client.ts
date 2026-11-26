// One model interface, one OpenAI-compatible implementation (fetch, streaming
// chat completions with tool calls) and a scripted fake for tests and no-key runs.

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  parameters: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  /** Raw JSON string as produced by the model. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ModelToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ModelRequest {
  messages: readonly ChatMessage[];
  /** Omitted or empty: the model must answer in text. */
  tools?: readonly ToolSpec[];
  /** Called with each text delta as it streams. */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string;
  toolCalls: ModelToolCall[];
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * The part of fetch this client uses. Declared here rather than taken from
 * `typeof fetch`: Vercel's build type-checks with a setup where the global
 * Response type resolves to an empty interface (no ok/status/body).
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  /** Per model call. */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 25_000;

interface StreamDelta {
  content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

/** Parses an SSE body of chat.completion.chunk objects. Exported for tests. */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onText?: (delta: string) => void,
): Promise<ModelResponse> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let text = "";
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "" || data === "[DONE]") return;
    let chunk: { choices?: { delta?: StreamDelta }[] };
    try {
      chunk = JSON.parse(data) as typeof chunk;
    } catch {
      return;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (delta === undefined) return;
    if (typeof delta.content === "string" && delta.content !== "") {
      text += delta.content;
      onText?.(delta.content);
    }
    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? 0;
      const entry = calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.arguments += call.function.arguments;
      calls.set(index, entry);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer !== "") handleLine(buffer);

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({ ...call, id: call.id || `call_${String(index)}` }));
  return { text, toolCalls };
}

export function createOpenAiCompatibleModel(options: OpenAiCompatibleOptions): ModelClient {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    async complete(request) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      const body: Record<string, unknown> = {
        model: options.model,
        stream: true,
        messages: request.messages.map((m) =>
          m.role === "assistant"
            ? {
                role: "assistant",
                content: m.content,
                ...(m.tool_calls && m.tool_calls.length > 0
                  ? {
                      tool_calls: m.tool_calls.map((c) => ({
                        id: c.id,
                        type: "function",
                        function: { name: c.name, arguments: c.arguments },
                      })),
                    }
                  : {}),
              }
            : m,
        ),
      };
      if (request.tools && request.tools.length > 0) {
        body["tools"] = request.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok || response.body === null) {
        // The status only: provider error bodies can echo request content.
        throw new Error(`model request failed with HTTP ${String(response.status)}`);
      }
      return readChatStream(response.body, request.onText);
    },
  };
}

/** Null when AGENT_MODEL_API_KEY is unset: the API still starts, the turn route reports "no model configured". */
export function createModelClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient | null {
  const apiKey = env["AGENT_MODEL_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;
  const model = env["AGENT_MODEL"];
  if (model === undefined || model === "") return null;
  const timeoutMs = Number(env["AGENT_MODEL_TIMEOUT_MS"]);
  return createOpenAiCompatibleModel({
    baseUrl: env["AGENT_MODEL_BASE_URL"] || DEFAULT_BASE_URL,
    apiKey,
    model,
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
  });
}

/** One scripted reply: text, tool calls, or a function of the request. */
export type ScriptedStep =
  | { text: string; toolCalls?: undefined }
  | { text?: string; toolCalls: { id?: string; name: string; input: unknown }[] }
  | ((request: ModelRequest) => ModelResponse);

export interface ScriptedModel extends ModelClient {
  /** Every request received, in order (messages copied). */
  requests: ModelRequest[];
}

/** Plays `steps` in order; past the end it answers with empty text. */
export function createScriptedModel(steps: readonly ScriptedStep[]): ScriptedModel {
  let next = 0;
  let callCounter = 0;
  const requests: ModelRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push({ ...request, messages: [...request.messages] });
      const step = steps[next++];
      let response: ModelResponse;
      if (step === undefined) response = { text: "", toolCalls: [] };
      else if (typeof step === "function") response = step(request);
      else {
        response = {
          text: step.text ?? "",
          toolCalls: (step.toolCalls ?? []).map((c) => ({
            id: c.id ?? `scripted_${String(++callCounter)}`,
            name: c.name,
            arguments: JSON.stringify(c.input),
          })),
        };
      }
      if (response.text !== "") request.onText?.(response.text);
      return response;
    },
  };
}
