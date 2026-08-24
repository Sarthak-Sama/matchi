/**
 * Builds the Fastify application. Dependencies (the DB pool now, the
 * transit graph in a later task) are passed in explicitly rather than
 * reached for as module-level singletons, so tests can inject fakes and
 * exercise routes with `app.inject()` without a real database.
 */

import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import type { Config } from "./config.js";
import type { DbPool } from "./db.js";
import type { TransitGraphs } from "./domain/transit/graph.js";
import { registerDataStatusRoute } from "./routes/data-status.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerNeighborhoodRoute } from "./routes/neighborhoods.js";
import { registerOptimizeRoute } from "./routes/optimize.js";
import { registerPlacesRoute } from "./routes/places.js";
import { registerStationsRoute } from "./routes/stations.js";

/**
 * `graphs` is the pair of in-memory transit graphs built once at startup
 * (`server.ts`'s `reloadGraph`) — an ADDITIVE extension to `AppDeps`, per
 * the task-10 brief, not a breaking change to the DI shape Task 4
 * established. A graph built from zero `rail_edges` rows (both `peak` and
 * `offpeak` have empty `nodes`) is a valid, well-formed `TransitGraphs`
 * value, not `null` — `/v1/optimize` itself decides whether to report
 * `GRAPH_UNAVAILABLE` by checking `nodes.size`.
 */
export interface AppDeps {
  config: Config;
  pool: DbPool;
  graphs: TransitGraphs;
}

/**
 * A typed application error: `statusCode` and `code` are carried
 * explicitly so the global error handler can map it to the documented
 * `{ error: { code, message, details? } }` shape without guessing.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const REQUEST_ID_HEADER = "x-request-id";

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    // `requestIdHeader` makes Fastify read an incoming `x-request-id`
    // header as the request id when present; `genReqId` is only the
    // fallback generator for requests that don't send one.
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
  });

  void app.register(cors, { origin: deps.config.CORS_ORIGIN });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    return payload;
  });

  app.setErrorHandler((err: Error, request, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.flatten(),
        },
      });
      return;
    }

    if (err instanceof ApiError) {
      const body: { error: { code: string; message: string; details?: unknown } } = {
        error: { code: err.code, message: err.message },
      };
      if (err.details !== undefined) {
        body.error.details = err.details;
      }
      reply.status(err.statusCode).send(body);
      return;
    }

    request.log.error({ err }, "unhandled error");
    reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
    });
  });

  registerHealthRoute(app, { pool: deps.pool });
  registerStationsRoute(app, deps);
  registerPlacesRoute(app, deps);
  registerOptimizeRoute(app, deps);
  registerNeighborhoodRoute(app, deps);
  registerDataStatusRoute(app, deps);

  return app;
}
