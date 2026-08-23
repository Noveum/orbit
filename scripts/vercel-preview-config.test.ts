import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LABELS } from './labels.ts';

const ROOT = join(import.meta.dir, '..');
const WORKFLOW_PATH = join(ROOT, '.github/workflows/vercel-preview.yml');
const CI_PATH = join(ROOT, '.github/workflows/ci.yml');
const VERCEL_PATH = join(ROOT, 'apps/web/vercel.json');
const GUIDE_PATH = join(ROOT, 'docs/VERCEL_BUILD_GATE.md');
const legacySettingNames = [
  ['BUILD', 'GATE', 'GITHUB', 'TOKEN'].join('_'),
  ['BUILD', 'GATE', 'WATCH', 'PATHS'].join('_'),
  ['BUILD', 'GATE', 'READY', 'LABEL'].join('_'),
  ['BUILD', 'GATE', 'BLOCK', 'LABEL'].join('_'),
];

type VercelConfiguration = {
  readonly git?: {
    readonly deploymentEnabled?: Readonly<Record<string, boolean>>;
  };
};

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function capture(text: string, expression: RegExp): string {
  return expression.exec(text)?.[1] ?? '';
}

const workflow = readIfPresent(WORKFLOW_PATH);
const ci = readFileSync(CI_PATH, 'utf8');
const guide = readFileSync(GUIDE_PATH, 'utf8');
const vercel = JSON.parse(readFileSync(VERCEL_PATH, 'utf8')) as VercelConfiguration;
const oldGatePaths = [
  join(ROOT, 'scripts/vercel-build-gate.sh'),
  join(ROOT, 'scripts/vercel-build-gate.test.ts'),
];
const allGateFiles = [
  WORKFLOW_PATH,
  CI_PATH,
  VERCEL_PATH,
  join(ROOT, 'scripts/labels.ts'),
  ...oldGatePaths,
]
  .map(readIfPresent)
  .join('\n');

const LEGACY_EXPECTED_HEADER = `name: Vercel Preview

on:
  pull_request_target:
    branches: [main]
    types: [opened, reopened, synchronize, ready_for_review, converted_to_draft, labeled, unlabeled, closed]
  workflow_run:
    workflows: [CI]
    types: [completed]
  repository_dispatch:
    types: [vercel-preview-reconcile]

permissions:
  actions: read
  contents: read
  pull-requests: read

concurrency:
  group: vercel-preview-\${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.event.client_payload.pull_request || github.event.workflow_run.head_sha || github.run_id }}
  cancel-in-progress: false
`;

const EXPECTED_WORKFLOW = `${LEGACY_EXPECTED_HEADER}
jobs:
  reconcile:
    if: >-
      github.event_name == 'pull_request_target' ||
      github.event_name == 'repository_dispatch' ||
      (github.event_name == 'workflow_run' &&
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.conclusion == 'success')
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Check out trusted controller
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          repository: \${{ github.repository }}
          ref: \${{ github.sha }}
          persist-credentials: false
          submodules: false
          lfs: false
      - name: Set up Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6
        with:
          bun-version: "1.3.14"
      - name: Install trusted controller dependencies
        run: bun install --frozen-lockfile --ignore-scripts
      - name: Reconcile Vercel Preview
        run: bun scripts/vercel-preview-deploy.ts
        env:
          GITHUB_TOKEN: \${{ github.token }}
          VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}
          VERCEL_TEAM_ID: \${{ vars.VERCEL_TEAM_ID }}
          VERCEL_PROJECT_ID: \${{ vars.VERCEL_PROJECT_ID }}
          VERCEL_PROJECT_NAME: \${{ vars.VERCEL_PROJECT_NAME }}
`;

function partialWorkflowContractAccepts(candidate: string): boolean {
  const job = capture(candidate, /\njobs:\n {2}reconcile:\n([\s\S]*)$/);
  const steps = capture(candidate, /\n {4}steps:\n([\s\S]*)$/);
  const guard =
    /^ {4}if: >-\n {6}github\.event_name == 'pull_request_target' \|\|\n {6}github\.event_name == 'repository_dispatch' \|\|\n {6}\(github\.event_name == 'workflow_run' &&\n {6}github\.event\.workflow_run\.event == 'pull_request' &&\n {6}github\.event\.workflow_run\.conclusion == 'success'\)\n {4}runs-on: ubuntu-latest\n {4}timeout-minutes: 25\n/;
  const uses = steps.match(/^\s*uses: .+$/gm);
  const runs = steps.match(/^\s*run: .+$/gm);
  const tokenExpression = ['VERCEL_TOKEN: $', '{{ secrets.VERCEL_TOKEN }}'].join('');
  return (
    candidate.startsWith(LEGACY_EXPECTED_HEADER) &&
    !candidate.includes('workflow_dispatch') &&
    guard.test(job) &&
    steps.includes('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1') &&
    steps.includes('uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6') &&
    steps.includes('run: bun install --frozen-lockfile --ignore-scripts') &&
    JSON.stringify(uses) ===
      JSON.stringify([
        '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        '        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
      ]) &&
    JSON.stringify(runs) ===
      JSON.stringify([
        '        run: bun install --frozen-lockfile --ignore-scripts',
        '        run: bun scripts/vercel-preview-deploy.ts',
      ]) &&
    steps.includes(tokenExpression) &&
    candidate.match(/VERCEL_TOKEN/g)?.length === 2
  );
}

function trustedWorkflowContractAccepts(candidate: string): boolean {
  return candidate === EXPECTED_WORKFLOW;
}

const projectNameExpression = [
  '          VERCEL_PROJECT_NAME: $',
  '{{ vars.VERCEL_PROJECT_NAME }}',
].join('');

const legacyAcceptedUnsafeVariants = [
  [
    'job-level write permissions',
    workflow.replace(
      '    timeout-minutes: 25\n    steps:',
      '    timeout-minutes: 25\n    permissions:\n      contents: write\n    steps:',
    ),
  ],
  [
    'workflow run defaults',
    workflow.replace(
      '  cancel-in-progress: false\n\njobs:',
      '  cancel-in-progress: false\n\ndefaults:\n  run:\n    shell: bash -e {0}\n\njobs:',
    ),
  ],
  [
    'job run defaults',
    workflow.replace(
      '    timeout-minutes: 25\n    steps:',
      '    timeout-minutes: 25\n    defaults:\n      run:\n        shell: bash -e {0}\n    steps:',
    ),
  ],
  [
    'install step shell override',
    workflow.replace(
      '        run: bun install --frozen-lockfile --ignore-scripts',
      '        run: bun install --frozen-lockfile --ignore-scripts\n        shell: bash -e {0}',
    ),
  ],
  [
    'controller step shell override',
    workflow.replace(projectNameExpression, `${projectNameExpression}\n        shell: bash -e {0}`),
  ],
  [
    'continued install command',
    workflow.replace(
      '        run: bun install --frozen-lockfile --ignore-scripts',
      '        run: bun install --frozen-lockfile --ignore-scripts\n          && bun scripts/vercel-preview-deploy.ts',
    ),
  ],
] as const;

const continuedControllerWorkflow = workflow.replace(
  '        run: bun scripts/vercel-preview-deploy.ts\n        env:',
  '        run: bun scripts/vercel-preview-deploy.ts\n          && bun scripts/another.ts\n        env:',
);

describe('Vercel Preview repository configuration', () => {
  test('configures automatic Git deployments only for main without an ignore command', () => {
    expect(vercel.git?.deploymentEnabled).toEqual({ '**': false, main: true });
    expect(Object.keys(vercel.git?.deploymentEnabled ?? {})).toEqual(['**', 'main']);
    expect(vercel).not.toHaveProperty('ignoreCommand');
  });

  test('defines each managed Preview label exactly once with executable semantics', () => {
    expect(LABELS.filter(({ name }) => name === 'preview')).toHaveLength(1);
    expect(LABELS.filter(({ name }) => name === 'no-preview')).toHaveLength(1);
    expect(LABELS.find(({ name }) => name === 'preview')?.description).toBe(
      'Enables a Preview for an otherwise eligible draft after CI succeeds',
    );
    expect(LABELS.find(({ name }) => name === 'no-preview')?.description).toBe(
      'Suppresses Preview creation and cancels active Preview work',
    );
  });

  test('removes the old build gate and its Vercel settings', () => {
    expect(oldGatePaths.every((path) => !existsSync(path))).toBe(true);
    for (const legacySettingName of legacySettingNames) {
      expect(allGateFiles).not.toContain(legacySettingName);
    }
  });

  test('uses only the exact trusted triggers, permissions, and serialized concurrency', () => {
    expect(workflow.startsWith(LEGACY_EXPECTED_HEADER)).toBe(true);
    expect(workflow).not.toContain('workflow_dispatch');
  });

  test('matches the complete trusted workflow and effective reconcile job', () => {
    expect(trustedWorkflowContractAccepts(workflow)).toBe(true);
  });

  test('guards successful pull request CI while allowing state and recovery events', () => {
    const job = capture(workflow, /\njobs:\n {2}reconcile:\n([\s\S]*)$/);
    expect(job).toMatch(
      /^ {4}if: >-\n {6}github\.event_name == 'pull_request_target' \|\|\n {6}github\.event_name == 'repository_dispatch' \|\|\n {6}\(github\.event_name == 'workflow_run' &&\n {6}github\.event\.workflow_run\.event == 'pull_request' &&\n {6}github\.event\.workflow_run\.conclusion == 'success'\)\n {4}runs-on: ubuntu-latest\n {4}timeout-minutes: 25\n/,
    );
  });

  test('checks out and installs only trusted default-branch code with immutable actions', () => {
    const steps = capture(workflow, /\n {4}steps:\n([\s\S]*)$/);
    expect(steps).toContain(
      `      - name: Check out trusted controller
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          repository: \${{ github.repository }}
          ref: \${{ github.sha }}
          persist-credentials: false
          submodules: false
          lfs: false`,
    );
    expect(steps).toContain(
      `      - name: Set up Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6
        with:
          bun-version: "1.3.14"`,
    );
    expect(steps).toContain(
      `      - name: Install trusted controller dependencies
        run: bun install --frozen-lockfile --ignore-scripts`,
    );
    expect(steps.match(/^\s*uses: .+$/gm)).toEqual([
      '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      '        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
    ]);
    expect(steps).not.toMatch(/actions\/cache|download-artifact|pull_request\.head|head_ref/);
  });

  test('runs only dependency installation and the approved controller with scoped credentials', () => {
    const steps = capture(workflow, /\n {4}steps:\n([\s\S]*)$/);
    expect(steps.match(/^\s*run: .+$/gm)).toEqual([
      '        run: bun install --frozen-lockfile --ignore-scripts',
      '        run: bun scripts/vercel-preview-deploy.ts',
    ]);
    expect(steps).toContain(
      `      - name: Reconcile Vercel Preview
        run: bun scripts/vercel-preview-deploy.ts
        env:
          GITHUB_TOKEN: \${{ github.token }}
          VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}
          VERCEL_TEAM_ID: \${{ vars.VERCEL_TEAM_ID }}
          VERCEL_PROJECT_ID: \${{ vars.VERCEL_PROJECT_ID }}
          VERCEL_PROJECT_NAME: \${{ vars.VERCEL_PROJECT_NAME }}`,
    );
    expect(workflow.match(/VERCEL_TOKEN/g)).toHaveLength(2);
  });

  test('keeps source policies inside the static CI job used as deployment proof', () => {
    const staticJob = capture(ci, /\n {2}static:\n([\s\S]*?)\n {2}test:\n/);
    expect(staticJob).toContain(
      '      - name: Source byte policy\n        run: bun run check-bytes',
    );
    expect(staticJob).toContain(
      '      - name: No Bun built-ins in shipped server code\n        run: bun run check-bun-imports',
    );
  });

  test('documents the Preview build security boundary and safe recovery event', () => {
    const prose = guide.replace(/\s+/g, ' ');
    expect(prose).toContain(
      'The API-created Vercel Preview still builds same-repository pull request code with the project Preview environment scope.',
    );
    expect(guide).toContain('repository_dispatch');
    expect(guide).toContain('vercel-preview-reconcile');
    expect(guide).toContain('client_payload.pull_request');
    expect(guide).toContain('workflow_dispatch');
  });

  test.each(legacyAcceptedUnsafeVariants)(
    'rejects %s even when the partial workflow assertions accept it',
    (_name, unsafeWorkflow) => {
      expect(partialWorkflowContractAccepts(unsafeWorkflow)).toBe(true);
      expect(trustedWorkflowContractAccepts(unsafeWorkflow)).toBe(false);
    },
  );

  test('rejects a continued token-bearing controller command', () => {
    expect(trustedWorkflowContractAccepts(continuedControllerWorkflow)).toBe(false);
  });
});
