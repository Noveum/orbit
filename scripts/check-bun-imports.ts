import { readFile } from 'node:fs/promises';

const SHIPPED_ROOTS = ['packages/', 'apps/web/src/'] as const;

const RUNS_ONLY_UNDER_BUN = ['apps/realtime/', 'scripts/'] as const;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

const BINDING_FROM_BUN = /\b(import|export)\b([\s\S]*?)\bfrom\s*['"](bun(?::[\w/-]+)?)['"]/g;
const BARE_IMPORT = /\bimport\s*['"](bun(?::[\w/-]+)?)['"]/g;
const REQUIRE_BUN = /\brequire\(\s*['"](bun(?::[\w/-]+)?)['"]\s*\)/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"](bun(?::[\w/-]+)?)['"]\s*\)/g;

export function isErasedClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith('type ') || trimmed === 'type') return true;
  const braced = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (braced === null) return false;
  const bindings = (braced[1] ?? '')
    .split(',')
    .map((binding) => binding.trim())
    .filter((binding) => binding.length > 0);
  if (bindings.length === 0) return true;
  return bindings.every((binding) => /^type\s/.test(binding));
}

export interface BunImport {
  readonly file: string;
  readonly specifier: string;
  readonly line: number;
}

export function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.');
  const slash = file.lastIndexOf('/');
  return dot > slash ? file.slice(dot).toLowerCase() : '';
}

export function isShippedSource(file: string): boolean {
  if (!SOURCE_EXTENSIONS.has(extensionOf(file))) return false;
  if (file.includes('/tests/') || file.startsWith('tests/')) return false;
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false;
  if (file.endsWith('tests-preload.ts') || file.endsWith('test-support.ts')) return false;
  if (file.endsWith('test-helpers.ts') || file.endsWith('tests-support.ts')) return false;
  if (RUNS_ONLY_UNDER_BUN.some((prefix) => file.startsWith(prefix))) return false;
  return SHIPPED_ROOTS.some((prefix) => file.startsWith(prefix));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at += 1) if (text[at] === '\n') line += 1;
  return line;
}

export function bunImports(file: string, text: string): BunImport[] {
  const found: BunImport[] = [];

  BINDING_FROM_BUN.lastIndex = 0;
  let binding = BINDING_FROM_BUN.exec(text);
  while (binding !== null) {
    const specifier = binding[3];
    if (specifier !== undefined && !isErasedClause(binding[2] ?? '')) {
      found.push({ file, specifier, line: lineOf(text, binding.index) });
    }
    binding = BINDING_FROM_BUN.exec(text);
  }

  for (const pattern of [BARE_IMPORT, REQUIRE_BUN, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      const specifier = match[1];
      if (specifier !== undefined) {
        found.push({ file, specifier, line: lineOf(text, match.index) });
      }
      match = pattern.exec(text);
    }
  }

  const seen = new Set<string>();
  return found
    .filter((entry) => {
      const key = `${entry.line}:${entry.specifier}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.line - right.line);
}

export function describe(entry: BunImport): string {
  return `${entry.file}:${entry.line} imports "${entry.specifier}" at runtime.`;
}

function trackedFiles(): string[] {
  return new TextDecoder()
    .decode(Bun.spawnSync(['git', 'ls-files', '-z']).stdout)
    .split('\0')
    .filter((entry) => entry.length > 0);
}

async function main(): Promise<void> {
  const files = trackedFiles().filter(isShippedSource);
  const problems: BunImport[] = [];

  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    problems.push(...bunImports(file, text));
  }

  if (problems.length > 0) {
    for (const problem of problems) console.log(describe(problem));
    console.log(
      `\n${problems.length} runtime import(s) of a Bun built-in in shipped code. The web app runs on Vercel's node runtime, where these fail with "Cannot find module 'bun'". A type-only import is fine because it is erased; a value import is not. See the table in CLAUDE.md for the node equivalent.`,
    );
    process.exit(1);
  }
  console.log(`OK: no Bun built-ins imported at runtime in ${files.length} shipped source files.`);
}

if (import.meta.main) await main();
