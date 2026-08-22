/**
 * `GET /v1/data-status` — the latest `import_runs` row per source, i.e. the
 * `source_updated_at` currently reflected in the data.
 */

import type { DataStatus } from "@tokyo/shared";
import { dataStatusSchema } from "@tokyo/shared";
import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../app.js";
import { assertDevResponseShape } from "./lib/dev-response-check.js";
import { loadLatestImportRuns } from "./lib/data-vintages.js";

export function registerDataStatusRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/data-status", async (request, reply) => {
    const runs = await loadLatestImportRuns(deps.pool);

    const body: DataStatus = {
      sources: runs.map((run) => ({
        source: run.source,
        status: run.status,
        sourceUpdatedAt: run.sourceUpdatedAt,
        importedAt: run.importedAt,
        rowsImported: run.rowsImported,
        error: run.error,
      })),
    };

    assertDevResponseShape(deps.config, request.log, dataStatusSchema, body, "GET /v1/data-status");

    reply.status(200).send(body);
  });
}
