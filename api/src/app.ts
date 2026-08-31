/**
 * Builds the Fastify application. Dependencies (the DB pool now, the
 * transit graph in a later task) are passed in explicitly rather than
 * reached for as module-level singletons, so tests can inject fakes and
 * exercise routes with `app.inject()` without a real database.
 */

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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
import { registerLocalityRoute } from "./routes/localities.js";
import { registerOptimizeRoute } from "./routes/optimize.js";
import { registerPlacesRoute } from "./routes/places.js";
import { registerStationsRoute } from "./routes/stations.js";

/**
 * `graphs` is the pair of in-memory transit graphs built once at startup
 * (`server.ts`'s `reloadGraph`). A graph built from zero `rail_edges` rows (both `peak` and
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

/** Shared by the global limit and `/v1/optimize`'s stricter per-route one. */
export const RATE_LIMIT_WINDOW = "1 minute";

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    // `requestIdHeader` makes Fastify read an incoming `x-request-id`
    // header as the request id when present; `genReqId` is only the
    // fallback generator for requests that don't send one.
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
    trustProxy: deps.config.TRUST_PROXY,
  });

  void app.register(helmet, {
    // The browser app is served from a different origin than this API, and
    // helmet's default `same-origin` policy would block it from reading any
    // response.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // This API serves only JSON — a script/style/frame policy guards nothing
    // here and costs ~200 bytes on every response.
    contentSecurityPolicy: false,
  });

  void app.register(cors, { origin: deps.config.CORS_ORIGIN });

  // Registered before the routes so each can tighten `max` via its own
  // `config.rateLimit` (see `/v1/optimize`).
  void app.register(rateLimit, {
    max: deps.config.RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
    // The plugin THROWS whatever this returns, so it must be an `ApiError`
    // for the global handler to render the documented error envelope —
    // a plain body object falls through to a 500.
    errorResponseBuilder: (_request, context) =>
      new ApiError(429, "RATE_LIMITED", `Too many requests. Retry in ${context.after}.`),
  });

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

  // Routes go in their own plugin so they are defined only AFTER the
  // plugins above have finished loading. `register` defers loading, so
  // routes added synchronously here would be built before the rate
  // limiter's `onRoute` hook exists — silently dropping every per-route
  // `config.rateLimit` (and with it `/v1/optimize`'s stricter budget).
  void app.register((instance, _opts, done) => {
    registerHealthRoute(instance, { pool: deps.pool });
    registerStationsRoute(instance, deps);
    registerPlacesRoute(instance, deps);
    registerOptimizeRoute(instance, deps);
    registerNeighborhoodRoute(instance, deps);
    registerLocalityRoute(instance, deps);
    registerDataStatusRoute(instance, deps);
    done();
  });

  return app;
}
