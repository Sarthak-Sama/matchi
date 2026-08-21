/**
 * Environment configuration for the API. Parsed and validated once at
 * startup with Zod so the process fails fast with a readable error instead
 * of surfacing a confusing runtime failure later.
 */

import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const NODE_ENVS = ["development", "production", "test"] as const;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  CORS_ORIGIN: z.string().min(1).default("*"),
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Parses `env` (defaults to `process.env`) into a validated `Config`.
 * Throws an `Error` whose message enumerates every missing or invalid
 * variable, one per line, when validation fails.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${path}: ${issue.message}`;
    });
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
