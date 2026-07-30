const VERCEL_API = 'https://api.vercel.com';
const DOPPLER_API = 'https://api.doppler.com/v3';

const TARGETS = ['production', 'preview', 'development'] as const;
type Target = (typeof TARGETS)[number];

const CLUSTER_ONLY = new Set(['REDIS_URL']);
const DOPPLER_INTERNAL = /^DOPPLER_/;

interface VercelEnvEntry {
  readonly id: string;
  readonly key: string;
  readonly target: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function dopplerSecrets(payload: unknown): Map<string, string> {
  if (!(isRecord(payload) && isRecord(payload['secrets']))) {
    throw new Error('Doppler returned an unexpected payload.');
  }
  const values = new Map<string, string>();
  for (const [name, entry] of Object.entries(payload['secrets'])) {
    if (!isRecord(entry) || typeof entry['computed'] !== 'string') {
      throw new Error(`Doppler secret '${name}' has no computed value.`);
    }
    values.set(name, entry['computed']);
  }
  return values;
}

function vercelEnvEntries(payload: unknown): VercelEnvEntry[] {
  if (!(isRecord(payload) && Array.isArray(payload['envs']))) {
    throw new Error('Vercel returned an unexpected payload.');
  }
  return payload['envs'].map((entry: unknown): VercelEnvEntry => {
    if (
      !isRecord(entry) ||
      typeof entry['id'] !== 'string' ||
      typeof entry['key'] !== 'string' ||
      !Array.isArray(entry['target'])
    ) {
      throw new Error('Vercel returned a malformed environment entry.');
    }
    return {
      id: entry['id'],
      key: entry['key'],
      target: entry['target'].filter((item: unknown): item is string => typeof item === 'string'),
    };
  });
}

interface Options {
  readonly projectId: string;
  readonly teamId: string;
  readonly vercelToken: string;
  readonly dopplerToken: string;
  readonly targets: readonly Target[];
  readonly dryRun: boolean;
  readonly overrides: ReadonlyMap<string, string>;
}

function usage(): never {
  console.log(`Push the Orbit Doppler config into a Vercel project.

  bun scripts/sync-vercel-env.ts --project <prj_...> --team <team_...> [options]

Options
  --project <id>     Vercel project id, or ORBIT_VERCEL_PROJECT_ID
  --team <id>        Vercel team id, or ORBIT_VERCEL_TEAM_ID
  --target <t>       production | preview | development, repeatable. Default production
  --set K=V          Override or add a single value, repeatable
  --dry-run          Print the plan and change nothing

Credentials
  VERCEL_TOKEN       required
  DOPPLER_TOKEN_BUILD  required, falls back to the orbit-app-secrets entry in
                       AWS Secrets Manager when unset

REDIS_URL is skipped by default because the Doppler value points at the
in-cluster service. Pass it explicitly with --set REDIS_URL=rediss://...`);
  process.exit(0);
}

async function dopplerTokenFromAws(): Promise<string> {
  const proc = Bun.spawn(
    [
      'aws',
      'secretsmanager',
      'get-secret-value',
      '--secret-id',
      'orbit-app-secrets',
      '--region',
      'us-east-1',
      '--query',
      'SecretString',
      '--output',
      'text',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [raw, failure] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    const detail = failure.trim();
    throw new Error(
      `Could not read orbit-app-secrets. Set DOPPLER_TOKEN_BUILD instead.${
        detail.length > 0 ? `\n  aws: ${detail}` : ''
      }`,
    );
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || typeof parsed['DOPPLER_TOKEN_BUILD'] !== 'string') {
    throw new Error('orbit-app-secrets has no DOPPLER_TOKEN_BUILD entry.');
  }
  return parsed['DOPPLER_TOKEN_BUILD'];
}

interface ArgState {
  projectId: string;
  teamId: string;
  dryRun: boolean;
  readonly targets: Target[];
  readonly overrides: Map<string, string>;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) throw new Error(`${flag} expects a value.`);
  return value;
}

function toTarget(value: string): Target {
  const target = TARGETS.find((candidate) => candidate === value);
  if (target === undefined) throw new Error(`Unknown target '${value}'.`);
  return target;
}

function applyOverride(overrides: Map<string, string>, pair: string): void {
  const split = pair.indexOf('=');
  if (split <= 0) throw new Error(`--set expects KEY=VALUE, received '${pair}'.`);
  overrides.set(pair.slice(0, split), pair.slice(split + 1));
}

function applyFlag(state: ArgState, flag: string, next: string | undefined): number {
  switch (flag) {
    case '--help':
    case '-h':
      return usage();
    case '--dry-run':
      state.dryRun = true;
      return 0;
    case '--project':
      state.projectId = requireValue(flag, next);
      return 1;
    case '--team':
      state.teamId = requireValue(flag, next);
      return 1;
    case '--target':
      state.targets.push(toTarget(requireValue(flag, next)));
      return 1;
    case '--set':
      applyOverride(state.overrides, requireValue(flag, next));
      return 1;
    default:
      throw new Error(`Unknown argument '${flag}'. Try --help.`);
  }
}

function parseArgs(argv: readonly string[]): Options {
  const state: ArgState = {
    projectId: Bun.env['ORBIT_VERCEL_PROJECT_ID'] ?? '',
    teamId: Bun.env['ORBIT_VERCEL_TEAM_ID'] ?? '',
    dryRun: false,
    targets: [],
    overrides: new Map<string, string>(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === undefined) continue;
    index += applyFlag(state, flag, argv[index + 1]);
  }

  const vercelToken = Bun.env['VERCEL_TOKEN'] ?? '';
  if (vercelToken.length === 0) throw new Error('VERCEL_TOKEN is required.');
  if (state.projectId.length === 0) {
    throw new Error('Pass --project or set ORBIT_VERCEL_PROJECT_ID.');
  }
  if (state.teamId.length === 0) throw new Error('Pass --team or set ORBIT_VERCEL_TEAM_ID.');

  return {
    projectId: state.projectId,
    teamId: state.teamId,
    vercelToken,
    dopplerToken: Bun.env['DOPPLER_TOKEN_BUILD'] ?? '',
    targets: state.targets.length > 0 ? state.targets : ['production'],
    dryRun: state.dryRun,
    overrides: state.overrides,
  };
}

async function readDoppler(token: string): Promise<Map<string, string>> {
  const response = await fetch(`${DOPPLER_API}/configs/config/secrets`, {
    headers: { Authorization: `Basic ${btoa(`${token}:`)}` },
  });
  if (!response.ok) {
    throw new Error(`Doppler returned ${response.status}: ${await response.text()}`);
  }
  const values = dopplerSecrets(await response.json());
  for (const name of [...values.keys()]) {
    if (DOPPLER_INTERNAL.test(name) || CLUSTER_ONLY.has(name)) values.delete(name);
  }
  return values;
}

function vercel(
  options: Options,
  path: string,
  init?: { method: string; body: unknown },
): Promise<Response> {
  const separator = path.includes('?') ? '&' : '?';
  return fetch(`${VERCEL_API}${path}${separator}teamId=${options.teamId}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${options.vercelToken}`,
      ...(init === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function existingKeys(options: Options): Promise<Set<string>> {
  const response = await vercel(options, `/v9/projects/${options.projectId}/env`);
  if (!response.ok) {
    throw new Error(`Vercel returned ${response.status}: ${await response.text()}`);
  }
  const keys = new Set<string>();
  for (const entry of vercelEnvEntries(await response.json())) {
    if (options.targets.some((target) => entry.target.includes(target))) keys.add(entry.key);
  }
  return keys;
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const dopplerToken =
    options.dopplerToken.length > 0 ? options.dopplerToken : await dopplerTokenFromAws();

  const desired = await readDoppler(dopplerToken);
  for (const [key, value] of options.overrides) desired.set(key, value);

  const existing = await existingKeys(options);
  const targets = [...options.targets];

  console.log(`project ${options.projectId}`);
  console.log(`targets ${targets.join(', ')}`);
  console.log(`${desired.size} variables, ${existing.size} already set\n`);

  for (const [key, value] of [...desired].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(
      `  ${(existing.has(key) ? 'update' : 'create').padEnd(6)} ${key} (${value.length} chars)`,
    );
    if (options.dryRun) continue;

    const written = await vercel(options, `/v10/projects/${options.projectId}/env?upsert=true`, {
      method: 'POST',
      body: { key, value, type: 'encrypted', target: targets },
    });
    if (!written.ok) throw new Error(`Could not set ${key}: ${await written.text()}`);
  }

  console.log(options.dryRun ? '\ndry run, nothing changed' : `\n${desired.size} variables synced`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
