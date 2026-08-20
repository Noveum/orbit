import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(import.meta.dir, 'vercel-build-gate.sh');

const SKIP = 0;
const BUILD = 1;

const READY = JSON.stringify({ number: 7, draft: false, labels: [] });
const DRAFT = JSON.stringify({ number: 7, draft: true, labels: [] });
const DRAFT_LABELLED = JSON.stringify({
  number: 7,
  draft: true,
  labels: [{ name: 'preview' }],
});
const READY_BLOCKED = JSON.stringify({
  number: 7,
  draft: false,
  labels: [{ name: 'no-preview' }],
});

let sandbox: string;
let stubBin: string;
let repo: string;
let firstCommit: string;

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function runGate(env: Record<string, string>, cwd: string = repo): { code: number; log: string } {
  const result = Bun.spawnSync(['bash', GATE], {
    cwd,
    env: {
      PATH: `${stubBin}:${process.env['PATH'] ?? ''}`,
      HOME: process.env['HOME'] ?? '',
      ...env,
    },
  });
  return {
    code: result.exitCode ?? -1,
    log: result.stderr.toString(),
  };
}

const withPullRequest = (json: string, extra: Record<string, string> = {}) => ({
  VERCEL_ENV: 'preview',
  VERCEL_GIT_PULL_REQUEST_ID: '7',
  VERCEL_GIT_REPO_OWNER: 'Noveum',
  VERCEL_GIT_REPO_SLUG: 'orbit',
  BUILD_GATE_GITHUB_TOKEN: 'token',
  MOCK_PR_JSON: json,
  ...extra,
});

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'build-gate-'));

  stubBin = join(sandbox, 'bin');
  mkdirSync(stubBin);
  const stub = join(stubBin, 'curl');
  writeFileSync(
    stub,
    [
      '#!/usr/bin/env bash',
      'if [ -n "$MOCK_CURL_FAIL" ]; then exit 7; fi',
      'printf "%s" "$MOCK_PR_JSON"',
      '',
    ].join('\n'),
  );
  chmodSync(stub, 0o755);

  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'apps', 'web'), { recursive: true });
  mkdirSync(join(repo, 'apps', 'realtime'), { recursive: true });
  mkdirSync(join(repo, 'packages'), { recursive: true });
  writeFileSync(join(repo, 'apps', 'web', 'page.tsx'), 'web\n');
  writeFileSync(join(repo, 'apps', 'realtime', 'server.ts'), 'realtime\n');
  writeFileSync(join(repo, 'tsconfig.base.json'), '{}\n');

  git(repo, 'init', '-q', '.');
  git(repo, 'config', 'user.email', 'gate@test.invalid');
  git(repo, 'config', 'user.name', 'gate');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  firstCommit = git(repo, 'rev-parse', 'HEAD');

  writeFileSync(join(repo, 'apps', 'web', 'page.tsx'), 'web changed\n');
  git(repo, 'commit', '-qam', 'touch apps/web');
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('vercel build gate', () => {
  test('production always builds', () => {
    expect(runGate({ VERCEL_ENV: 'production' }).code).toBe(BUILD);
  });

  test('absent system environment variables fail open', () => {
    const { code, log } = runGate({ VERCEL_ENV: 'preview' });
    expect(code).toBe(BUILD);
    expect(log).toContain('system environment variables');
  });

  test('a branch with no pull request skips', () => {
    expect(
      runGate({
        VERCEL_ENV: 'preview',
        VERCEL_GIT_REPO_OWNER: 'Noveum',
        VERCEL_GIT_REPO_SLUG: 'orbit',
        VERCEL_GIT_PULL_REQUEST_ID: '',
      }).code,
    ).toBe(SKIP);
  });

  test('a missing token fails open', () => {
    expect(
      runGate({
        VERCEL_ENV: 'preview',
        VERCEL_GIT_REPO_OWNER: 'Noveum',
        VERCEL_GIT_REPO_SLUG: 'orbit',
        VERCEL_GIT_PULL_REQUEST_ID: '7',
      }).code,
    ).toBe(BUILD);
  });

  test('a draft pull request skips', () => {
    expect(runGate(withPullRequest(DRAFT)).code).toBe(SKIP);
  });

  test('a ready pull request builds', () => {
    expect(runGate(withPullRequest(READY, { BUILD_GATE_WATCH_PATHS: '.' })).code).toBe(BUILD);
  });

  test('the preview label builds a draft', () => {
    expect(runGate(withPullRequest(DRAFT_LABELLED, { BUILD_GATE_WATCH_PATHS: '.' })).code).toBe(
      BUILD,
    );
  });

  test('the no-preview label skips a ready pull request', () => {
    expect(runGate(withPullRequest(READY_BLOCKED)).code).toBe(SKIP);
  });

  test('an unreadable API response fails open', () => {
    expect(runGate(withPullRequest('not json')).code).toBe(BUILD);
    expect(runGate(withPullRequest('')).code).toBe(BUILD);
    expect(runGate(withPullRequest(READY, { MOCK_CURL_FAIL: '1' })).code).toBe(BUILD);
  });

  describe('path filter', () => {
    const base = () => ({ VERCEL_GIT_PREVIOUS_SHA: firstCommit });

    test('builds when a watched path changed', () => {
      expect(
        runGate(
          withPullRequest(READY, {
            ...base(),
            BUILD_GATE_WATCH_PATHS: 'apps/web',
          }),
        ).code,
      ).toBe(BUILD);
    });

    test('skips when nothing under the watched paths changed', () => {
      expect(
        runGate(
          withPullRequest(READY, {
            ...base(),
            BUILD_GATE_WATCH_PATHS: 'packages tsconfig.base.json',
          }),
        ).code,
      ).toBe(SKIP);
    });

    test('resolves watch paths from the repository root, so a pathspec of apps/web run from apps/web does not look for apps/web/apps/web and skip every build', () => {
      const fromRootDirectory = join(repo, 'apps', 'web');

      expect(
        runGate(
          withPullRequest(READY, {
            ...base(),
            BUILD_GATE_WATCH_PATHS: 'apps/web',
          }),
          fromRootDirectory,
        ).code,
      ).toBe(BUILD);

      expect(
        runGate(
          withPullRequest(READY, {
            ...base(),
            BUILD_GATE_WATCH_PATHS: 'packages',
          }),
          fromRootDirectory,
        ).code,
      ).toBe(SKIP);
    });

    test('an unreachable diff base fails open', () => {
      expect(
        runGate(
          withPullRequest(READY, {
            VERCEL_GIT_PREVIOUS_SHA: '0'.repeat(40),
            BUILD_GATE_WATCH_PATHS: 'apps/web',
          }),
        ).code,
      ).toBe(BUILD);
    });

    test('a missing diff base fails open', () => {
      expect(runGate(withPullRequest(READY, { BUILD_GATE_WATCH_PATHS: 'apps/web' })).code).toBe(
        BUILD,
      );
    });
  });
});
