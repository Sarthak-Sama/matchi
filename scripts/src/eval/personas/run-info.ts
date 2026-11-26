// What a persona run needs to be comparable with another one: the target it ran against and the build behind it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Target = 'local' | 'remote' | 'prod';

/** Hosts that are production whatever the environment says. AGENT_PROD_URL adds the production API's URL. */
const KNOWN_PROD_HOSTS: readonly string[] = ['matchi-web-ten.vercel.app'];
const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function targetOf(baseUrl: string, env: NodeJS.ProcessEnv = process.env): Target {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'remote';
  }
  if ([...KNOWN_PROD_HOSTS, hostOf(env['AGENT_PROD_URL'] ?? '')].includes(url.host)) return 'prod';
  return LOCAL_HOSTS.includes(url.hostname) ? 'local' : 'remote';
}

/**
 * Only production needs --allow-prod: the nightly job runs against staging without it, and local runs are free.
 * That is narrower than "any non-local URL" on purpose; a staging URL must simply not be listed as production.
 */
export function assertMayTarget(baseUrl: string, allowProd: boolean, env: NodeJS.ProcessEnv = process.env): void {
  if (targetOf(baseUrl, env) === 'prod' && !allowProd) {
    throw new Error(`${baseUrl} is production. Pass --allow-prod to run the personas against it (this spends the live model budget).`);
  }
}

export interface RunInfo {
  target: Target;
  /** The script only sees the API over HTTP, so this is AGENT_MODEL in the script's own environment: set it to match the API. */
  model: string;
  /** Null: the API sends no temperature, so the provider's default applies. */
  temperature: number | null;
  /** sha1 of the system prompt the checked-out code builds with an empty state. */
  promptHash: string;
  gitSha: string;
  /** sha1 of data/catalog.json, the pinned source releases. */
  dataRelease: string;
}

const sha1 = (text: string | Buffer): string => createHash('sha1').update(text).digest('hex');

const repoPath = (relative: string): string => fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));

async function promptHash(): Promise<string> {
  const { buildSystemPrompt } = (await import(/* @vite-ignore */ repoPath('api/src/agent/prompt.ts'))) as {
    buildSystemPrompt: (input: { view: unknown; questionsAsked: number; columnComments: Record<string, string> }) => string;
  };
  const emptyView = { profile: { anchors: [], enoughMultipliers: {} }, evidence: [], belief: { params: [] }, recommendation: null, riskYen: null };
  return sha1(buildSystemPrompt({ view: emptyView, questionsAsked: 0, columnComments: {} }));
}

function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath('.'), encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function collectRunInfo(baseUrl: string): Promise<RunInfo> {
  return {
    target: targetOf(baseUrl),
    model: process.env['AGENT_MODEL'] || 'unknown',
    temperature: null,
    promptHash: await promptHash(),
    gitSha: gitSha(),
    dataRelease: sha1(readFileSync(repoPath('data/catalog.json'))),
  };
}
