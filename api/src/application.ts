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

export interface AppDeps {
  config: Config;
  pool: DbPool;
  graphs: TransitGraphs;
}

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

export const RATE_LIMIT_WINDOW = "1 minute";

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },

    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
    trustProxy: deps.config.TRUST_PROXY,
  });

  void app.register(helmet, {
    crossOriginResourcePolicy: { policy: "cross-origin" },

    contentSecurityPolicy: false,
  });

  void app.register(cors, { origin: deps.config.CORS_ORIGIN });

  void app.register(rateLimit, {
    max: deps.config.RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,

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
