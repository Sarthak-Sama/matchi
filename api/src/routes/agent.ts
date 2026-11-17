// POST /v1/agent/turn: one agent turn as a server-sent event stream.
import type { AgentStreamEvent } from "@tokyo/shared";
import type { FastifyInstance } from "fastify";
import { PassThrough } from "node:stream";
import { z } from "zod";

import { ApiError } from "../application.js";
import { runTurn } from "../agent/loop.js";
import type { ModelClient } from "../agent/model-client.js";
import { createModelClientFromEnv } from "../agent/model-client.js";
import type { AgentRuntime } from "../agent/session.js";
import type { AgentPool } from "../agent/tools.js";
import { createAgentTools } from "../agent/tools.js";
import { parseOrThrow } from "./lib/validation.js";

export interface AgentRouteDeps {
  /** The same getter the direct routes use, so both share one session store. */
  getRuntime: () => Promise<AgentRuntime>;
  pool: AgentPool;
  /** Undefined: read from env (AGENT_MODEL_*). Null: no model configured. */
  model?: ModelClient | null;
  /** Defaults to process.env.AGENT_QUERY_AREAS === "1". */
  queryAreasEnabled?: boolean;
}

const TurnBodySchema = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.string().min(1).max(4000),
});

/** Lower than the global ceiling: every turn costs model calls. */
const TURN_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

export function formatSse(event: AgentStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function registerAgentRoute(app: FastifyInstance, deps: AgentRouteDeps): void {
  const model = deps.model === undefined ? createModelClientFromEnv() : deps.model;
  const queryAreasEnabled = deps.queryAreasEnabled ?? process.env["AGENT_QUERY_AREAS"] === "1";

  app.post("/v1/agent/turn", { config: { rateLimit: TURN_RATE_LIMIT } }, async (request, reply) => {
    const { sessionId, message } = parseOrThrow(TurnBodySchema, request.body);

    const stream = new PassThrough();
    const emit = (event: AgentStreamEvent): void => {
      if (!stream.writableEnded) stream.write(formatSse(event));
    };
    const sendStream = (): void => {
      reply
        .status(200)
        .header("content-type", "text/event-stream; charset=utf-8")
        .header("cache-control", "no-cache, no-transform")
        .header("x-accel-buffering", "no")
        .send(stream);
    };

    if (model === null) {
      sendStream();
      emit({ type: "error", code: "MODEL_NOT_CONFIGURED", message: "no model configured" });
      emit({ type: "done" });
      stream.end();
      return reply;
    }

    // Runtime and session errors answer as ordinary JSON errors, like the direct routes.
    const runtime = await deps.getRuntime();
    const session = runtime.sessions.get(sessionId);
    if (session === undefined) throw new ApiError(404, "SESSION_NOT_FOUND", `Unknown session "${sessionId}"`);

    const tools = createAgentTools(() => Object.keys(runtime.features.params.layoutAreaSqm));
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) abort.abort();
    });

    sendStream();
    void runTurn({
      message,
      model,
      tools,
      toolContext: {
        session,
        features: runtime.features,
        computeAnchorTimes: runtime.computeAnchorTimes,
        pool: deps.pool,
        queryAreasEnabled,
      },
      columnComments: runtime.features.columnComments,
      emit,
      signal: abort.signal,
    }).finally(() => stream.end());
    return reply;
  });
}
