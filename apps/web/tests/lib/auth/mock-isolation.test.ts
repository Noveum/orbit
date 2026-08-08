import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRINCIPAL_MODULE, SESSION_MODULE } from '../../../tests-support.ts';

const TEST_TREE = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const GUARDED = [SESSION_MODULE, PRINCIPAL_MODULE] as const;

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

async function directMocksIn(candidate: Candidate): Promise<string[]> {
  const source = await readFile(candidate.path, 'utf8');
  return GUARDED.filter((specifier) => source.includes(`mock.module('${specifier}'`));
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
});
