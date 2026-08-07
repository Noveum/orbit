import { LABELS, type LabelDefinition } from './labels.ts';

const DEFAULT_REPO = 'Noveum/orbit';

interface RemoteLabel {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRemoteLabel(value: unknown): RemoteLabel {
  if (!isRecord(value)) throw new Error('A label in the response was not an object.');
  const { name, color, description } = value;
  if (typeof name !== 'string' || typeof color !== 'string') {
    throw new Error('A label in the response had no name or no colour.');
  }
  return {
    name,
    color: color.toLowerCase(),
    description: typeof description === 'string' ? description : '',
  };
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PRUNE = args.includes('--prune');

function repository(): string {
  const flag = args.find((entry) => entry.startsWith('--repo='));
  if (flag !== undefined) return flag.slice('--repo='.length);
  return process.env['ORBIT_LABELS_REPO'] ?? DEFAULT_REPO;
}

async function gh(argv: readonly string[]): Promise<string> {
  const run = Bun.spawn(['gh', ...argv], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  if (code !== 0) throw new Error(`gh ${argv.join(' ')} failed: ${err.trim()}`);
  return out;
}

async function fetchExisting(repo: string): Promise<Map<string, RemoteLabel>> {
  const raw = await gh(['api', `repos/${repo}/labels?per_page=100`, '--paginate', '--slurp']);
  const pages: unknown = JSON.parse(raw);
  if (!Array.isArray(pages)) throw new Error('The labels response was not an array.');
  const byName = new Map<string, RemoteLabel>();
  for (const page of pages) {
    if (!Array.isArray(page)) throw new Error('A labels page was not an array.');
    for (const entry of page) {
      const label = toRemoteLabel(entry);
      byName.set(label.name, label);
    }
  }
  return byName;
}

function fields(label: LabelDefinition): string[] {
  return ['-f', `color=${label.color}`, '-f', `description=${label.description}`];
}

async function createLabel(repo: string, label: LabelDefinition): Promise<void> {
  await gh([
    'api',
    '--method',
    'POST',
    `repos/${repo}/labels`,
    '-f',
    `name=${label.name}`,
    ...fields(label),
  ]);
}

async function updateLabel(repo: string, label: LabelDefinition): Promise<void> {
  const path = `repos/${repo}/labels/${encodeURIComponent(label.name)}`;
  await gh(['api', '--method', 'PATCH', path, '-f', `new_name=${label.name}`, ...fields(label)]);
}

async function deleteLabel(repo: string, name: string): Promise<void> {
  await gh(['api', '--method', 'DELETE', `repos/${repo}/labels/${encodeURIComponent(name)}`]);
}

function matches(current: RemoteLabel, label: LabelDefinition): boolean {
  return current.color === label.color.toLowerCase() && current.description === label.description;
}

interface Plan {
  readonly created: string[];
  readonly updated: string[];
  readonly removed: string[];
}

async function reconcile(repo: string, existing: Map<string, RemoteLabel>): Promise<Plan> {
  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const label of LABELS) {
    const current = existing.get(label.name);
    if (current === undefined) {
      created.push(label.name);
      if (APPLY) await createLabel(repo, label);
      continue;
    }
    if (matches(current, label)) continue;
    updated.push(label.name);
    if (APPLY) await updateLabel(repo, label);
  }

  const wanted = new Set(LABELS.map((label) => label.name));
  for (const name of existing.keys()) {
    if (wanted.has(name)) continue;
    removed.push(name);
    if (APPLY && PRUNE) await deleteLabel(repo, name);
  }

  return { created, updated, removed };
}

function summarise(action: string, names: readonly string[]): string {
  return `  ${action} ${names.length}${names.length > 0 ? `: ${names.join(', ')}` : ''}`;
}

async function main(): Promise<void> {
  const repo = repository();
  const plan = await reconcile(repo, await fetchExisting(repo));

  console.log(`${APPLY ? 'Applied to' : 'Would apply to'} ${repo}`);
  console.log(summarise('create', plan.created));
  console.log(summarise('update', plan.updated));
  console.log(summarise(PRUNE ? 'delete' : 'unmanaged, pass --prune to delete', plan.removed));
  if (!APPLY) console.log('\nDry run. Pass --apply to write.');
}

if (import.meta.main) await main();
