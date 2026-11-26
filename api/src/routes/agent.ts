// POST /v1/agent/turn: one agent turn as a server-sent event stream.
import type { AgentStreamEvent } from "@tokyo/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PassThrough } from "node:stream";
import { z } from "zod";

import { ApiError } from "../application.js";
import type { TurnRecord } from "../agent/loop.js";
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

/** Logged, then stored as one agent_events row. A failed write only logs: the turn already answered. */
async function recordTurn(request: FastifyRequest, pool: AgentPool, sessionId: string, record: TurnRecord): Promise<void> {
  request.log.info({ turn: record }, "agent turn");
  try {
    await pool.query("INSERT INTO public.agent_events (session_id, kind, payload) VALUES ($1, 'turn', $2)", [
      sessionId,
      JSON.stringify(record),
    ]);
  } catch (err) {
    request.log.warn({ err, sessionId }, "agent turn event write failed");
  }
}

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
    const session = await runtime.sessions.get(sessionId);
    if (session === undefined) throw new ApiError(404, "SESSION_NOT_FOUND", `Unknown session "${sessionId}"`);

    const tools = createAgentTools(() => Object.keys(runtime.features.params.layoutAreaSqm), { queryAreasEnabled });
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) abort.abort();
    });

    sendStream();
    // runTurn ends with `done`. It is held back until the session is saved, so
    // a client that sends its next message on `done` reads the saved state,
    // and the save finishes before the response ends (a serverless instance
    // may be frozen once it has). The save runs on every path: success, error,
    // abort and fallback; tools may have changed the engine on any of them.
    const turnEmit = (event: AgentStreamEvent): void => {
      if (event.type !== "done") emit(event);
    };
    void (async () => {
      let record: TurnRecord | undefined;
      try {
        record = await runTurn({
          traceId: request.id,
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
          emit: turnEmit,
          signal: abort.signal,
        });
      } catch (err) {
        // runTurn reports its own failures as events; this is a last resort.
        request.log.error({ err, sessionId }, "agent turn threw");
      } finally {
        try {
          await runtime.sessions.save(session);
        } catch (err) {
          request.log.error({ err, sessionId }, "agent session save failed");
          emit({
            type: "error",
            code: "SESSION_SAVE_FAILED",
            message: "This turn could not be saved; the next message may not see it.",
          });
        }
        emit({ type: "done" });
        if (record !== undefined) await recordTurn(request, deps.pool, session.id, record);
        stream.end();
      }
    })();
    return reply;
  });
}
