import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const NODE_ENVS = ["development", "production", "test"] as const;

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    // Matchi is deployed as separate web and API projects. Keep the fallback
    // explicit so Preview deployments remain safe and usable even when the
    // dashboard variable has only been configured for Production.
    CORS_ORIGIN: z.string().min(1).default("https://matchi-web-ten.vercel.app"),
    NODE_ENV: z.enum(NODE_ENVS).default("development"),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_OPTIMIZE_MAX: z.coerce.number().int().positive().default(20),

    // Keep each Fluid Compute instance modest: concurrency is handled by pg's
    // pool, while a small maximum prevents a traffic spike from exhausting
    // Neon connections across newly created instances.
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(10).default(2),
    DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(5_000),

    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .refine((env) => !(env.NODE_ENV === "production" && env.CORS_ORIGIN === "*"), {
    path: ["CORS_ORIGIN"],
    message:
      'must name explicit origins in production (e.g. "https://matchi.app") — "*" is development-only',
  });

export type Config = z.infer<typeof envSchema>;

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
