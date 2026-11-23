import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

type Environment = Readonly<Record<string, string | undefined>>;

export const PRODUCTION_BRANCH = 'main';

const MAX_DNS_LABEL_LENGTH = 63;
const ALIAS_HASH_LENGTH = 6;
const BUILT_CONFIG = 'dist/server/wrangler.json';

const environmentConfigSchema = z.object({
  name: z.string().min(1),
  vars: z.record(z.string(), z.string()).default({}),
});

const sourceConfigSchema = z.object({
  env: z.object({ production: environmentConfigSchema, preview: environmentConfigSchema }),
});

const builtConfigSchema = z.object({ name: z.string().min(1) });

export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export type WorkersTarget =
  | { readonly environment: 'production'; readonly worker: string }
  | { readonly environment: 'preview'; readonly worker: string; readonly base: true }
  | {
      readonly environment: 'preview';
      readonly worker: string;
      readonly base: false;
      readonly alias: string;
      readonly url: string;
    };

export function previewAlias(branch: string, worker: string): string {
  const available = MAX_DNS_LABEL_LENGTH - worker.length - 1;
  const sanitized = branch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const lettered = /^[a-z]/.test(sanitized) ? sanitized : `b-${sanitized}`.replace(/-+$/, '');
  if (lettered === branch && lettered.length <= available) return lettered;
  const suffix = createHash('sha256').update(branch).digest('hex').slice(0, ALIAS_HASH_LENGTH);
  const kept = lettered.slice(0, available - suffix.length - 1).replace(/-+$/, '');
  return `${kept}-${suffix}`;
}

export function previewUrl(alias: string, config: SourceConfig): string {
  const preview = config.env.preview;
  const base = preview.vars['BETTER_AUTH_URL'];
  if (base === undefined) throw new Error('env.preview.vars.BETTER_AUTH_URL is not set.');
  const parsed = new URL(base);
  if (!parsed.hostname.startsWith(`${preview.name}.`)) {
    throw new Error(
      `env.preview.vars.BETTER_AUTH_URL must be the workers.dev address of ${preview.name}.`,
    );
  }
  return `${parsed.protocol}//${alias}-${parsed.host}`;
}

export function workersTarget(environment: Environment, config: SourceConfig): WorkersTarget {
  const branch = environment['WORKERS_CI_BRANCH']?.trim() ?? '';
  if (branch.length === 0) {
    throw new Error('WORKERS_CI_BRANCH is not set. These scripts run inside Workers Builds.');
  }
  const requested = environment['CLOUDFLARE_ENV']?.trim() ?? '';
  const branchDefault = branch === PRODUCTION_BRANCH ? 'production' : 'preview';
  const chosen = requested.length > 0 ? requested : branchDefault;
  if (chosen === 'production') {
    if (branch !== PRODUCTION_BRANCH) {
      throw new Error(
        `Only ${PRODUCTION_BRANCH} deploys to production. ${branch} builds belong to the preview Worker.`,
      );
    }
    return { environment: 'production', worker: config.env.production.name };
  }
  if (chosen !== 'preview') throw new Error(`Unknown CLOUDFLARE_ENV ${chosen}.`);
  const worker = config.env.preview.name;
  if (branch === PRODUCTION_BRANCH) return { environment: 'preview', worker, base: true };
  const alias = previewAlias(branch, worker);
  return {
    environment: 'preview',
    worker,
    base: false,
    alias,
    url: previewUrl(alias, config),
  };
}

export function buildEnvironment(
  target: WorkersTarget,
  config: SourceConfig,
): Record<string, string> {
  if (target.environment === 'production') {
    return { CLOUDFLARE_ENV: 'production' };
  }
  const { NODE_ENV: _runtimeOnly, ...vars } = config.env.preview.vars;
  if (target.base) return { ...vars, CLOUDFLARE_ENV: 'preview' };
  return {
    ...vars,
    CLOUDFLARE_ENV: 'preview',
    BETTER_AUTH_URL: target.url,
    NEXT_PUBLIC_APP_URL: target.url,
  };
}

export function deployArguments(target: WorkersTarget): string[] {
  const config = ['--config', BUILT_CONFIG];
  if (target.environment === 'production' || target.base) return ['deploy', ...config];
  return [
    'preview',
    ...config,
    '--name',
    target.alias,
    '--var',
    `BETTER_AUTH_URL:${target.url}`,
    '--var',
    `NEXT_PUBLIC_APP_URL:${target.url}`,
  ];
}

export function assertBuiltFor(
  target: WorkersTarget,
  builtName: string,
  environment: Environment,
): void {
  if (builtName !== target.worker) {
    throw new Error(`The bundle was built for ${builtName}, not ${target.worker}.`);
  }
  const connected = environment['WRANGLER_CI_OVERRIDE_NAME']?.trim() ?? '';
  if (connected.length > 0 && connected !== target.worker) {
    throw new Error(
      `This build is connected to ${connected}, but ${environment['WORKERS_CI_BRANCH'] ?? ''} targets ${target.worker}.`,
    );
  }
}

export function deployEnvironment(environment: Environment): Record<string, string> {
  const flattened: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (key !== 'CLOUDFLARE_ENV' && value !== undefined) flattened[key] = value;
  }
  return flattened;
}

async function readSourceConfig(root: string): Promise<SourceConfig> {
  return sourceConfigSchema.parse(
    JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8')),
  );
}

async function run(command: string[], environment: Record<string, string>): Promise<void> {
  const child = Bun.spawn(command, {
    env: environment,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command.join(' ')} exited with ${code}.`);
}

function targetDescription(target: WorkersTarget): string {
  if (target.environment === 'production') return `production Worker ${target.worker}`;
  if (target.base) return `preview Worker ${target.worker}`;
  return `preview ${target.alias} of ${target.worker} at ${target.url}`;
}

async function main(step: string | undefined): Promise<void> {
  const root = resolve(import.meta.dir, '..');
  const config = await readSourceConfig(root);
  const target = workersTarget(process.env, config);
  process.stdout.write(`Workers ${step ?? ''} for the ${targetDescription(target)}\n`);
  if (step === 'build') {
    await run(['bun', 'run', 'build:workers'], {
      ...deployEnvironment(process.env),
      ...buildEnvironment(target, config),
    });
    return;
  }
  if (step === 'deploy') {
    const built = builtConfigSchema.parse(
      JSON.parse(await readFile(resolve(root, BUILT_CONFIG), 'utf8')),
    );
    assertBuiltFor(target, built.name, process.env);
    await run(['bunx', 'wrangler', ...deployArguments(target)], deployEnvironment(process.env));
    return;
  }
  throw new Error('Usage: bun scripts/workers-ci.ts build|deploy');
}

if (import.meta.main) await main(process.argv[2]);
