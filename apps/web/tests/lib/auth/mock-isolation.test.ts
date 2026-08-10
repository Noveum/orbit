import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRINCIPAL_MODULE, SESSION_MODULE } from '../../../tests-support.ts';

const TEST_TREE = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const GUARDED = [SESSION_MODULE, PRINCIPAL_MODULE] as const;

const MUST_BE_RESTORED = ['@/lib/query/use-issue-search.ts'] as const;

interface Candidate {
  readonly label: string;
  readonly path: string;
}

async function everythingThatCanInstallAMock(): Promise<Candidate[]> {
  const inTree = await readdir(TEST_TREE, { recursive: true });
  const atRoot = await readdir(PACKAGE_ROOT);
  return [
    ...inTree
      .filter((entry) => entry.endsWith('.test.ts') || entry.endsWith('.test.tsx'))
      .map((entry) => ({ label: `tests/${entry}`, path: join(TEST_TREE, entry) })),
    ...atRoot
      .filter((entry) => entry.startsWith('tests-support') && entry.endsWith('.ts'))
      .map((entry) => ({ label: entry, path: join(PACKAGE_ROOT, entry) })),
  ];
}

function asPattern(specifier: string): string {
  return specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stubs(source: string, specifier: string): boolean {
  return new RegExp(`mock\\.module\\(\\s*['"\`]${asPattern(specifier)}['"\`]`).test(source);
}

function stringConstantsIn(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([^'"`]+)['"`]/g)].map(
      (declaration) => [declaration[1] ?? '', declaration[2] ?? ''],
    ),
  );
}

function timesStubbed(source: string, specifier: string): number {
  const constants = stringConstantsIn(source);
  let seen = 0;
  for (const call of source.matchAll(
    /mock\.module\(\s*(?:['"`]([^'"`]+)['"`]|([A-Za-z_$][\w$]*))/g,
  )) {
    const named = call[2];
    const reached = call[1] ?? (named === undefined ? undefined : constants.get(named));
    if (reached === specifier) seen += 1;
  }
  return seen;
}

function specifiersHandedToTheHelper(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/restoreModulesAfterThisFile\(\s*\[([^\]]*)\]/g)].flatMap((call) =>
      [...(call[1] ?? '').matchAll(/['"`]([^'"`]+)['"`]/g)].map((entry) => entry[1] ?? ''),
    ),
  );
}

function putsItBack(source: string, specifier: string): boolean {
  if (specifiersHandedToTheHelper(source).has(specifier)) return true;
  return timesStubbed(source, specifier) >= 2 && /afterAll\s*\(/.test(source);
}

async function directMocksIn(candidate: Candidate): Promise<string[]> {
  const source = await readFile(candidate.path, 'utf8');
  return GUARDED.filter((specifier) => stubs(source, specifier));
}

describe('module mock isolation', () => {
  it('routes every auth module mock through the shared helper', async () => {
    const candidates = await everythingThatCanInstallAMock();
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.some((candidate) => candidate.label === 'tests-support-issue-routes.ts'),
    ).toBe(true);

    const offenders: string[] = [];
    for (const candidate of candidates) {
      for (const specifier of await directMocksIn(candidate)) {
        offenders.push(
          `${candidate.label} mocks ${specifier} directly, so the mock outlives the file and every later test file sees it. Call mockSession or mockMembership from tests-support.ts instead.`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('restores every shared query module the file stubbed', async () => {
    const candidates = await everythingThatCanInstallAMock();
    const offenders: string[] = [];

    for (const candidate of candidates) {
      const source = await readFile(candidate.path, 'utf8');

      for (const specifier of MUST_BE_RESTORED) {
        if (timesStubbed(source, specifier) === 0) continue;
        if (putsItBack(source, specifier)) continue;
        offenders.push(
          `${candidate.label} stubs ${specifier} without restoring it, so the stub outlives the file and every later test file sees it. Pass the specifier to restoreModulesAfterThisFile from tests-support.ts.`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});
