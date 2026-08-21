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
import { registerHealthRoute } from "./routes/health.js";

export interface AppDeps {
  config: Config;
  pool: DbPool;
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

  return app;
}
