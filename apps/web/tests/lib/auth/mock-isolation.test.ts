import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRINCIPAL_MODULE, SESSION_MODULE } from '../../../tests-support.ts';

const TEST_TREE = fileURLToPath(new URL('../..', import.meta.url));

const GUARDED = [SESSION_MODULE, PRINCIPAL_MODULE] as const;

async function testFiles(): Promise<string[]> {
  const entries = await readdir(TEST_TREE, { recursive: true });
  return entries.filter((entry) => entry.endsWith('.test.ts') || entry.endsWith('.test.tsx'));
}

async function directMocksIn(file: string): Promise<string[]> {
  const source = await readFile(join(TEST_TREE, file), 'utf8');
  return GUARDED.filter((specifier) => source.includes(`mock.module('${specifier}'`));
}

describe('module mock isolation', () => {
  it('routes every auth module mock through the shared helper', async () => {
    const files = await testFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of await directMocksIn(file)) {
        offenders.push(
          `${file} mocks ${specifier} directly, so the mock outlives the file and every later test file sees it. Call mockSession or mockMembership from tests-support.ts instead.`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});
