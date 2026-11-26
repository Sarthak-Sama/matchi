// POST /v1/agent/events: client feedback (what people looked at, liked, chose),
// stored in agent_events next to the server's turn records.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ApiError } from "../application.js";
import type { DbPool } from "../db.js";
import { parseOrThrow } from "./lib/validation.js";

export interface AgentEventsDeps {
  pool: DbPool;
}

const EVENT_KINDS = ["impression", "open", "like", "dislike", "map_click", "listing_click", "share", "chosen"] as const;
const MAX_BATCH = 50;
const MAX_PAYLOAD_CHARS = 1_000;

const EventSchema = z.object({
  sessionId: z.string().uuid(),
  kind: z.enum(EVENT_KINDS),
  areaId: z.string().min(1).max(100).optional(),
  payload: z
    .record(z.string(), z.unknown())
    .refine((p) => JSON.stringify(p).length <= MAX_PAYLOAD_CHARS, "payload is too large")
    .optional(),
});
const BodySchema = z.object({ items: z.array(EventSchema).min(1).max(MAX_BATCH) });

/** Looser than the turn route: these are small, batched and cost no model calls. */
const EVENTS_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };

/**
 * navigator.sendBeacon posts a text/plain body (no CORS preflight, which a
 * page that is closing cannot wait for), so the JSON may arrive as a string.
 */
function bodyOf(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body is not valid JSON");
  }
}

export function registerAgentEventsRoute(app: FastifyInstance, deps: AgentEventsDeps): void {
  app.post("/v1/agent/events", { config: { rateLimit: EVENTS_RATE_LIMIT } }, async (request, reply) => {
    const { items } = parseOrThrow(BodySchema, bodyOf(request.body));
    // One statement for the batch; payloads go as text and are cast to jsonb here.
    await deps.pool.query(
      `INSERT INTO public.agent_events (session_id, kind, payload)
       SELECT session_id, kind, payload::jsonb FROM unnest($1::uuid[], $2::text[], $3::text[]) AS t(session_id, kind, payload)`,
      [
        items.map((i) => i.sessionId),
        items.map((i) => i.kind),
        items.map((i) => JSON.stringify({ ...(i.areaId === undefined ? {} : { areaId: i.areaId }), ...i.payload })),
      ],
    );
    reply.status(202).send({ accepted: items.length });
  });
}
