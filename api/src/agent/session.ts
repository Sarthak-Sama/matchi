import { randomUUID } from "node:crypto";

import type { AnchorTimes, ComputeAnchorTimes, CreateEngine, Engine } from "@tokyo/shared";

import type { DbPool } from "../db.js";
import type { TransitGraphs } from "../domain/transit/graph.js";
import { createComputeAnchorTimes } from "./anchor-times.js";
import type { FeatureStore } from "./feature-store.js";
import { loadFeatureStore } from "./feature-store.js";

export interface AgentSession {
  id: string;
  seed: number;
  engine: Engine;
  anchorTimes: AnchorTimes;
  turns: { role: "user" | "assistant"; content: string }[];
}

export interface SessionStoreOptions {
  /** Oldest session is dropped past this many. Memory guard only. */
  maxSessions?: number;
  makeSeed?: () => number;
  makeId?: () => string;
}

const DEFAULT_MAX_SESSIONS = 1000;

/**
 * In-memory sessions. createEngine is injected and called with the feature
 * store's areas and params plus a per-session seed (CreateEngine's signature).
 */
export class SessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly maxSessions: number;
  private readonly makeSeed: () => number;
  private readonly makeId: () => string;

  constructor(
    private readonly createEngine: CreateEngine,
    private readonly features: Pick<FeatureStore, "areas" | "params">,
    options: SessionStoreOptions = {},
  ) {
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.makeSeed = options.makeSeed ?? (() => Math.floor(Math.random() * 2 ** 31));
    this.makeId = options.makeId ?? randomUUID;
  }

  create(): AgentSession {
    const seed = this.makeSeed();
    const session: AgentSession = {
      id: this.makeId(),
      seed,
      engine: this.createEngine(this.features.areas, this.features.params, seed),
      anchorTimes: {},
      turns: [],
    };
    this.sessions.set(session.id, session);
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    return session;
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }
}

/** Everything the agent routes share. Built once, on first use. */
export interface AgentRuntime {
  features: FeatureStore;
  sessions: SessionStore;
  computeAnchorTimes: ComputeAnchorTimes;
}

/**
 * buildApp is synchronous, so the feature store (a few queries) is loaded on
 * the first agent request and memoised; a failed load is retried next request.
 * Route modules share one runtime by calling the returned getter.
 */
export function createAgentRuntimeGetter(
  deps: { pool: DbPool; graphs: TransitGraphs },
  createEngine: CreateEngine,
): () => Promise<AgentRuntime> {
  let runtime: Promise<AgentRuntime> | null = null;
  return () => {
    runtime ??= loadFeatureStore(deps.pool).then(
      (features): AgentRuntime => ({
        features,
        sessions: new SessionStore(createEngine, features),
        computeAnchorTimes: createComputeAnchorTimes(deps),
      }),
    );
    runtime.catch(() => {
      runtime = null;
    });
    return runtime;
  };
}
