import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  currentUtcDate,
  parseExceptionRows,
  parseFindingRows,
  parsePlanFindings,
  validateReadinessLedger,
} from '../../../scripts/check-readiness-ledger.ts';
import { TRUSTED_READINESS_WORKFLOW_DEFINITION_DIGEST } from '../../../scripts/check-readiness-scope-pr.ts';
import {
  createProductionReadinessEvidenceVerifier,
  TRUSTED_CI_WORKFLOW_DEFINITION_DIGEST,
} from '../../../scripts/readiness-evidence-verifier.ts';
import { readinessReferenceRegistrySource } from '../../../scripts/readiness-reference-registry.ts';
import { readinessScopeManifest } from '../../../scripts/readiness-scope-manifest.ts';

const INITIAL_SCOPE_VERSION = 'readiness-scope/2026-08-09-v1';
const GITHUB_EXPRESSION_PREFIX = '$';

describe('production readiness artifacts', () => {
  it('validates the committed artifacts and the initial 41-row scope', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const [planText, ledgerText] = await Promise.all([
      readFile(resolve(root, 'docs/superpowers/plans/2026-08-09-open-source-readiness.md'), 'utf8'),
      readFile(resolve(root, 'docs/maintainers/readiness-ledger.md'), 'utf8'),
    ]);
    const plan = parsePlanFindings(planText);
    const findings = parseFindingRows(ledgerText);
    const verifier = await createProductionReadinessEvidenceVerifier(
      root,
      readinessReferenceRegistrySource,
    );
    const errors = validateReadinessLedger(
      plan,
      findings,
      parseExceptionRows(ledgerText),
      currentUtcDate(new Date(verifier.verificationInstant)),
      readinessReferenceRegistrySource,
      readinessScopeManifest,
      verifier,
    );
    expect(errors).toEqual([]);
    expect(findings).toHaveLength(readinessScopeManifest.findings.length);
    expect(findings.filter((finding) => finding.priority === 'P0')).toHaveLength(
      readinessScopeManifest.findings.filter((finding) => finding.priority === 'P0').length,
    );
    expect(findings.filter((finding) => finding.priority === 'P1')).toHaveLength(
      readinessScopeManifest.findings.filter((finding) => finding.priority === 'P1').length,
    );
    if (readinessScopeManifest.version === INITIAL_SCOPE_VERSION) {
      expect(findings).toHaveLength(41);
      expect(findings.filter((finding) => finding.priority === 'P0')).toHaveLength(18);
      expect(findings.filter((finding) => finding.priority === 'P1')).toHaveLength(23);
      expect(findings.some((finding) => finding.id === 'SEC-018')).toBe(false);
    }
    expect(verifier.commitExists(verifier.currentCommit)).toBe(true);
  });

  it('keeps authenticated readiness validation in trusted-base workflow code', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const [ci, scopePolicy, scopeChecker] = await Promise.all([
      readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
      readFile(resolve(root, '.github/workflows/readiness-scope.yml'), 'utf8'),
      readFile(resolve(root, 'scripts/check-readiness-scope-pr.ts'), 'utf8'),
    ]);
    const staticJob = ci.slice(ci.indexOf('  static:'), ci.indexOf('  readiness-hosted:'));
    const expression = '$';
    expect(staticJob).not.toContain('actions: read');
    expect(staticJob).not.toContain('GITHUB_TOKEN:');
    expect(scopePolicy).toContain('pull_request_target:');
    expect(scopePolicy).toContain('pull_request_review:');
    expect(scopePolicy).toContain("github.event.review.user.login == 'imshashank'");
    expect(scopePolicy).toContain("github.event.review.user.login == 'pulkitxm'");
    expect(scopePolicy).toContain('actions: read');
    expect(scopePolicy).toContain('statuses: write');
    expect(scopePolicy).toContain('persist-credentials: false');
    expect(scopeChecker).toContain("context: 'Trusted readiness policy'");
    expect(scopeChecker).toContain(
      'const freshReviews = await githubReviews(event.pull_request.number, token);',
    );
    expect(scopeChecker.indexOf('const freshReviews')).toBeLessThan(
      scopeChecker.indexOf('const currentResult'),
    );
    expect(scopeChecker.indexOf('const currentResult')).toBeLessThan(
      scopeChecker.lastIndexOf('validateFinalReadinessScopeState'),
    );
    expect(`sha256:${createHash('sha256').update(ci).digest('hex')}`).toBe(
      TRUSTED_CI_WORKFLOW_DEFINITION_DIGEST,
    );
    expect(`sha256:${createHash('sha256').update(scopePolicy).digest('hex')}`).toBe(
      TRUSTED_READINESS_WORKFLOW_DEFINITION_DIGEST,
    );
    expect(ci).toContain(
      `name: readiness-test-${expression}{{ github.event.pull_request.head.sha || github.sha }}-${expression}{{ github.run_attempt }}`,
    );
    expect(ci).toContain('name: Readiness release gate');
    expect(ci).toContain('needs: [static, test, schema, build, e2e]');
    expect(ci).toContain(
      `name: readiness-gate-${expression}{{ github.sha }}-${expression}{{ github.run_attempt }}`,
    );
    expect(
      ci.match(/actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/g),
    ).toHaveLength(2);
    expect(scopePolicy).toContain('bun install --frozen-lockfile --ignore-scripts');
  });

  it('binds the privileged workflow to its exact parsed semantic contract', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const workflow = await readFile(resolve(root, '.github/workflows/readiness-scope.yml'), 'utf8');
    const module = (await import('../../../scripts/check-readiness-scope-pr.ts')) as Readonly<
      Record<string, unknown>
    >;
    const validator = module['validateTrustRootExecutionDependencies'];
    expect(typeof validator).toBe('function');
    if (typeof validator !== 'function') return;
    const validate = validator as (
      artifacts: readonly { readonly path: string; readonly text: string }[],
    ) => string[];
    const artifacts = [
      {
        path: '.github/workflows/readiness-scope.yml',
        text: workflow,
      },
      {
        path: 'package.json',
        text: JSON.stringify({ scripts: { prepare: 'lefthook install || true' } }),
      },
      { path: 'scripts/check-readiness-scope-pr.ts', text: '' },
    ];
    expect(validate(artifacts)).toEqual([]);
    expect(
      validate(
        artifacts.map((artifact) =>
          artifact.path === '.github/workflows/readiness-scope.yml'
            ? {
                ...artifact,
                text: artifact.text.replace(
                  `${GITHUB_EXPRESSION_PREFIX}{{ github.event.pull_request.base.sha }}`,
                  `${GITHUB_EXPRESSION_PREFIX}{{ github.event.pull_request.head.sha }}`,
                ),
              }
            : artifact,
        ),
      ),
    ).toContain('Privileged readiness workflow semantic contract is invalid.');
  });

  it('parses trusted TypeScript imports across comments and whitespace', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const workflow = await readFile(resolve(root, '.github/workflows/readiness-scope.yml'), 'utf8');
    const module = (await import('../../../scripts/check-readiness-scope-pr.ts')) as Readonly<
      Record<string, unknown>
    >;
    const validator = module['validateTrustRootExecutionDependencies'];
    expect(typeof validator).toBe('function');
    if (typeof validator !== 'function') return;
    const validate = validator as (
      artifacts: readonly { readonly path: string; readonly text: string }[],
    ) => string[];
    const artifactsFor = (source: string) => [
      { path: '.github/workflows/readiness-scope.yml', text: workflow },
      {
        path: 'package.json',
        text: JSON.stringify({ scripts: { prepare: 'lefthook install || true' } }),
      },
      { path: 'scripts/check-readiness-scope-pr.ts', text: source },
    ];
    for (const source of [
      'import/* separated */ "../apps/web/src/unprotected-helper.ts";',
      'export * from "../apps/web/src/unprotected-helper.ts";',
      'import helper = require("../apps/web/src/unprotected-helper.ts");',
      'void import("../apps/web/src/unprotected-helper.ts");',
      'require("../apps/web/src/unprotected-helper.ts");',
      'import "@orbit/shared";',
      'import "unapproved-package";',
    ])
      expect(validate(artifactsFor(source))).toContain(
        'Trusted execution dependencies must stay inside protected source paths.',
      );
    for (const source of [
      'const target = "../apps/web/src/unprotected-helper.ts"; void import(target);',
      'const target = "../apps/web/src/unprotected-helper.ts"; require(target);',
    ])
      expect(validate(artifactsFor(source))).toContain(
        'Trusted execution dependencies must use static module identities.',
      );
    expect(
      validate(
        artifactsFor(`
import { readFile } from 'node:fs/promises';
import { decodeHTMLStrict } from 'entities';
import { Marked } from 'marked';
import ts from 'typescript';
import { z } from 'zod';
void readFile;
void decodeHTMLStrict;
void Marked;
void ts;
void z;
`),
      ),
    ).toEqual([]);
  });

  it('rejects candidate root Bun and package install execution surfaces', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const workflow = await readFile(resolve(root, '.github/workflows/readiness-scope.yml'), 'utf8');
    const module = (await import('../../../scripts/check-readiness-scope-pr.ts')) as Readonly<
      Record<string, unknown>
    >;
    const validator = module['validateTrustRootExecutionDependencies'];
    expect(typeof validator).toBe('function');
    if (typeof validator !== 'function') return;
    const validate = validator as (
      artifacts: readonly { readonly path: string; readonly text: string }[],
    ) => string[];
    const artifacts = [
      { path: '.github/workflows/readiness-scope.yml', text: workflow },
      {
        path: 'package.json',
        text: JSON.stringify({ scripts: { prepare: 'lefthook install || true' } }),
      },
      { path: 'scripts/check-readiness-scope-pr.ts', text: '' },
    ];
    expect(
      validate([
        ...artifacts,
        { path: 'bunfig.toml', text: 'preload = ["./apps/web/src/unprotected-helper.ts"]\n' },
      ]),
    ).toContain('Root Bun execution configuration must remain absent.');
    for (const packageSurface of [
      { imports: { '#trusted': './apps/web/src/unprotected-helper.ts' } },
      { patchedDependencies: { package: './apps/web/src/unprotected-helper.patch' } },
    ])
      expect(
        validate(
          artifacts.map((artifact) =>
            artifact.path === 'package.json'
              ? {
                  ...artifact,
                  text: JSON.stringify({
                    ...packageSurface,
                    scripts: { prepare: 'lefthook install || true' },
                  }),
                }
              : artifact,
          ),
        ),
      ).toContain('Root package execution configuration contains a forbidden install surface.');
    expect(
      validate(
        artifacts.map((artifact) =>
          artifact.path === 'package.json'
            ? {
                ...artifact,
                text: JSON.stringify({
                  scripts: { prepare: 'lefthook install || true' },
                  trustedDependencies: ['attacker-package'],
                }),
              }
            : artifact,
        ),
      ),
    ).toContain('Root package trusted dependencies are outside the approved set.');
  });

  it('closes checker resolver and auto-loaded root configuration surfaces', async () => {
    const root = resolve(import.meta.dir, '../../..');
    const workflow = await readFile(resolve(root, '.github/workflows/readiness-scope.yml'), 'utf8');
    const module = (await import('../../../scripts/check-readiness-scope-pr.ts')) as Readonly<
      Record<string, unknown>
    >;
    const validator = module['validateTrustRootExecutionDependencies'];
    expect(typeof validator).toBe('function');
    if (typeof validator !== 'function') return;
    const validate = validator as (
      artifacts: readonly { readonly path: string; readonly text: string }[],
    ) => string[];
    const artifacts = [
      { path: '.github/workflows/readiness-scope.yml', text: workflow },
      {
        path: 'package.json',
        text: JSON.stringify({ scripts: { prepare: 'lefthook install || true' } }),
      },
      { path: 'scripts/check-readiness-scope-pr.ts', text: '' },
    ];
    expect(
      validate([
        ...artifacts,
        {
          path: 'scripts/tsconfig.json',
          text: JSON.stringify({ extends: '../apps/web/tsconfig.json' }),
        },
        {
          path: 'apps/web/tsconfig.json',
          text: JSON.stringify({ compilerOptions: {} }),
        },
      ]),
    ).toContain('Trusted TypeScript resolver configuration is invalid.');
    expect(
      validate([
        ...artifacts,
        {
          path: 'scripts/tsconfig.json',
          text: JSON.stringify({ extends: '../tsconfig.base.json' }),
        },
        {
          path: 'tsconfig.base.json',
          text: JSON.stringify({
            compilerOptions: {
              moduleResolution: 'Bundler',
              paths: { typescript: ['./apps/web/src/unprotected-helper.ts'] },
            },
          }),
        },
      ]),
    ).toContain('Trusted TypeScript resolver configuration is invalid.');
    expect(
      validate([
        ...artifacts,
        {
          path: 'scripts/tsconfig.json',
          text: JSON.stringify({ extends: '../tsconfig.base.json' }),
        },
        {
          path: 'tsconfig.base.json',
          text: JSON.stringify({
            compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' },
          }),
        },
      ]),
    ).toEqual([]);
    expect(
      validate([
        ...artifacts,
        { path: 'tsconfig.json', text: JSON.stringify({ compilerOptions: {} }) },
      ]),
    ).toContain('Trusted TypeScript resolver configuration is invalid.');
    expect(
      validate([...artifacts, { path: '.npmrc', text: 'registry=https://example.test\n' }]),
    ).toContain('Root package manager configuration must remain absent.');
    expect(
      validate([
        ...artifacts,
        {
          path: '.env.local',
          text: 'NODE_OPTIONS=--require=./apps/web/src/unprotected-helper.ts\n',
        },
      ]),
    ).toContain('Tracked runtime environment configuration must remain absent.');
    expect(
      validate([...artifacts, { path: '.env.example', text: 'DATABASE_URL=postgres://example\n' }]),
    ).toEqual([]);
  });

  it('rejects local actions outside the recursively protected action directory', async () => {
    const module = (await import('../../../scripts/check-readiness-scope-pr.ts')) as Readonly<
      Record<string, unknown>
    >;
    const validator = module['validateTrustRootExecutionDependencies'];
    expect(typeof validator).toBe('function');
    if (typeof validator !== 'function') return;
    const validate = validator as (
      artifacts: readonly { readonly path: string; readonly text: string }[],
    ) => string[];
    const workflow = `
name: Readiness scope policy
permissions:
  contents: read
jobs:
  policy:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      - uses: ./fixtures/pre-existing-action
      - run: bun install --frozen-lockfile
      - run: bun scripts/check-readiness-scope-pr.ts
`;
    const artifacts = [
      { path: '.github/workflows/policy.yml', text: workflow },
      {
        path: 'package.json',
        text: JSON.stringify({ scripts: { prepare: 'lefthook install || true' } }),
      },
      { path: 'scripts/check-readiness-scope-pr.ts', text: '' },
    ];
    expect(validate(artifacts)).toContain(
      'Repository-local actions must live under the protected .github/actions directory.',
    );
    const flowWorkflow = `
name: Readiness scope policy
permissions:
  contents: read
jobs:
  policy:
    steps: [{ uses: ./fixtures/pre-existing-action }, { run: bun install --frozen-lockfile }, { run: bun scripts/check-readiness-scope-pr.ts }]
`;
    expect(
      validate(
        artifacts.map((artifact) =>
          artifact.path === '.github/workflows/policy.yml'
            ? { ...artifact, text: flowWorkflow }
            : artifact,
        ),
      ),
    ).toContain(
      'Repository-local actions must live under the protected .github/actions directory.',
    );
    const protectedArtifacts = artifacts.map((artifact) =>
      artifact.path === '.github/workflows/policy.yml'
        ? { ...artifact, text: workflow.replace('./fixtures/', './.github/actions/') }
        : artifact,
    );
    protectedArtifacts.push({
      path: '.github/actions/pre-existing-action/action.yml',
      text: `
name: Protected action
runs:
  using: composite
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
`,
    });
    expect(validate(protectedArtifacts)).toEqual([]);

    const escapedActionArtifacts = protectedArtifacts.map((artifact) =>
      artifact.path === '.github/actions/pre-existing-action/action.yml'
        ? {
            ...artifact,
            text: `
name: Escaped action
runs:
  using: composite
  steps:
    - run: ../../../fixtures/pre-existing-helper
`,
          }
        : artifact,
    );
    escapedActionArtifacts.push({
      path: 'fixtures/pre-existing-helper',
      text: '#!/bin/sh\nexit 0\n',
    });
    expect(validate(escapedActionArtifacts)).toContain(
      'Repository-local action execution must stay inside protected dependencies.',
    );

    const futurePrivilegedWorkflow = `
name: Future privileged workflow
permissions:
  statuses: write
jobs:
  policy:
    steps:
      - run: bun apps/web/src/unprotected-helper.ts
`;
    expect(
      validate([
        ...protectedArtifacts,
        { path: '.github/workflows/future-privileged.yml', text: futurePrivilegedWorkflow },
      ]),
    ).toContain('Privileged workflows cannot execute unprotected repository commands.');

    expect(
      validate(
        protectedArtifacts.map((artifact) =>
          artifact.path === 'package.json'
            ? {
                ...artifact,
                text: JSON.stringify({
                  scripts: {
                    prepare: 'lefthook install || true',
                    postinstall: 'bun apps/web/src/unprotected-helper.ts',
                  },
                }),
              }
            : artifact,
        ),
      ),
    ).toContain('Package lifecycle execution is outside the protected command surface.');

    expect(
      validate(
        protectedArtifacts.map((artifact) =>
          artifact.path === 'package.json'
            ? {
                ...artifact,
                text: JSON.stringify({
                  scripts: {
                    prepare: 'lefthook install || true',
                    prepack: 'bun apps/web/src/unprotected-helper.ts',
                  },
                }),
              }
            : artifact,
        ),
      ),
    ).toContain('Package lifecycle execution is outside the protected command surface.');

    expect(
      validate(
        protectedArtifacts.map((artifact) =>
          artifact.path === 'scripts/check-readiness-scope-pr.ts'
            ? { ...artifact, text: "import '../apps/web/src/unprotected-helper.ts';" }
            : artifact,
        ),
      ),
    ).toContain('Trusted execution dependencies must stay inside protected source paths.');

    const commitValidator = module['validateTrustRootExecutionDependenciesForCommit'];
    expect(typeof commitValidator).toBe('function');
    if (typeof commitValidator !== 'function') return;
    const root = resolve(import.meta.dir, '../../..');
    expect(() =>
      (commitValidator as (root: string, commit: string) => string[])(root, 'HEAD^{tree}'),
    ).toThrow();
  });

  it('closes privileged reusable workflow and action dependency graphs', async () => {
    const module = (await import('../../../scripts/check-readiness-scope-pr.ts')) as Readonly<
      Record<string, unknown>
    >;
    const validator = module['validateTrustRootExecutionDependencies'];
    const commitValidator = module['validateTrustRootExecutionDependenciesForCommit'];
    expect(typeof validator).toBe('function');
    expect(typeof commitValidator).toBe('function');
    if (typeof validator !== 'function' || typeof commitValidator !== 'function') return;
    const validate = validator as (
      artifacts: readonly { readonly path: string; readonly text: string }[],
    ) => string[];
    const caller = `
name: Privileged caller
on:
  pull_request_target:
permissions:
  contents: write
jobs:
  attack:
    uses: ./.github/workflows/helper.yml
    secrets: inherit
`;
    const helper = `
name: Reusable helper
on:
  workflow_call:
jobs:
  attack:
    runs-on: ubuntu-latest
    steps:
      - run: bun apps/web/src/unprotected-helper.ts
`;
    const baseArtifacts = [
      { path: '.github/workflows/caller.yml', text: caller },
      { path: '.github/workflows/helper.yml', text: helper },
      {
        path: 'package.json',
        text: JSON.stringify({ scripts: { prepare: 'lefthook install || true' } }),
      },
      { path: 'scripts/check-readiness-scope-pr.ts', text: '' },
    ];
    expect(validate(baseArtifacts)).toContain(
      'Privileged workflows cannot execute unprotected repository commands.',
    );

    const middle = `
name: Reusable middle
on:
  workflow_call:
permissions:
  contents: read
jobs:
  nested:
    uses: ./.github/workflows/helper.yml
`;
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => artifact.path !== '.github/workflows/caller.yml'),
        {
          path: '.github/workflows/caller.yml',
          text: caller.replace('helper.yml', 'middle.yml'),
        },
        { path: '.github/workflows/middle.yml', text: middle },
      ]),
    ).toContain('Privileged workflows cannot execute unprotected repository commands.');

    const actionCaller = (uses: string) => `
name: Privileged action caller
on:
  pull_request_target:
permissions:
  contents: write
jobs:
  attack:
    runs-on: ubuntu-latest
    steps:
      - uses: ${uses}
`;
    for (const uses of ['attacker/arbitrary-action@main', 'docker://alpine:latest']) {
      expect(
        validate([
          ...baseArtifacts.filter((artifact) => !artifact.path.startsWith('.github/workflows/')),
          { path: '.github/workflows/caller.yml', text: actionCaller(uses) },
        ]),
      ).toContain('Privileged workflow dependencies must use allowed immutable actions.');
    }
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => !artifact.path.startsWith('.github/workflows/')),
        {
          path: '.github/workflows/caller.yml',
          text: `${actionCaller('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')}        with:\n          persist-credentials: false\n`,
        },
      ]),
    ).toEqual([]);

    const unsafePinnedComposition = `
name: Unsafe pinned composition
on:
  pull_request_target:
permissions:
  contents: write
jobs:
  attack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          ref: ${GITHUB_EXPRESSION_PREFIX}{{ github.event.pull_request.head.sha }}
          persist-credentials: false
      - uses: github/codeql-action/autobuild@5595ccaf912efad79be6eef63a5619ff05969be3
`;
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => !artifact.path.startsWith('.github/workflows/')),
        { path: '.github/workflows/caller.yml', text: unsafePinnedComposition },
      ]),
    ).toContain('Privileged workflow dependencies must use allowed immutable actions.');

    const secretRun = `
name: Secret-bearing run
on:
  workflow_dispatch:
permissions:
  contents: read
env:
  API_TOKEN: ${GITHUB_EXPRESSION_PREFIX}{{ secrets.API_TOKEN }}
jobs:
  attack:
    environment: production
    runs-on: ubuntu-latest
    steps:
      - run: bun apps/web/src/unprotected-helper.ts
`;
    for (const privilegedRun of [
      secretRun.replace('    environment: production\n', ''),
      secretRun.replace(
        `env:\n  API_TOKEN: ${GITHUB_EXPRESSION_PREFIX}{{ secrets.API_TOKEN }}\n`,
        '',
      ),
    ])
      expect(
        validate([
          ...baseArtifacts.filter((artifact) => !artifact.path.startsWith('.github/workflows/')),
          { path: '.github/workflows/caller.yml', text: privilegedRun },
        ]),
      ).toContain('Privileged workflows cannot execute unprotected repository commands.');

    const inheritedSecretCaller = `
name: Secret caller
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  attack:
    uses: ./.github/workflows/helper.yml
    secrets: inherit
`;
    const readOnlyHelper = helper.replace(
      'on:\n  workflow_call:',
      'on:\n  workflow_call:\npermissions:\n  contents: read',
    );
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => !artifact.path.startsWith('.github/workflows/')),
        { path: '.github/workflows/caller.yml', text: inheritedSecretCaller },
        { path: '.github/workflows/helper.yml', text: readOnlyHelper },
      ]),
    ).toContain('Privileged workflows cannot execute unprotected repository commands.');

    for (const external of [
      'attacker/workflows/.github/workflows/helper.yml@main',
      'attacker/workflows/.github/workflows/helper.yml@0123456789abcdef0123456789abcdef01234567',
    ])
      expect(
        validate([
          ...baseArtifacts.filter((artifact) => artifact.path !== '.github/workflows/caller.yml'),
          {
            path: '.github/workflows/caller.yml',
            text: caller.replace('./.github/workflows/helper.yml', external),
          },
        ]),
      ).toContain('Reusable workflow dependency graph is invalid.');

    const cycle = caller.replace('helper.yml', 'caller.yml');
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => artifact.path !== '.github/workflows/caller.yml'),
        { path: '.github/workflows/caller.yml', text: cycle },
      ]),
    ).toContain('Reusable workflow dependency graph is invalid.');
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => artifact.path !== '.github/workflows/helper.yml'),
      ]),
    ).toContain('Reusable workflow dependency graph is invalid.');

    const localActionCaller = `
name: Privileged local action caller
on:
  pull_request_target:
permissions:
  contents: write
jobs:
  attack:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/approved
`;
    const localAction = `
name: Approved action
runs:
  using: composite
  steps:
    - uses: attacker/arbitrary-action@main
`;
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => !artifact.path.startsWith('.github/workflows/')),
        { path: '.github/workflows/caller.yml', text: localActionCaller },
        { path: '.github/actions/approved/action.yml', text: localAction },
      ]),
    ).toContain('Privileged workflow dependencies must use allowed immutable actions.');
    const unsafeLocalAction = `
name: Unsafe approved action composition
runs:
  using: composite
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      with:
        ref: ${GITHUB_EXPRESSION_PREFIX}{{ github.event.pull_request.head.sha }}
        persist-credentials: false
    - uses: github/codeql-action/autobuild@5595ccaf912efad79be6eef63a5619ff05969be3
`;
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => !artifact.path.startsWith('.github/workflows/')),
        { path: '.github/workflows/caller.yml', text: localActionCaller },
        { path: '.github/actions/approved/action.yml', text: unsafeLocalAction },
      ]),
    ).toContain('Privileged workflow dependencies must use allowed immutable actions.');
    expect(
      validate([
        ...baseArtifacts.filter((artifact) => !artifact.path.startsWith('.github/workflows/')),
        { path: '.github/workflows/caller.yml', text: localActionCaller },
        {
          path: '.github/actions/approved/action.yml',
          text: localAction.replace('attacker/arbitrary-action@main', './.github/actions/approved'),
        },
      ]),
    ).toContain('Repository-local action execution must stay inside protected dependencies.');

    const containerHelper = `
name: Reusable container helper
on:
  workflow_call:
permissions:
  contents: read
jobs:
  attack:
    runs-on: ubuntu-latest
    container: attacker/image:latest
    steps: []
`;
    expect(
      validate(
        baseArtifacts.map((artifact) =>
          artifact.path === '.github/workflows/helper.yml'
            ? { ...artifact, text: containerHelper }
            : artifact,
        ),
      ),
    ).toContain('Privileged workflows cannot execute unprotected repository commands.');

    const directory = await mkdtemp(join(tmpdir(), 'orbit-readiness-workflow-'));
    try {
      await mkdir(join(directory, '.github/workflows'), { recursive: true });
      await mkdir(join(directory, 'scripts'), { recursive: true });
      await writeFile(join(directory, '.github/workflows/caller.yml'), caller);
      await writeFile(join(directory, '.github/workflows/helper.yml'), helper);
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ scripts: { prepare: 'lefthook install || true' } }),
      );
      await writeFile(join(directory, 'scripts/check-readiness-scope-pr.ts'), '');
      await writeFile(
        join(directory, 'scripts/tsconfig.json'),
        JSON.stringify({ extends: '../apps/web/tsconfig.json' }),
      );
      await writeFile(
        join(directory, 'tsconfig.base.json'),
        JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' } }),
      );
      await writeFile(join(directory, '.env.local'), 'NODE_OPTIONS=--require=./attack.js\n');
      await writeFile(join(directory, '.npmrc'), 'registry=https://example.test\n');
      const git = (args: readonly string[]) =>
        spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
      expect(git(['init']).status).toBe(0);
      expect(git(['config', 'user.email', 'fixture@example.test']).status).toBe(0);
      expect(git(['config', 'user.name', 'Fixture']).status).toBe(0);
      expect(git(['add', '.']).status).toBe(0);
      expect(git(['commit', '-m', 'fixture']).status).toBe(0);
      const head = git(['rev-parse', 'HEAD']);
      expect(head.status).toBe(0);
      const errors = (commitValidator as (root: string, commit: string) => string[])(
        directory,
        head.stdout.trim(),
      );
      expect(errors).toContain(
        'Privileged workflows cannot execute unprotected repository commands.',
      );
      expect(errors).toContain('Root package manager configuration must remain absent.');
      expect(errors).toContain('Tracked runtime environment configuration must remain absent.');
      expect(errors).toContain('Trusted TypeScript resolver configuration is invalid.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
