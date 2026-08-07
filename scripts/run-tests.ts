import { readdir, readFile } from 'node:fs/promises';

const WORKSPACE_ROOTS = ['packages', 'apps'] as const;

export interface TestablePackage {
  readonly name: string;
  readonly directory: string;
}

export function hasTestScript(manifest: unknown): boolean {
  if (manifest === null || typeof manifest !== 'object') return false;
  const scripts = (manifest as { scripts?: unknown }).scripts;
  if (scripts === null || scripts === undefined || typeof scripts !== 'object') return false;
  return typeof (scripts as Record<string, unknown>)['test'] === 'string';
}

export function packageName(manifest: unknown, fallback: string): string {
  if (manifest === null || typeof manifest !== 'object') return fallback;
  const name = (manifest as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : fallback;
}

export function summarise(failures: readonly string[], total: number): string {
  if (failures.length === 0) return `${total} packages passed`;
  return `${failures.length} of ${total} packages failed: ${failures.join(', ')}`;
}

async function readManifest(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function testablePackages(): Promise<TestablePackage[]> {
  const found: TestablePackage[] = [];
  for (const root of WORKSPACE_ROOTS) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = `${root}/${entry.name}`;
      const manifest = await readManifest(`${directory}/package.json`);
      if (!hasTestScript(manifest)) continue;
      found.push({ name: packageName(manifest, directory), directory });
    }
  }
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

async function runPackageTests(target: TestablePackage): Promise<boolean> {
  const started = performance.now();
  console.log(`\n> ${target.name}`);
  const child = Bun.spawn(['bun', 'run', 'test'], {
    cwd: target.directory,
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  const code = await child.exited;
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(code === 0 ? `✓ ${target.name} (${seconds}s)` : `✗ ${target.name} (${seconds}s)`);
  return code === 0;
}

async function main(): Promise<void> {
  const packages = await testablePackages();
  const failures: string[] = [];
  for (const target of packages) {
    if (!(await runPackageTests(target))) failures.push(target.name);
  }

  console.log(`\n${summarise(failures, packages.length)}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

if (import.meta.main) await main();
