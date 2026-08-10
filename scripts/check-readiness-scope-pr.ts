import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import ts from 'typescript';
import {
  githubAssociatedPullsResponseSchema,
  githubCommitStatusesResponseSchema,
  githubPullResponseSchema,
  githubReviewResponseSchema,
  githubWorkflowAttemptSchema,
  githubWorkflowIdentitySchema,
  pullRequestTargetEventSchema,
  readinessReferenceRegistrySourceSchema,
  readinessScopeAuditSchema,
  readinessScopeManifestSchema,
  readinessScopePrInputSchema,
} from '../packages/shared/src/validators/readiness.ts';
import {
  currentUtcDate,
  type FindingRow,
  parseExceptionRows,
  parseFindingRows,
  parsePlanFindings,
  readinessEvidenceTargets,
  readinessGovernanceFingerprint,
  validateReadinessLedger,
  validateReadinessScopeArtifacts,
} from './check-readiness-ledger.ts';
import {
  createProductionReadinessEvidenceVerifier,
  githubWorkflowDefinitionDigest,
} from './readiness-evidence-verifier.ts';
import {
  parseTrustedRawGitDiff,
  readTrustedGitArtifact,
  readTrustedGitChangedFiles,
} from './readiness-git-artifact.ts';
import {
  buildReadinessReferenceRegistry,
  type ClosureEvidenceRecord,
  type ReadinessReferenceRegistrySource,
} from './readiness-reference-registry.ts';
import type { ReadinessScopeManifest } from './readiness-scope-manifest.ts';

const ALLOWED_SCOPE_FILES = [
  'docs/maintainers/readiness-ledger.md',
  'docs/maintainers/readiness-scope-audit.json',
  'docs/superpowers/plans/2026-08-09-open-source-readiness.md',
  'scripts/readiness-scope-manifest.json',
] as const;
const REGISTRY_DATA_FILE = 'scripts/readiness-reference-registry.json';
const CLOSURE_TRANSITION_FILES = [ALLOWED_SCOPE_FILES[0], REGISTRY_DATA_FILE] as const;
const SCOPE_CHANGE_FILES_WITH_REGISTRY = [...ALLOWED_SCOPE_FILES, REGISTRY_DATA_FILE] as const;
const REQUIRED_APPROVERS = ['imshashank', 'pulkitxm'] as const;
const OPINIONATED_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);
const TRUST_ROOT_FILES = new Set([
  '.github/CODEOWNERS',
  '.github/workflows/ci.yml',
  '.github/workflows/readiness-scope.yml',
  'bun.lock',
  'package.json',
  'packages/shared/src/validators/readiness.ts',
  'scripts/check-readiness-ledger.ts',
  'scripts/check-readiness-scope-pr.ts',
  'scripts/readiness-evidence-verifier.ts',
  'scripts/readiness-git-artifact.ts',
  'scripts/readiness-reference-registry.ts',
  'scripts/readiness-scope-manifest.ts',
  'tsconfig.base.json',
  'tsconfig.json',
]);
const TRUST_POLICY_COMPANION_FILES = new Set([
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/maintainers/readiness-scope-governance.md',
  'packages/db/tests/check-readiness-ledger.test.ts',
  'packages/db/tests/check-readiness-scope-pr.test.ts',
  'packages/db/tests/readiness-production-artifacts.test.ts',
]);
export const TRUSTED_READINESS_WORKFLOW_DEFINITION_DIGEST =
  'sha256:bbe370f0610b279ad230dc22a6a4819ab9380e7ca88fa4e10bd75785406c24be';

export type ReadinessScopePrInput = typeof readinessScopePrInputSchema._output;

interface GovernedJson {
  readonly canonical: boolean;
  readonly duplicateKeys: boolean;
  readonly value: unknown;
}

function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function jsonStringEnd(value: string, start: number): number | undefined {
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') return index;
  }
  return undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: JSON duplicate-key scanning requires explicit nested parser state.
function duplicateJsonKeys(value: string): boolean {
  const stack: Array<
    { readonly kind: 'array' } | { readonly keys: Set<string>; kind: 'object'; expectsKey: boolean }
  > = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '"') {
      const end = jsonStringEnd(value, index);
      if (end === undefined) return false;
      const current = stack.at(-1);
      if (current?.kind === 'object' && current.expectsKey) {
        const key = JSON.parse(value.slice(index, end + 1)) as string;
        if (current.keys.has(key)) return true;
        current.keys.add(key);
        current.expectsKey = false;
      }
      index = end;
      continue;
    }
    if (character === '{') {
      stack.push({ kind: 'object', keys: new Set(), expectsKey: true });
      continue;
    }
    if (character === '[') {
      stack.push({ kind: 'array' });
      continue;
    }
    if (character === '}' || character === ']') {
      stack.pop();
      continue;
    }
    if (character === ',') {
      const current = stack.at(-1);
      if (current?.kind === 'object') current.expectsKey = true;
    }
  }
  return false;
}

function governedJson(value: string): GovernedJson {
  const parsed = parsedJson(value);
  if (parsed === undefined) return { value: undefined, duplicateKeys: false, canonical: false };
  const duplicateKeys = duplicateJsonKeys(value);
  return {
    value: parsed,
    duplicateKeys,
    canonical: !duplicateKeys && value === `${JSON.stringify(parsed, null, 2)}\n`,
  };
}

function canonicalReviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      (/^\/Noveum\/orbit\/(?:pull|issues|discussions)\/[1-9]\d*$/.test(url.pathname) ||
        /^\/Noveum\/orbit\/commit\/[a-f0-9]{40}$/.test(url.pathname))
    );
  } catch {
    return false;
  }
}

function meaningfulRationale(value: string): boolean {
  const words = value.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 5 && words.join('').length >= 24;
}

function semanticSignature(manifest: ReadinessScopeManifest): string {
  return JSON.stringify(
    [...manifest.findings].sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function manifestRevision(
  value: string,
): { readonly date: string; readonly revision: number } | undefined {
  const match = /^readiness-scope\/(\d{4}-\d{2}-\d{2})-v([1-9]\d*)$/.exec(value);
  if (match === null) return undefined;
  return { date: match[1] ?? '', revision: Number(match[2]) };
}

function exactVersionIncrement(base: string, head: string): boolean {
  const baseRevision = manifestRevision(base);
  const headRevision = manifestRevision(head);
  return (
    baseRevision !== undefined &&
    headRevision !== undefined &&
    headRevision.date >= baseRevision.date &&
    headRevision.revision === baseRevision.revision + 1
  );
}

function changedFindingIds(base: ReadinessScopeManifest, head: ReadinessScopeManifest): string[] {
  const baseById = new Map(base.findings.map((finding) => [finding.id, finding]));
  const headById = new Map(head.findings.map((finding) => [finding.id, finding]));
  const ids = new Set([...baseById.keys(), ...headById.keys()]);
  return [...ids]
    .filter((id) => JSON.stringify(baseById.get(id)) !== JSON.stringify(headById.get(id)))
    .sort();
}

function openScopeRow(row: FindingRow): boolean {
  const pending = [
    row.implementation,
    row.change,
    row.releaseGate,
    row.documentation,
    row.decision,
    row.approver,
  ].every((value) => value === 'pending:open');
  const authority =
    row.securityRequired === 'Yes'
      ? row.authority === 'pending:open'
      : row.securityRequired === 'No' && row.authority === 'not-required';
  return row.status === 'Open' && pending && authority;
}

function findingState(row: FindingRow): string {
  return JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'row')));
}

function planFindingState(row: ReturnType<typeof parsePlanFindings>[number]): string {
  return JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'row')));
}

function exceptionState(row: ReturnType<typeof parseExceptionRows>[number]): string {
  return JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'row')));
}

function changedLifecycleIds(
  baseFindings: readonly FindingRow[],
  headFindings: readonly FindingRow[],
  baseExceptions: ReturnType<typeof parseExceptionRows>,
  headExceptions: ReturnType<typeof parseExceptionRows>,
): Set<string> {
  const baseFindingState = new Map(baseFindings.map((row) => [row.id, findingState(row)]));
  const headFindingState = new Map(headFindings.map((row) => [row.id, findingState(row)]));
  const baseExceptionState = new Map(
    baseExceptions.map((row) => [row.findingId, exceptionState(row)]),
  );
  const headExceptionState = new Map(
    headExceptions.map((row) => [row.findingId, exceptionState(row)]),
  );
  const ids = new Set([
    ...baseFindingState.keys(),
    ...headFindingState.keys(),
    ...baseExceptionState.keys(),
    ...headExceptionState.keys(),
  ]);
  return new Set(
    [...ids].filter(
      (id) =>
        baseFindingState.get(id) !== headFindingState.get(id) ||
        baseExceptionState.get(id) !== headExceptionState.get(id),
    ),
  );
}

function sealedStateChanged(
  baseFindings: readonly FindingRow[],
  headFindings: readonly FindingRow[],
  baseExceptions: ReturnType<typeof parseExceptionRows>,
  headExceptions: ReturnType<typeof parseExceptionRows>,
): boolean {
  const sealed = new Set(['Closed', 'Accepted P1 exception']);
  const headById = new Map(headFindings.map((row) => [row.id, row]));
  const baseExceptionState = new Map(
    baseExceptions.map((row) => [row.findingId, exceptionState(row)]),
  );
  const headExceptionState = new Map(
    headExceptions.map((row) => [row.findingId, exceptionState(row)]),
  );
  return baseFindings.some((baseRow) => {
    if (!sealed.has(baseRow.status)) return false;
    const headRow = headById.get(baseRow.id);
    if (headRow === undefined || findingState(baseRow) !== findingState(headRow)) return true;
    return (
      baseRow.status === 'Accepted P1 exception' &&
      baseExceptionState.get(baseRow.id) !== headExceptionState.get(baseRow.id)
    );
  });
}

function registrySource(value: unknown): ReadinessReferenceRegistrySource | undefined {
  const result = readinessReferenceRegistrySourceSchema.safeParse(value);
  if (!result.success) return undefined;
  const source = result.data as unknown as ReadinessReferenceRegistrySource;
  return 'registry' in buildReadinessReferenceRegistry(source) ? source : undefined;
}

function entryPrefixUnchanged(
  base: ReadinessReferenceRegistrySource,
  head: ReadinessReferenceRegistrySource,
): boolean {
  return (
    base.recordEntries.length <= head.recordEntries.length &&
    base.principalEntries.length <= head.principalEntries.length &&
    base.recordEntries.every(
      (entry, index) => JSON.stringify(entry) === JSON.stringify(head.recordEntries[index]),
    ) &&
    base.principalEntries.every(
      (entry, index) => JSON.stringify(entry) === JSON.stringify(head.principalEntries[index]),
    )
  );
}

function readinessReferences(value: unknown): readonly string[] {
  return JSON.stringify(value).match(/(?:record|principal):[a-z0-9][a-z0-9._/-]*/g) ?? [];
}

function accountedRegistryKeys(
  lifecycleIds: ReadonlySet<string>,
  sealIds: ReadonlySet<string>,
  headFindings: readonly FindingRow[],
  headExceptions: ReturnType<typeof parseExceptionRows>,
  head: ReadinessReferenceRegistrySource,
): Set<string> {
  const references = new Set<string>();
  for (const row of headFindings) {
    if (!lifecycleIds.has(row.id)) continue;
    for (const reference of readinessReferences(row)) references.add(reference);
  }
  for (const row of headExceptions) {
    if (!lifecycleIds.has(row.findingId)) continue;
    for (const reference of readinessReferences(row)) references.add(reference);
  }
  for (const [key, record] of head.recordEntries) {
    if (record.kind === 'closure' && sealIds.has(record.findingId)) references.add(key);
  }
  const principals = new Map(head.principalEntries);
  const queue = [...references];
  for (const key of queue) {
    const principal = principals.get(key);
    if (principal?.kind !== 'human-alias' || references.has(principal.canonicalPrincipal)) continue;
    references.add(principal.canonicalPrincipal);
    queue.push(principal.canonicalPrincipal);
  }
  return references;
}

function scopeChangeRegistryErrors(
  changedIds: ReadonlySet<string>,
  headFindings: readonly FindingRow[],
  base: ReadinessReferenceRegistrySource,
  head: ReadinessReferenceRegistrySource,
): string[] {
  const references = new Set<string>();
  for (const row of headFindings) {
    if (!changedIds.has(row.id)) continue;
    for (const reference of readinessReferences(row.residualRisk)) references.add(reference);
  }
  const addedRecords = head.recordEntries.slice(base.recordEntries.length);
  const valid =
    addedRecords.length > 0 &&
    head.principalEntries.length === base.principalEntries.length &&
    addedRecords.every(([key, record]) => record.kind === 'audit-risk' && references.has(key));
  return valid
    ? []
    : [
        'Scope-change registry additions must be audit-risk records reachable from changed findings.',
      ];
}

function registryLifecycleErrors(
  input: ReadinessScopePrInput,
  baseFindings: readonly FindingRow[],
  headFindings: readonly FindingRow[],
  baseExceptions: ReturnType<typeof parseExceptionRows>,
  headExceptions: ReturnType<typeof parseExceptionRows>,
  baseRegistryValue: unknown,
  headRegistryValue: unknown,
  scopeChangeIds: ReadonlySet<string> | undefined,
): string[] {
  if (input.base.registry === input.head.registry) return [];
  const errors: string[] = [];
  const lifecycleIds = changedLifecycleIds(
    baseFindings,
    headFindings,
    baseExceptions,
    headExceptions,
  );
  const base = registrySource(baseRegistryValue);
  const head = registrySource(headRegistryValue);
  if (base === undefined || head === undefined)
    return [...errors, 'Registry transition data is invalid.'];
  if (!entryPrefixUnchanged(base, head)) errors.push('Existing registry entries are immutable.');
  if (scopeChangeIds !== undefined) {
    errors.push(...scopeChangeRegistryErrors(scopeChangeIds, headFindings, base, head));
    return errors;
  }
  if (lifecycleIds.size === 0 || !exactChangedFiles(input.changedFiles, CLOSURE_TRANSITION_FILES))
    errors.push('Registry changes require an accounted ledger lifecycle transition.');
  const addedKeys = [
    ...head.recordEntries.slice(base.recordEntries.length).map(([key]) => key),
    ...head.principalEntries.slice(base.principalEntries.length).map(([key]) => key),
  ];
  const accounted = accountedRegistryKeys(
    lifecycleIds,
    new Set(sealTransitionIds(baseFindings, headFindings)),
    headFindings,
    headExceptions,
    head,
  );
  if (addedKeys.some((key) => !accounted.has(key)))
    errors.push('Registry changes contain entries outside the changed lifecycle state.');
  return errors;
}

function invalidSealTransition(base: readonly FindingRow[], head: readonly FindingRow[]): boolean {
  const sealed = new Set(['Closed', 'Accepted P1 exception']);
  const baseById = new Map(base.map((row) => [row.id, row]));
  return head.some((row) => {
    const baseRow = baseById.get(row.id);
    return (
      sealed.has(row.status) &&
      baseRow?.status !== row.status &&
      baseRow?.status !== 'Ready for closure'
    );
  });
}

function closureTransition(base: readonly FindingRow[], head: readonly FindingRow[]): boolean {
  const terminal = new Set(['Ready for closure', 'Closed', 'Accepted P1 exception']);
  const baseById = new Map(base.map((row) => [row.id, row]));
  const headById = new Map(head.map((row) => [row.id, row]));
  const ids = new Set([...baseById.keys(), ...headById.keys()]);
  return [...ids].some((id) => {
    const baseRow = baseById.get(id);
    const headRow = headById.get(id);
    if (baseRow === undefined || headRow === undefined) return false;
    return (
      findingState(baseRow) !== findingState(headRow) &&
      (terminal.has(baseRow.status) || terminal.has(headRow.status))
    );
  });
}

function exactChangedFiles(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    [...actual].sort().every((file, index) => file === sortedExpected[index])
  );
}

function hasExactApprovals(input: ReadinessScopePrInput): boolean {
  const latest = new Map<string, ReadinessScopePrInput['reviews'][number]>();
  for (const review of input.reviews) {
    const login = review.login.toLowerCase();
    if (!OPINIONATED_STATES.has(review.state)) continue;
    const existing = latest.get(login);
    if (existing === undefined || review.submittedAt >= existing.submittedAt)
      latest.set(login, review);
  }
  return REQUIRED_APPROVERS.every((login) => {
    const review = latest.get(login);
    return review?.state === 'APPROVED' && review.commitId === input.headSha;
  });
}

function repositoryScriptPath(path: string): boolean {
  return (
    (path.startsWith('scripts/') || path.includes('/scripts/')) &&
    path !== REGISTRY_DATA_FILE &&
    path !== ALLOWED_SCOPE_FILES[3]
  );
}

function forbiddenRootEnvironmentPath(path: string): boolean {
  return !path.includes('/') && path.startsWith('.env') && path !== '.env.example';
}

function trustRootPath(path: string): boolean {
  return (
    TRUST_ROOT_FILES.has(path) ||
    repositoryScriptPath(path) ||
    path.startsWith('.github/workflows/') ||
    path.startsWith('.github/actions/') ||
    path.endsWith('/package.json') ||
    path === '.npmrc' ||
    forbiddenRootEnvironmentPath(path) ||
    path === 'bunfig.toml' ||
    path.endsWith('/bunfig.toml')
  );
}

interface TrustRootExecutionArtifact {
  readonly path: string;
  readonly text: string;
}

const PACKAGE_LIFECYCLE_SCRIPTS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'publish',
  'postpublish',
  'preversion',
  'version',
  'postversion',
  'dependencies',
]);

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function writePermission(value: unknown): boolean {
  if (value === 'write-all') return true;
  const permissions = objectRecord(value);
  return (
    permissions !== undefined &&
    Object.values(permissions).some((permission) => permission === 'write')
  );
}

function pullRequestTargetTrigger(value: unknown): boolean {
  if (value === 'pull_request_target') return true;
  if (Array.isArray(value)) return value.includes('pull_request_target');
  return objectRecord(value)?.['pull_request_target'] !== undefined;
}

interface ActionInvocation {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly uses: string;
}

interface WorkflowDefinition {
  readonly actions: readonly ActionInvocation[];
  readonly privileged: boolean;
  readonly runs: readonly string[];
  readonly unprotectedExecutableSurface: boolean;
  readonly workflowUses: readonly string[];
}

const GITHUB_EXPRESSION_PREFIX = '$';
const EXPECTED_READINESS_WORKFLOW = {
  name: 'Readiness scope policy',
  on: {
    pull_request_target: {
      branches: ['main'],
      types: ['opened', 'synchronize', 'reopened', 'ready_for_review'],
    },
    pull_request_review: {
      branches: ['main'],
      types: ['submitted', 'edited', 'dismissed'],
    },
  },
  permissions: {
    actions: 'read',
    contents: 'read',
    'pull-requests': 'read',
    statuses: 'write',
  },
  concurrency: {
    group: `readiness-scope-${GITHUB_EXPRESSION_PREFIX}{{ github.event.pull_request.number }}`,
    'cancel-in-progress': true,
  },
  env: {
    BUN_VERSION: '1.3.14',
  },
  jobs: {
    policy: {
      if: "github.event_name == 'pull_request_target' || github.event.review.user.login == 'imshashank' || github.event.review.user.login == 'pulkitxm'",
      name: 'Trusted readiness scope policy',
      'runs-on': 'ubuntu-latest',
      steps: [
        {
          uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
          with: {
            ref: `${GITHUB_EXPRESSION_PREFIX}{{ github.event.pull_request.base.sha }}`,
            'fetch-depth': 0,
            'persist-credentials': false,
          },
        },
        {
          uses: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
          with: {
            'bun-version': `${GITHUB_EXPRESSION_PREFIX}{{ env.BUN_VERSION }}`,
          },
        },
        {
          run: 'bun install --frozen-lockfile --ignore-scripts',
        },
        {
          name: 'Validate fetched scope artifacts with trusted base code',
          env: {
            GITHUB_TOKEN: `${GITHUB_EXPRESSION_PREFIX}{{ github.token }}`,
          },
          run: 'bun scripts/check-readiness-scope-pr.ts',
        },
      ],
    },
  },
} as const;

function canonicalSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSemanticValue);
  const record = objectRecord(value);
  if (record === undefined) return value;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalSemanticValue(record[key])]),
  );
}

function exactReadinessWorkflow(source: string): boolean {
  if (
    `sha256:${createHash('sha256').update(source).digest('hex')}` !==
    TRUSTED_READINESS_WORKFLOW_DEFINITION_DIGEST
  )
    return false;
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(source);
  } catch {
    return false;
  }
  return (
    JSON.stringify(canonicalSemanticValue(parsed)) ===
    JSON.stringify(canonicalSemanticValue(EXPECTED_READINESS_WORKFLOW))
  );
}

function secretOrEnvironmentSurface(value: unknown): boolean {
  if (typeof value === 'string') return /\$\{\{[^}]*\bsecrets\b/i.test(value);
  if (Array.isArray(value)) return value.some(secretOrEnvironmentSurface);
  const record = objectRecord(value);
  if (record === undefined) return false;
  return Object.entries(record).some(
    ([key, nested]) =>
      key === 'environment' || key === 'secrets' || secretOrEnvironmentSurface(nested),
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Workflow parsing validates nested jobs and executable steps together.
function workflowDefinition(source: string): WorkflowDefinition | undefined {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(source);
  } catch {
    return undefined;
  }
  const workflow = objectRecord(parsed);
  const jobs = objectRecord(workflow?.['jobs']);
  if (workflow === undefined || jobs === undefined) return undefined;
  const actions: ActionInvocation[] = [];
  const workflowUses: string[] = [];
  const runs: string[] = [];
  let unprotectedExecutableSurface = false;
  let privileged =
    workflow['permissions'] === undefined ||
    pullRequestTargetTrigger(workflow['on']) ||
    writePermission(workflow['permissions']) ||
    secretOrEnvironmentSurface(workflow);
  for (const jobValue of Object.values(jobs)) {
    const job = objectRecord(jobValue);
    if (job === undefined) return undefined;
    privileged ||= writePermission(job['permissions']);
    unprotectedExecutableSurface ||=
      job['container'] !== undefined || job['services'] !== undefined;
    const workflowUse = job['uses'];
    const stepsValue = job['steps'];
    if (workflowUse !== undefined) {
      if (typeof workflowUse !== 'string' || stepsValue !== undefined) return undefined;
      workflowUses.push(workflowUse);
      continue;
    }
    if (stepsValue === undefined) continue;
    if (!Array.isArray(stepsValue)) return undefined;
    for (const stepValue of stepsValue) {
      const step = objectRecord(stepValue);
      if (step === undefined) return undefined;
      const usesValue = step['uses'];
      const runValue = step['run'];
      if ((usesValue === undefined) === (runValue === undefined)) return undefined;
      if (usesValue !== undefined) {
        if (typeof usesValue !== 'string') return undefined;
        const inputs = step['with'] === undefined ? {} : objectRecord(step['with']);
        if (inputs === undefined) return undefined;
        actions.push({ inputs, uses: usesValue });
      }
      if (runValue !== undefined) {
        if (typeof runValue !== 'string') return undefined;
        runs.push(runValue);
      }
    }
  }
  return { actions, privileged, runs, unprotectedExecutableSurface, workflowUses };
}

function protectedLocalAction(value: string): string | undefined {
  if (!value.startsWith('./')) return undefined;
  const relative = value.slice(2);
  const normalized = posix.normalize(relative);
  return relative === normalized &&
    normalized.startsWith('.github/actions/') &&
    !normalized.endsWith('/')
    ? normalized
    : '';
}

interface LocalActionDefinition {
  readonly actions: readonly ActionInvocation[];
}

const ALLOWED_PRIVILEGED_ACTION_CAPABILITIES = new Map<string, ReadonlySet<string>>([
  ['actions/checkout', new Set([''])],
  ['actions/first-interaction', new Set([''])],
  ['actions/labeler', new Set([''])],
  ['actions/stale', new Set([''])],
  ['github/codeql-action', new Set(['/analyze', '/init'])],
  ['oven-sh/setup-bun', new Set([''])],
]);
const ALLOWED_EXTERNAL_REUSABLE_WORKFLOW_REPOSITORIES = new Set<string>();

function localActionDirectory(path: string): string | undefined {
  const match = /^(\.github\/actions\/.+)\/action\.ya?ml$/.exec(path);
  return match?.[1];
}

function localActionDefinition(source: string): LocalActionDefinition | undefined {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(source);
  } catch {
    return undefined;
  }
  const action = objectRecord(parsed);
  const runs = objectRecord(action?.['runs']);
  const steps = runs?.['steps'];
  if (runs?.['using'] !== 'composite' || !Array.isArray(steps)) return undefined;
  const actions: ActionInvocation[] = [];
  for (const stepValue of steps) {
    const step = objectRecord(stepValue);
    if (step === undefined || step['run'] !== undefined || typeof step['uses'] !== 'string')
      return undefined;
    const inputs = step['with'] === undefined ? {} : objectRecord(step['with']);
    if (inputs === undefined) return undefined;
    actions.push({ inputs, uses: step['uses'] });
  }
  return { actions };
}

function localActionDefinitions(
  artifacts: readonly TrustRootExecutionArtifact[],
): ReadonlyMap<string, LocalActionDefinition> | undefined {
  const definitions = new Map<string, LocalActionDefinition>();
  for (const artifact of artifacts) {
    const directory = localActionDirectory(artifact.path);
    if (directory === undefined) continue;
    const definition = localActionDefinition(artifact.text);
    if (definition === undefined || definitions.has(directory)) return undefined;
    definitions.set(directory, definition);
  }
  return definitions;
}

function protectedLocalWorkflow(value: string): string | undefined {
  if (!value.startsWith('./')) return undefined;
  const relative = value.slice(2);
  const normalized = posix.normalize(relative);
  return relative === normalized && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized)
    ? normalized
    : '';
}

function immutableExternalReference(
  value: string,
): { readonly repository: string; readonly suffix: string } | undefined {
  const match = /^([^/@\s]+)\/([^/@\s]+)(\/[^@\s]+)?@([a-f0-9]{40})$/.exec(value);
  if (match === null) return undefined;
  return {
    repository: `${(match[1] ?? '').toLowerCase()}/${(match[2] ?? '').toLowerCase()}`,
    suffix: match[3] ?? '',
  };
}

function safePrivilegedCheckoutInputs(inputs: Readonly<Record<string, unknown>>): boolean {
  const allowed = [
    { 'persist-credentials': false },
    {
      ref: `${GITHUB_EXPRESSION_PREFIX}{{ github.event.pull_request.base.sha }}`,
      'fetch-depth': 0,
      'persist-credentials': false,
    },
  ];
  const actual = JSON.stringify(canonicalSemanticValue(inputs));
  return allowed.some((expected) => JSON.stringify(canonicalSemanticValue(expected)) === actual);
}

function allowedPrivilegedAction(invocation: ActionInvocation): boolean {
  const reference = immutableExternalReference(invocation.uses);
  if (reference === undefined || reference.suffix.startsWith('/.github/workflows/')) return false;
  if (!ALLOWED_PRIVILEGED_ACTION_CAPABILITIES.get(reference.repository)?.has(reference.suffix))
    return false;
  return (
    reference.repository !== 'actions/checkout' || safePrivilegedCheckoutInputs(invocation.inputs)
  );
}

function allowedExternalReusableWorkflow(value: string): boolean {
  const reference = immutableExternalReference(value);
  return (
    reference !== undefined &&
    /^\/\.github\/workflows\/[^/]+\.ya?ml$/.test(reference.suffix) &&
    ALLOWED_EXTERNAL_REUSABLE_WORKFLOW_REPOSITORIES.has(reference.repository)
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Lifecycle validation checks every package script boundary.
function lifecycleErrors(artifacts: readonly TrustRootExecutionArtifact[]): string[] {
  for (const artifact of artifacts) {
    if (!(artifact.path === 'package.json' || artifact.path.endsWith('/package.json'))) continue;
    const value = parsedJson(artifact.text);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return ['Package lifecycle definitions are invalid.'];
    const scriptsValue = (value as Readonly<Record<string, unknown>>)['scripts'];
    if (scriptsValue === undefined) continue;
    if (typeof scriptsValue !== 'object' || scriptsValue === null || Array.isArray(scriptsValue))
      return ['Package lifecycle definitions are invalid.'];
    for (const [name, command] of Object.entries(scriptsValue)) {
      if (!PACKAGE_LIFECYCLE_SCRIPTS.has(name)) continue;
      if (
        !(
          artifact.path === 'package.json' &&
          name === 'prepare' &&
          command === 'lefthook install || true'
        )
      )
        return ['Package lifecycle execution is outside the protected command surface.'];
    }
  }
  return [];
}

const ALLOWED_TRUSTED_DEPENDENCIES = ['@biomejs/biome', 'esbuild', 'lefthook', 'sharp'];

function executionConfigurationErrors(artifacts: readonly TrustRootExecutionArtifact[]): string[] {
  const errors: string[] = [];
  if (artifacts.some((artifact) => artifact.path === '.npmrc'))
    errors.push('Root package manager configuration must remain absent.');
  if (artifacts.some((artifact) => forbiddenRootEnvironmentPath(artifact.path)))
    errors.push('Tracked runtime environment configuration must remain absent.');
  if (artifacts.some((artifact) => artifact.path === 'bunfig.toml'))
    errors.push('Root Bun execution configuration must remain absent.');
  const rootPackages = artifacts.filter((artifact) => artifact.path === 'package.json');
  if (rootPackages.length !== 1)
    return [...errors, 'Root package execution configuration is invalid.'];
  const rootPackage = objectRecord(parsedJson(rootPackages[0]?.text ?? ''));
  if (rootPackage === undefined)
    return [...errors, 'Root package execution configuration is invalid.'];
  if (rootPackage['imports'] !== undefined || rootPackage['patchedDependencies'] !== undefined)
    errors.push('Root package execution configuration contains a forbidden install surface.');
  const trustedDependencies = rootPackage['trustedDependencies'];
  if (trustedDependencies === undefined) return errors;
  if (
    !Array.isArray(trustedDependencies) ||
    trustedDependencies.some((dependency) => typeof dependency !== 'string') ||
    JSON.stringify([...trustedDependencies].sort()) !==
      JSON.stringify([...ALLOWED_TRUSTED_DEPENDENCIES].sort())
  )
    errors.push('Root package trusted dependencies are outside the approved set.');
  return errors;
}

const TYPESCRIPT_RESOLVER_OPTIONS = new Set([
  'allowArbitraryExtensions',
  'baseUrl',
  'customConditions',
  'jsxImportSource',
  'moduleSuffixes',
  'paths',
  'plugins',
  'preserveSymlinks',
  'resolvePackageJsonExports',
  'resolvePackageJsonImports',
  'rootDirs',
]);

function compilerOptions(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value === undefined ? {} : objectRecord(value);
}

function trustedTypeScriptConfigurationErrors(
  artifacts: readonly TrustRootExecutionArtifact[],
): string[] {
  if (artifacts.some((artifact) => artifact.path === 'tsconfig.json'))
    return ['Trusted TypeScript resolver configuration is invalid.'];
  const scriptArtifact = artifacts.find((artifact) => artifact.path === 'scripts/tsconfig.json');
  const baseArtifact = artifacts.find((artifact) => artifact.path === 'tsconfig.base.json');
  if (scriptArtifact === undefined && baseArtifact === undefined) return [];
  if (scriptArtifact === undefined || baseArtifact === undefined)
    return ['Trusted TypeScript resolver configuration is invalid.'];
  const scriptJson = governedJson(scriptArtifact.text);
  const baseJson = governedJson(baseArtifact.text);
  const script = objectRecord(scriptJson.value);
  const base = objectRecord(baseJson.value);
  if (
    script === undefined ||
    base === undefined ||
    scriptJson.duplicateKeys ||
    baseJson.duplicateKeys ||
    script['extends'] !== '../tsconfig.base.json' ||
    base['extends'] !== undefined
  )
    return ['Trusted TypeScript resolver configuration is invalid.'];
  const scriptOptions = compilerOptions(script['compilerOptions']);
  const baseOptions = compilerOptions(base['compilerOptions']);
  if (scriptOptions === undefined || baseOptions === undefined)
    return ['Trusted TypeScript resolver configuration is invalid.'];
  if (
    [...TYPESCRIPT_RESOLVER_OPTIONS].some(
      (option) => scriptOptions[option] !== undefined || baseOptions[option] !== undefined,
    ) ||
    scriptOptions['module'] !== undefined ||
    scriptOptions['moduleResolution'] !== undefined ||
    baseOptions['module'] !== 'Preserve' ||
    baseOptions['moduleResolution'] !== 'Bundler'
  )
    return ['Trusted TypeScript resolver configuration is invalid.'];
  return [];
}

interface ParsedModuleSpecifiers {
  readonly invalid: boolean;
  readonly specifiers: readonly string[];
}

function trustedSourceScriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs'))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parsedModuleSpecifiers(path: string, source: string): ParsedModuleSpecifiers {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    trustedSourceScriptKind(path),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  const specifiers: string[] = [];
  let invalid = parseDiagnostics.length > 0;
  const addExpression = (expression: ts.Expression | undefined) => {
    if (expression !== undefined && ts.isStringLiteralLike(expression)) {
      specifiers.push(expression.text);
      return;
    }
    invalid = true;
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) addExpression(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)
      addExpression(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference))
        addExpression(node.moduleReference.expression);
      else invalid = true;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      if (node.arguments.length === 1) addExpression(node.arguments[0]);
      else invalid = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { invalid, specifiers };
}

const ALLOWED_TRUSTED_EXTERNAL_MODULES = new Set(['entities', 'marked', 'typescript', 'zod']);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Dependency traversal rejects dynamic and unprotected module identities.
function protectedDependencyErrors(artifacts: readonly TrustRootExecutionArtifact[]): string[] {
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact.text]));
  const queue = ['scripts/check-readiness-scope-pr.ts'];
  const visited = new Set<string>();
  const governedData = new Set([REGISTRY_DATA_FILE, ALLOWED_SCOPE_FILES[3]]);
  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    const source = byPath.get(path);
    if (source === undefined) return ['Trusted execution dependency source is unavailable.'];
    const parsed = parsedModuleSpecifiers(path, source);
    if (parsed.invalid)
      return ['Trusted execution dependencies must use static module identities.'];
    for (const specifier of parsed.specifiers) {
      if (!specifier.startsWith('.')) {
        if (specifier.startsWith('node:') || ALLOWED_TRUSTED_EXTERNAL_MODULES.has(specifier))
          continue;
        return ['Trusted execution dependencies must stay inside protected source paths.'];
      }
      const resolved = posix.normalize(posix.join(posix.dirname(path), specifier));
      if (resolved.startsWith('../') || resolved.includes('/../'))
        return ['Trusted execution dependencies must stay inside protected source paths.'];
      if (governedData.has(resolved)) continue;
      if (!trustRootPath(resolved))
        return ['Trusted execution dependencies must stay inside protected source paths.'];
      if (repositoryScriptPath(resolved) || TRUST_ROOT_FILES.has(resolved)) queue.push(resolved);
    }
  }
  return [];
}

function workflowDefinitions(
  artifacts: readonly TrustRootExecutionArtifact[],
): ReadonlyMap<string, WorkflowDefinition> | undefined {
  const definitions = new Map<string, WorkflowDefinition>();
  for (const artifact of artifacts) {
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(artifact.path)) continue;
    const definition = workflowDefinition(artifact.text);
    if (definition === undefined || definitions.has(artifact.path)) return undefined;
    definitions.set(artifact.path, definition);
  }
  return definitions;
}

function graphHasCycle(edges: ReadonlyMap<string, readonly string[]>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (path: string): boolean => {
    if (visiting.has(path)) return true;
    if (visited.has(path)) return false;
    visiting.add(path);
    if ((edges.get(path) ?? []).some(visit)) return true;
    visiting.delete(path);
    visited.add(path);
    return false;
  };
  return [...edges.keys()].some(visit);
}

function workflowEdges(
  definitions: ReadonlyMap<string, WorkflowDefinition>,
): ReadonlyMap<string, readonly string[]> | undefined {
  const edges = new Map<string, readonly string[]>();
  for (const [path, definition] of definitions) {
    const targets: string[] = [];
    for (const uses of definition.workflowUses) {
      const local = protectedLocalWorkflow(uses);
      if (local === '') return undefined;
      if (local === undefined) {
        if (!allowedExternalReusableWorkflow(uses)) return undefined;
        continue;
      }
      if (!definitions.has(local)) return undefined;
      targets.push(local);
    }
    edges.set(path, targets);
  }
  return graphHasCycle(edges) ? undefined : edges;
}

function privilegedWorkflowPaths(
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  edges: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const privileged = new Set(
    [...definitions].flatMap(([path, definition]) => (definition.privileged ? [path] : [])),
  );
  const queue = [...privileged];
  for (const path of queue) {
    for (const target of edges.get(path) ?? []) {
      if (privileged.has(target)) continue;
      privileged.add(target);
      queue.push(target);
    }
  }
  return privileged;
}

function localActionEdges(
  definitions: ReadonlyMap<string, LocalActionDefinition>,
): ReadonlyMap<string, readonly string[]> | undefined {
  const edges = new Map<string, readonly string[]>();
  for (const [path, definition] of definitions) {
    const targets: string[] = [];
    for (const invocation of definition.actions) {
      const local = protectedLocalAction(invocation.uses);
      if (local === '') return undefined;
      if (local === undefined) continue;
      if (!definitions.has(local)) return undefined;
      targets.push(local);
    }
    edges.set(path, targets);
  }
  return graphHasCycle(edges) ? undefined : edges;
}

function workflowActionShapeErrors(
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  actions: ReadonlyMap<string, LocalActionDefinition>,
): string[] {
  for (const definition of definitions.values()) {
    for (const invocation of definition.actions) {
      const local = protectedLocalAction(invocation.uses);
      if (local === '')
        return [
          'Repository-local actions must live under the protected .github/actions directory.',
        ];
      if (local !== undefined && !actions.has(local))
        return ['Protected repository-local action definition is unavailable.'];
    }
  }
  return [];
}

function enqueuePrivilegedAction(
  invocation: ActionInvocation,
  actions: ReadonlyMap<string, LocalActionDefinition>,
  queue: string[],
): string | undefined {
  const local = protectedLocalAction(invocation.uses);
  if (local === '')
    return 'Repository-local actions must live under the protected .github/actions directory.';
  if (local === undefined)
    return allowedPrivilegedAction(invocation)
      ? undefined
      : 'Privileged workflow dependencies must use allowed immutable actions.';
  if (!actions.has(local))
    return 'Repository-local action execution must stay inside protected dependencies.';
  queue.push(local);
  return undefined;
}

function privilegedActionErrors(
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  privilegedWorkflows: ReadonlySet<string>,
  actions: ReadonlyMap<string, LocalActionDefinition>,
): string[] {
  const queue: string[] = [];
  for (const path of privilegedWorkflows) {
    for (const invocation of definitions.get(path)?.actions ?? []) {
      const error = enqueuePrivilegedAction(invocation, actions, queue);
      if (error !== undefined) return [error];
    }
  }
  const visited = new Set<string>();
  for (const path of queue) {
    if (visited.has(path)) continue;
    visited.add(path);
    const definition = actions.get(path);
    if (definition === undefined)
      return ['Repository-local action execution must stay inside protected dependencies.'];
    for (const invocation of definition.actions) {
      const error = enqueuePrivilegedAction(invocation, actions, queue);
      if (error !== undefined) return [error];
    }
  }
  return [];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Workflow validation binds actions, privileges, commands, lifecycle hooks, and imports.
export function validateTrustRootExecutionDependencies(
  artifacts: readonly TrustRootExecutionArtifact[],
): string[] {
  const errors: string[] = [];
  const paths = artifacts.map((artifact) => artifact.path);
  if (new Set(paths).size !== paths.length)
    errors.push('Trusted execution dependency source is invalid.');
  const workflows = workflowDefinitions(artifacts);
  const actions = localActionDefinitions(artifacts);
  if (workflows === undefined) errors.push('Workflow execution definition is invalid.');
  if (actions === undefined)
    errors.push('Repository-local action execution must stay inside protected dependencies.');
  if (workflows !== undefined && actions !== undefined) {
    const workflowGraph = workflowEdges(workflows);
    const actionGraph = localActionEdges(actions);
    if (workflowGraph === undefined) errors.push('Reusable workflow dependency graph is invalid.');
    if (actionGraph === undefined)
      errors.push('Repository-local action execution must stay inside protected dependencies.');
    errors.push(...workflowActionShapeErrors(workflows, actions));
    if (workflowGraph !== undefined && actionGraph !== undefined) {
      const privileged = privilegedWorkflowPaths(workflows, workflowGraph);
      for (const [path, workflow] of workflows) {
        if (
          path === '.github/workflows/readiness-scope.yml' &&
          !exactReadinessWorkflow(artifacts.find((artifact) => artifact.path === path)?.text ?? '')
        )
          errors.push('Privileged readiness workflow semantic contract is invalid.');
        else if (
          path !== '.github/workflows/readiness-scope.yml' &&
          privileged.has(path) &&
          (workflow.runs.length > 0 || workflow.unprotectedExecutableSurface)
        )
          errors.push('Privileged workflows cannot execute unprotected repository commands.');
      }
      errors.push(...privilegedActionErrors(workflows, privileged, actions));
    }
  }
  errors.push(...executionConfigurationErrors(artifacts));
  errors.push(...trustedTypeScriptConfigurationErrors(artifacts));
  errors.push(...lifecycleErrors(artifacts));
  errors.push(...protectedDependencyErrors(artifacts));
  return errors;
}

function trustPolicyErrors(input: ReadinessScopePrInput): string[] {
  if (!input.changedFiles.some(trustRootPath)) return [];
  const errors: string[] = [];
  if (
    input.changedFiles.some(
      (path) => !(trustRootPath(path) || TRUST_POLICY_COMPANION_FILES.has(path)),
    )
  )
    errors.push('Trust-root changes require the dedicated policy-update file shape.');
  if (!hasExactApprovals(input))
    errors.push('Trust-root changes lack both required exact-head approvals.');
  return errors;
}

function closureRecords(value: unknown): readonly ClosureEvidenceRecord[] | undefined {
  const sourceResult = readinessReferenceRegistrySourceSchema.safeParse(value);
  if (!sourceResult.success) return undefined;
  const built = buildReadinessReferenceRegistry(
    sourceResult.data as unknown as ReadinessReferenceRegistrySource,
  );
  if (!('registry' in built)) return undefined;
  return [...built.registry.records.values()].filter(
    (record): record is ClosureEvidenceRecord => record.kind === 'closure',
  );
}

function sealTransitionIds(
  base: readonly FindingRow[],
  head: readonly FindingRow[],
): readonly string[] {
  const sealed = new Set(['Closed', 'Accepted P1 exception']);
  const baseById = new Map(base.map((row) => [row.id, row]));
  return head.flatMap((row) => {
    const baseStatus = baseById.get(row.id)?.status;
    return sealed.has(row.status) && baseStatus !== row.status ? [row.id] : [];
  });
}

function validReadyEvidence(
  input: ReadinessScopePrInput,
  closure: ClosureEvidenceRecord,
  proof: ReadinessScopePrInput['readyEvidence'][number],
): boolean {
  const target =
    /^https:\/\/github\.com\/Noveum\/orbit\/actions\/runs\/([1-9]\d*)\/attempts\/([1-9]\d*)$/.exec(
      proof.statusTargetUrl,
    );
  const runPullRequest = proof.runPullRequests.length === 1 ? proof.runPullRequests[0] : undefined;
  const runHeadMatchesEvent =
    (proof.runEvent === 'pull_request_target' && proof.runHeadSha === proof.pullRequestHeadSha) ||
    proof.runEvent === 'pull_request_review';
  const runStartedAt = Date.parse(proof.runStartedAt);
  const statusCreatedAt = Date.parse(proof.statusCreatedAt);
  const statusUpdatedAt = Date.parse(proof.statusUpdatedAt);
  const runUpdatedAt = Date.parse(proof.runUpdatedAt);
  const mergedAt = Date.parse(proof.mergedAt);
  const observedAt = Date.parse(closure.observedAt);
  return (
    proof.findingId === closure.findingId &&
    proof.evidenceCommit === closure.evidenceCommit.commitSha &&
    proof.evidenceCommit !== input.headSha &&
    proof.baseContainsEvidence &&
    proof.pullRequestBaseRef === 'main' &&
    proof.pullRequestBaseRepository === 'Noveum/orbit' &&
    proof.mergeCommitSha === proof.evidenceCommit &&
    proof.statusState === 'success' &&
    proof.statusContext === 'Trusted readiness policy' &&
    proof.statusCreator === 'github-actions[bot]' &&
    proof.configuredWorkflowId === proof.runWorkflowId &&
    proof.runWorkflowPath === '.github/workflows/readiness-scope.yml' &&
    proof.runWorkflowState === 'active' &&
    proof.runWorkflowDefinitionDigest === TRUSTED_READINESS_WORKFLOW_DEFINITION_DIGEST &&
    proof.runRepository === 'Noveum/orbit' &&
    target !== null &&
    proof.runId === Number(target[1]) &&
    proof.runAttempt === Number(target[2]) &&
    ['pull_request_target', 'pull_request_review'].includes(proof.runEvent) &&
    proof.runConclusion === 'success' &&
    runHeadMatchesEvent &&
    proof.definitionCommitSha === proof.pullRequestBaseSha &&
    proof.definitionCommitIsEvidenceAncestor &&
    runPullRequest?.number === proof.pullRequestNumber &&
    runPullRequest.headSha === proof.pullRequestHeadSha &&
    runPullRequest.baseRef === 'main' &&
    runPullRequest.baseSha === proof.pullRequestBaseSha &&
    runStartedAt <= statusCreatedAt &&
    statusCreatedAt <= statusUpdatedAt &&
    statusUpdatedAt <= runUpdatedAt &&
    runUpdatedAt <= mergedAt &&
    mergedAt < observedAt
  );
}

function readyEvidenceErrors(
  input: ReadinessScopePrInput,
  base: readonly FindingRow[],
  head: readonly FindingRow[],
  registryValue: unknown,
): string[] {
  const transitionIds = sealTransitionIds(base, head);
  if (transitionIds.length === 0)
    return input.readyEvidence.length === 0
      ? []
      : ['Ready evidence is present without a seal transition.'];
  const closures = closureRecords(registryValue);
  if (closures === undefined)
    return ['Seal transition has invalid independently authenticated Ready evidence.'];
  const errors: string[] = [];
  for (const findingId of transitionIds) {
    const matchingClosures = closures.filter((closure) => closure.findingId === findingId);
    const matchingProofs = input.readyEvidence.filter((proof) => proof.findingId === findingId);
    if (
      matchingClosures.length !== 1 ||
      matchingProofs.length !== 1 ||
      !validReadyEvidence(
        input,
        matchingClosures[0] as ClosureEvidenceRecord,
        matchingProofs[0] as ReadinessScopePrInput['readyEvidence'][number],
      )
    )
      errors.push('Seal transition has invalid independently authenticated Ready evidence.');
  }
  if (input.readyEvidence.some((proof) => !transitionIds.includes(proof.findingId)))
    errors.push('Ready evidence is present without a seal transition.');
  return errors;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Scope changes enforce one atomic policy contract.
export function validateReadinessScopePullRequest(input: ReadinessScopePrInput): string[] {
  const errors = trustPolicyErrors(input);
  let basePlan: ReturnType<typeof parsePlanFindings>;
  let headPlan: ReturnType<typeof parsePlanFindings>;
  let baseLedger: ReturnType<typeof parseFindingRows>;
  let headLedger: ReturnType<typeof parseFindingRows>;
  let baseExceptions: ReturnType<typeof parseExceptionRows>;
  let headExceptions: ReturnType<typeof parseExceptionRows>;
  try {
    basePlan = parsePlanFindings(input.base.plan);
    headPlan = parsePlanFindings(input.head.plan);
    baseLedger = parseFindingRows(input.base.ledger);
    headLedger = parseFindingRows(input.head.ledger);
    baseExceptions = parseExceptionRows(input.base.ledger);
    headExceptions = parseExceptionRows(input.head.ledger);
  } catch {
    return ['Readiness scope artifacts have an invalid table structure.'];
  }
  const baseManifestJson = governedJson(input.base.manifest);
  const headManifestJson = governedJson(input.head.manifest);
  const baseAuditJson = governedJson(input.base.audit);
  const headAuditJson = governedJson(input.head.audit);
  const baseRegistryJson = governedJson(input.base.registry);
  const headRegistryJson = governedJson(input.head.registry);
  const governed = [
    baseManifestJson,
    headManifestJson,
    baseAuditJson,
    headAuditJson,
    baseRegistryJson,
    headRegistryJson,
  ];
  if (governed.some((artifact) => artifact.duplicateKeys))
    errors.push('Governed JSON artifacts must use unique object keys.');
  if (governed.some((artifact) => !(artifact.duplicateKeys || artifact.canonical)))
    errors.push('Governed JSON artifacts must use canonical bytes.');
  const baseManifestResult = readinessScopeManifestSchema.safeParse(baseManifestJson.value);
  const headManifestResult = readinessScopeManifestSchema.safeParse(headManifestJson.value);
  if (!(baseManifestResult.success && headManifestResult.success))
    return [...errors, 'Readiness scope manifest data is invalid.'];
  const baseManifest = baseManifestResult.data as ReadinessScopeManifest;
  const headManifest = headManifestResult.data as ReadinessScopeManifest;
  const semanticChange = semanticSignature(baseManifest) !== semanticSignature(headManifest);
  const semanticChangedIds = semanticChange
    ? new Set(changedFindingIds(baseManifest, headManifest))
    : undefined;
  const artifactErrors = [
    ...validateReadinessScopeArtifacts(basePlan, baseLedger, baseManifest),
    ...validateReadinessScopeArtifacts(headPlan, headLedger, headManifest),
  ];
  if (artifactErrors.length > 0)
    errors.push('Readiness scope artifacts do not match the governed manifest.');
  if (invalidSealTransition(baseLedger, headLedger))
    errors.push('Closure seals require a Ready for closure finding on the trusted base.');
  if (sealedStateChanged(baseLedger, headLedger, baseExceptions, headExceptions))
    errors.push('Sealed readiness state is immutable.');
  errors.push(
    ...registryLifecycleErrors(
      input,
      baseLedger,
      headLedger,
      baseExceptions,
      headExceptions,
      baseRegistryJson.value,
      headRegistryJson.value,
      semanticChangedIds,
    ),
  );
  errors.push(...readyEvidenceErrors(input, baseLedger, headLedger, headRegistryJson.value));
  if (!semanticChange) {
    if (
      baseManifest.version !== headManifest.version ||
      baseManifest.digest !== headManifest.digest
    )
      errors.push('Manifest version or digest changed without governed semantics.');
    if (input.base.manifest !== input.head.manifest || input.base.audit !== input.head.audit)
      errors.push('Non-semantic changes cannot modify the scope manifest or audit record.');
    if (
      JSON.stringify(basePlan.map(planFindingState)) !==
      JSON.stringify(headPlan.map(planFindingState))
    )
      errors.push('Non-semantic changes cannot modify governed plan finding rows.');
    const findingIds = new Set([...baseLedger, ...headLedger].map((row) => row.id));
    const baseRows = new Map(baseLedger.map((row) => [row.id, row]));
    const headRows = new Map(headLedger.map((row) => [row.id, row]));
    const stateChangedIds = new Set(
      [...findingIds].filter((id) => {
        const baseRow = baseRows.get(id);
        const headRow = headRows.get(id);
        return (
          baseRow === undefined ||
          headRow === undefined ||
          findingState(baseRow) !== findingState(headRow)
        );
      }),
    );
    if (
      readinessGovernanceFingerprint(input.base.ledger, 'ledger', findingIds, stateChangedIds) !==
      readinessGovernanceFingerprint(input.head.ledger, 'ledger', findingIds, stateChangedIds)
    )
      errors.push('Non-semantic changes cannot modify governance content outside finding rows.');
    if (
      closureTransition(baseLedger, headLedger) &&
      !exactChangedFiles(input.changedFiles, CLOSURE_TRANSITION_FILES)
    )
      errors.push('Closure transitions must use the exact ledger-and-registry file shape.');
    return errors;
  }
  const scopeChangeFiles =
    input.base.registry === input.head.registry
      ? ALLOWED_SCOPE_FILES
      : SCOPE_CHANGE_FILES_WITH_REGISTRY;
  if (!exactChangedFiles(input.changedFiles, scopeChangeFiles))
    errors.push('Scope changes must use the dedicated allowed-file shape.');
  if (!exactVersionIncrement(baseManifest.version, headManifest.version))
    errors.push('Scope changes require an exact one-step manifest version increment.');
  const changedIds = changedFindingIds(baseManifest, headManifest);
  const changedIdSet = new Set(changedIds);
  if (
    readinessGovernanceFingerprint(input.base.plan, 'plan', changedIdSet) !==
      readinessGovernanceFingerprint(input.head.plan, 'plan', changedIdSet) ||
    readinessGovernanceFingerprint(input.base.ledger, 'ledger', changedIdSet) !==
      readinessGovernanceFingerprint(input.head.ledger, 'ledger', changedIdSet)
  )
    errors.push('Scope changes cannot modify governance content outside changed finding rows.');
  const baseExceptionState = new Map(
    baseExceptions.map((row) => [row.findingId, exceptionState(row)]),
  );
  const headExceptionState = new Map(
    headExceptions.map((row) => [row.findingId, exceptionState(row)]),
  );
  const exceptionIds = new Set([...baseExceptionState.keys(), ...headExceptionState.keys()]);
  if (
    [...exceptionIds].some(
      (id) => !changedIdSet.has(id) && baseExceptionState.get(id) !== headExceptionState.get(id),
    )
  )
    errors.push('Scope changes cannot modify unaffected exception state.');
  const baseRows = new Map(baseLedger.map((row) => [row.id, row]));
  const headRows = new Map(headLedger.map((row) => [row.id, row]));
  const unaffectedStateChanged = headManifest.findings.some((finding) => {
    if (changedIdSet.has(finding.id)) return false;
    const baseRow = baseRows.get(finding.id);
    const headRow = headRows.get(finding.id);
    return (
      baseRow === undefined ||
      headRow === undefined ||
      findingState(baseRow) !== findingState(headRow)
    );
  });
  if (unaffectedStateChanged) errors.push('Scope changes cannot modify unaffected ledger state.');
  const changedRowIsClosed = changedIds.some((id) => {
    const row = headRows.get(id);
    return row !== undefined && !openScopeRow(row);
  });
  if (changedRowIsClosed) errors.push('New or materially changed findings must remain Open.');
  const auditResult = readinessScopeAuditSchema.safeParse(headAuditJson.value);
  if (auditResult.success) {
    const audit = auditResult.data;
    const complete =
      audit.baseVersion === baseManifest.version &&
      audit.headVersion === headManifest.version &&
      audit.baseDigest === baseManifest.digest &&
      audit.headDigest === headManifest.digest &&
      canonicalReviewUrl(audit.reviewUrl) &&
      meaningfulRationale(audit.rationale) &&
      JSON.stringify([...audit.changedFindingIds].sort()) === JSON.stringify(changedIds);
    if (!complete) errors.push('Scope change audit record is invalid or incomplete.');
  } else errors.push('Scope change audit record is invalid or incomplete.');
  if (!hasExactApprovals(input))
    errors.push('Scope change lacks both required exact-head approvals.');
  return errors;
}

export function validateFinalReadinessScopeState(
  input: ReadinessScopePrInput,
  reviews: ReadinessScopePrInput['reviews'],
  currentBaseSha: string,
  currentHeadSha: string,
): string[] {
  const errors = validateReadinessScopePullRequest({ ...input, reviews });
  if (currentBaseSha !== input.baseSha || currentHeadSha !== input.headSha)
    errors.push('Pull request head or base changed during scope validation.');
  return errors;
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Trusted scope policy Git operation failed.');
  return String(result.stdout);
}

export function parseRawGitDiff(bytes: Uint8Array): string[] {
  return parseTrustedRawGitDiff(bytes);
}

export function readGitChangedFiles(root: string, baseSha: string, headSha: string): string[] {
  return readTrustedGitChangedFiles(root, baseSha, headSha);
}

function authenticatedGit(root: string, args: readonly string[], token: string): string {
  const authorization = Buffer.from(`x-access-token:${token}`).toString('base64');
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
    },
  });
  if (result.status !== 0) throw new Error('Trusted scope policy Git operation failed.');
  return String(result.stdout);
}

export function readGitArtifact(root: string, commit: string, path: string): string {
  return readTrustedGitArtifact(root, commit, path);
}

async function githubJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error('Trusted scope policy GitHub request failed.');
  return response.json();
}

async function githubStatus(
  commit: string,
  state: 'pending' | 'success' | 'failure',
  description: string,
  targetUrl: string,
  token: string,
): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/Noveum/orbit/statuses/${commit}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      state,
      context: 'Trusted readiness policy',
      description,
      target_url: targetUrl,
    }),
  });
  if (!response.ok) throw new Error('Trusted readiness status update failed.');
}

async function githubReviews(
  pullRequestNumber: number,
  token: string,
): Promise<ReadinessScopePrInput['reviews']> {
  const reviews: ReadinessScopePrInput['reviews'][number][] = [];
  for (let page = 1; page <= 20; page += 1) {
    const reviewResult = githubReviewResponseSchema.safeParse(
      await githubJson(
        `https://api.github.com/repos/Noveum/orbit/pulls/${pullRequestNumber}/reviews?per_page=100&page=${page}`,
        token,
      ),
    );
    if (!reviewResult.success) throw new Error('Trusted scope policy review data is invalid.');
    const value = reviewResult.data;
    for (const review of value) {
      if (
        review.user === null ||
        review.submitted_at === null ||
        !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED'].includes(review.state)
      )
        continue;
      reviews.push({
        login: review.user.login,
        state: review.state as ReadinessScopePrInput['reviews'][number]['state'],
        commitId: review.commit_id,
        submittedAt: review.submitted_at,
      });
    }
    if (value.length < 100) return reviews;
  }
  throw new Error('Trusted scope policy review history is too large.');
}

async function githubAssociatedPullRequests(
  commit: string,
  token: string,
): Promise<readonly (typeof githubAssociatedPullsResponseSchema._output)[number][]> {
  const pullRequests: (typeof githubAssociatedPullsResponseSchema._output)[number][] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = githubAssociatedPullsResponseSchema.safeParse(
      await githubJson(
        `https://api.github.com/repos/Noveum/orbit/commits/${commit}/pulls?per_page=100&page=${page}`,
        token,
      ),
    );
    if (!result.success)
      throw new Error('Trusted scope policy associated pull request data is invalid.');
    pullRequests.push(...result.data);
    if (result.data.length < 100) return pullRequests;
  }
  throw new Error('Trusted scope policy associated pull request history is too large.');
}

async function githubCommitStatuses(
  commit: string,
  token: string,
): Promise<readonly (typeof githubCommitStatusesResponseSchema._output)[number][]> {
  const statuses: (typeof githubCommitStatusesResponseSchema._output)[number][] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = githubCommitStatusesResponseSchema.safeParse(
      await githubJson(
        `https://api.github.com/repos/Noveum/orbit/commits/${commit}/statuses?per_page=100&page=${page}`,
        token,
      ),
    );
    if (!result.success) throw new Error('Trusted scope policy commit status data is invalid.');
    statuses.push(...result.data);
    if (result.data.length < 100) return statuses;
  }
  throw new Error('Trusted scope policy commit status history is too large.');
}

function gitIsAncestor(root: string, ancestor: string, descendant: string): boolean {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: root,
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error('Trusted scope policy Git operation failed.');
}

async function readyEvidenceForClosure(
  root: string,
  baseSha: string,
  closure: ClosureEvidenceRecord,
  token: string,
): Promise<ReadinessScopePrInput['readyEvidence'][number] | undefined> {
  const evidenceCommit = closure.evidenceCommit.commitSha;
  const associated = await githubAssociatedPullRequests(evidenceCommit, token);
  const merged = associated.filter(
    (pullRequest) =>
      pullRequest.merged_at !== null &&
      pullRequest.merge_commit_sha === evidenceCommit &&
      pullRequest.base.ref === 'main' &&
      pullRequest.base.repo.full_name === 'Noveum/orbit',
  );
  const pullRequest = merged.length === 1 ? merged[0] : undefined;
  if (
    pullRequest === undefined ||
    pullRequest.merged_at === null ||
    pullRequest.merge_commit_sha === null
  )
    return undefined;
  const statuses = await githubCommitStatuses(pullRequest.head.sha, token);
  const matchingStatuses = statuses
    .filter((status) => status.context === 'Trusted readiness policy')
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  const status = matchingStatuses[0];
  if (status === undefined || status.target_url === null || status.creator === null)
    return undefined;
  const target =
    /^https:\/\/github\.com\/Noveum\/orbit\/actions\/runs\/([1-9]\d*)\/attempts\/([1-9]\d*)$/.exec(
      status.target_url,
    );
  if (target === null) return undefined;
  const runId = Number(target[1]);
  const runAttempt = Number(target[2]);
  const runResult = githubWorkflowAttemptSchema.safeParse(
    await githubJson(
      `https://api.github.com/repos/Noveum/orbit/actions/runs/${runId}/attempts/${runAttempt}`,
      token,
    ),
  );
  const workflowResult = githubWorkflowIdentitySchema.safeParse(
    await githubJson(
      'https://api.github.com/repos/Noveum/orbit/actions/workflows/readiness-scope.yml',
      token,
    ),
  );
  if (
    !(runResult.success && workflowResult.success) ||
    workflowResult.data.path !== '.github/workflows/readiness-scope.yml'
  )
    return undefined;
  const definitionDigest = await githubWorkflowDefinitionDigest(
    pullRequest.base.sha,
    '.github/workflows/readiness-scope.yml',
    token,
  );
  if (definitionDigest === undefined) return undefined;
  const run = runResult.data;
  return {
    findingId: closure.findingId,
    evidenceCommit,
    baseContainsEvidence: gitIsAncestor(root, evidenceCommit, baseSha),
    pullRequestNumber: pullRequest.number,
    pullRequestBaseRef: pullRequest.base.ref,
    pullRequestBaseSha: pullRequest.base.sha,
    pullRequestBaseRepository: pullRequest.base.repo.full_name,
    pullRequestHeadSha: pullRequest.head.sha,
    mergeCommitSha: pullRequest.merge_commit_sha,
    mergedAt: pullRequest.merged_at,
    statusState: status.state,
    statusContext: status.context,
    statusCreator: status.creator.login,
    statusTargetUrl: status.target_url,
    statusCreatedAt: status.created_at,
    statusUpdatedAt: status.updated_at,
    configuredWorkflowId: workflowResult.data.id,
    runWorkflowId: run.workflow_id,
    runWorkflowPath: run.path.split('@')[0] ?? '',
    runWorkflowState: workflowResult.data.state,
    runWorkflowDefinitionDigest: definitionDigest,
    runRepository: run.repository.full_name,
    runId,
    runAttempt: run.run_attempt,
    runEvent: run.event,
    runConclusion: run.conclusion,
    runHeadSha: run.head_sha,
    definitionCommitSha: pullRequest.base.sha,
    definitionCommitIsEvidenceAncestor: gitIsAncestor(root, pullRequest.base.sha, evidenceCommit),
    runStartedAt: run.run_started_at,
    runUpdatedAt: run.updated_at,
    runPullRequests: run.pull_requests.map((entry) => ({
      number: entry.number,
      headSha: entry.head.sha,
      baseRef: entry.base.ref,
      baseSha: entry.base.sha,
    })),
  };
}

export async function readyEvidenceForRegistry(
  root: string,
  baseSha: string,
  baseLedgerText: string,
  headLedgerText: string,
  registryText: string,
  token: string,
  loadProof: typeof readyEvidenceForClosure = readyEvidenceForClosure,
): Promise<ReadinessScopePrInput['readyEvidence']> {
  let transitionIds: readonly string[];
  try {
    transitionIds = sealTransitionIds(
      parseFindingRows(baseLedgerText),
      parseFindingRows(headLedgerText),
    );
  } catch {
    return [];
  }
  if (transitionIds.length === 0) return [];
  const closures = closureRecords(governedJson(registryText).value);
  if (closures === undefined || closures.length === 0) return [];
  const proofs = await Promise.all(
    closures
      .filter((closure) => transitionIds.includes(closure.findingId))
      .map((closure) => loadProof(root, baseSha, closure, token)),
  );
  return proofs.filter(
    (proof): proof is ReadinessScopePrInput['readyEvidence'][number] => proof !== undefined,
  );
}

function trustedGitTreePaths(root: string, commit: string): readonly string[] {
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error('Trusted scope policy Git commit identity is invalid.');
  const result = spawnSync('git', ['ls-tree', '-rz', '--name-only', commit], { cwd: root });
  if (result.status !== 0 || !(result.stdout instanceof Uint8Array))
    throw new Error('Trusted scope policy Git operation failed.');
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  const fields = decoded.split('\0');
  if (fields.at(-1) !== '') throw new Error('Trusted scope policy Git tree data is invalid.');
  fields.pop();
  if (fields.length > 20_000 || new Set(fields).size !== fields.length)
    throw new Error('Trusted scope policy Git tree data is invalid.');
  const hasControlCharacter = (path: string) =>
    [...path].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  if (
    fields.some(
      (path) =>
        path.length === 0 ||
        path.length > 1_024 ||
        path.startsWith('/') ||
        path.split('/').some((part) => part === '' || part === '.' || part === '..') ||
        hasControlCharacter(path),
    )
  )
    throw new Error('Trusted scope policy Git tree data is invalid.');
  return fields;
}

function trustExecutionArtifactPath(path: string): boolean {
  return (
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) ||
    path.startsWith('.github/actions/') ||
    path === '.npmrc' ||
    forbiddenRootEnvironmentPath(path) ||
    path === 'bun.lock' ||
    path === 'bunfig.toml' ||
    path === 'package.json' ||
    path === 'tsconfig.base.json' ||
    path === 'tsconfig.json' ||
    path.endsWith('/package.json') ||
    repositoryScriptPath(path) ||
    path === 'packages/shared/src/validators/readiness.ts'
  );
}

function trustExecutionArtifacts(root: string, commit: string): TrustRootExecutionArtifact[] {
  const paths = trustedGitTreePaths(root, commit).filter(trustExecutionArtifactPath);
  if (paths.length > 2_048) throw new Error('Trusted execution dependency set is too large.');
  const artifacts = paths.map((path) => ({ path, text: readGitArtifact(root, commit, path) }));
  if (artifacts.reduce((size, artifact) => size + artifact.text.length, 0) > 5_000_000)
    throw new Error('Trusted execution dependency set is too large.');
  return artifacts;
}

export function validateTrustRootExecutionDependenciesForCommit(
  root: string,
  commit: string,
): string[] {
  const artifacts = trustExecutionArtifacts(root, commit);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  const errors = validateTrustRootExecutionDependencies(artifacts);
  const required = [
    '.github/workflows/readiness-scope.yml',
    'bun.lock',
    'package.json',
    'scripts/check-readiness-scope-pr.ts',
    'scripts/tsconfig.json',
    'tsconfig.base.json',
  ];
  if (required.some((path) => !paths.has(path)))
    errors.push('Trusted execution dependency source is unavailable.');
  return errors;
}

async function productionInput(
  root: string,
  event: typeof pullRequestTargetEventSchema._output,
  token: string,
): Promise<ReadinessScopePrInput> {
  const baseSha = event.pull_request.base.sha;
  const headSha = event.pull_request.head.sha;
  const pullRequestNumber = event.pull_request.number;
  if (git(root, ['rev-parse', 'HEAD']).trim() !== baseSha)
    throw new Error('Trusted scope policy base checkout mismatch.');
  authenticatedGit(
    root,
    ['fetch', '--no-tags', 'origin', `refs/pull/${pullRequestNumber}/head`],
    token,
  );
  if (git(root, ['rev-parse', 'FETCH_HEAD']).trim() !== headSha)
    throw new Error('Trusted scope policy head fetch mismatch.');
  const changedFiles = readGitChangedFiles(root, baseSha, headSha);
  const artifact = (commit: string, path: string) => readGitArtifact(root, commit, path);
  const artifacts = (commit: string) => ({
    plan: artifact(commit, ALLOWED_SCOPE_FILES[2]),
    ledger: artifact(commit, ALLOWED_SCOPE_FILES[0]),
    manifest: artifact(commit, ALLOWED_SCOPE_FILES[3]),
    audit: artifact(commit, ALLOWED_SCOPE_FILES[1]),
    registry: artifact(commit, REGISTRY_DATA_FILE),
  });
  const reviews = await githubReviews(pullRequestNumber, token);
  const base = artifacts(baseSha);
  const head = artifacts(headSha);
  const readyEvidence = await readyEvidenceForRegistry(
    root,
    baseSha,
    base.ledger,
    head.ledger,
    head.registry,
    token,
  );
  const result = readinessScopePrInputSchema.safeParse({
    baseRef: event.pull_request.base.ref,
    baseSha,
    headSha,
    changedFiles,
    base,
    head,
    readyEvidence,
    reviews,
  });
  if (!result.success) throw new Error('Trusted scope policy input data is invalid.');
  return result.data;
}

async function headReadinessErrors(root: string, input: ReadinessScopePrInput): Promise<string[]> {
  const registryResult = readinessReferenceRegistrySourceSchema.safeParse(
    parsedJson(input.head.registry),
  );
  const manifestResult = readinessScopeManifestSchema.safeParse(parsedJson(input.head.manifest));
  if (!(registryResult.success && manifestResult.success))
    return ['Fetched readiness artifacts are invalid.'];
  const source = registryResult.data as unknown as ReadinessReferenceRegistrySource;
  try {
    const findings = parseFindingRows(input.head.ledger);
    const verifier = await createProductionReadinessEvidenceVerifier(root, source, {
      currentCommit: input.headSha,
      ...readinessEvidenceTargets(findings, source),
    });
    const errors = validateReadinessLedger(
      parsePlanFindings(input.head.plan),
      findings,
      parseExceptionRows(input.head.ledger),
      currentUtcDate(new Date(verifier.verificationInstant)),
      source,
      manifestResult.data as ReadinessScopeManifest,
      verifier,
    );
    return errors.length === 0 ? [] : ['Fetched readiness artifacts failed validation.'];
  } catch {
    return ['Fetched readiness artifacts failed validation.'];
  }
}

async function productionContext(): Promise<{
  readonly event: typeof pullRequestTargetEventSchema._output;
  readonly statusTargetUrl: string;
  readonly token: string;
}> {
  const eventPath = process.env['GITHUB_EVENT_PATH'];
  const token = process.env['GITHUB_TOKEN'];
  const runId = process.env['GITHUB_RUN_ID'];
  const runAttempt = process.env['GITHUB_RUN_ATTEMPT'];
  if (
    eventPath === undefined ||
    token === undefined ||
    token.length === 0 ||
    runId === undefined ||
    runAttempt === undefined ||
    !/^[1-9]\d*$/.test(runId) ||
    !/^[1-9]\d*$/.test(runAttempt)
  )
    throw new Error('Trusted scope policy context is unavailable.');
  const eventResult = pullRequestTargetEventSchema.safeParse(
    parsedJson(await readFile(eventPath, 'utf8')),
  );
  if (!eventResult.success) throw new Error('Trusted scope policy event is invalid.');
  return {
    event: eventResult.data,
    statusTargetUrl: `https://github.com/Noveum/orbit/actions/runs/${runId}/attempts/${runAttempt}`,
    token,
  };
}

async function productionMain(root: string): Promise<void> {
  const { event, statusTargetUrl, token } = await productionContext();
  const headSha = event.pull_request.head.sha;
  await githubStatus(
    headSha,
    'pending',
    'Validating trusted readiness policy.',
    statusTargetUrl,
    token,
  );
  try {
    const input = await productionInput(root, event, token);
    const errors = [
      ...validateReadinessScopePullRequest(input),
      ...validateTrustRootExecutionDependenciesForCommit(root, input.headSha),
      ...(await headReadinessErrors(root, input)),
    ];
    if (errors.length === 0) {
      const freshReviews = await githubReviews(event.pull_request.number, token);
      const currentResult = githubPullResponseSchema.safeParse(
        await githubJson(
          `https://api.github.com/repos/Noveum/orbit/pulls/${event.pull_request.number}`,
          token,
        ),
      );
      if (!currentResult.success)
        throw new Error('Trusted scope policy pull request data is invalid.');
      errors.push(
        ...validateFinalReadinessScopeState(
          input,
          freshReviews,
          currentResult.data.base.sha,
          currentResult.data.head.sha,
        ),
      );
    }
    if (errors.length > 0) {
      for (const error of errors) console.log(error);
      await githubStatus(
        headSha,
        'failure',
        'Trusted readiness policy failed.',
        statusTargetUrl,
        token,
      );
      process.exitCode = 1;
      return;
    }
    await githubStatus(
      headSha,
      'success',
      'Trusted readiness policy passed.',
      statusTargetUrl,
      token,
    );
    console.log('OK: trusted readiness pull request policy passed.');
  } catch {
    try {
      await githubStatus(
        headSha,
        'failure',
        'Trusted readiness policy failed.',
        statusTargetUrl,
        token,
      );
    } catch {
      process.exitCode = 1;
    }
    throw new Error('Trusted readiness policy failed.');
  }
}

async function main(): Promise<void> {
  const root = `${import.meta.dir}/..`;
  const inputPath = process.argv[2];
  if (inputPath === undefined) {
    await productionMain(root);
    return;
  }
  const result = readinessScopePrInputSchema.safeParse(
    parsedJson(await readFile(inputPath, 'utf8')),
  );
  if (!result.success) throw new Error('Injected scope policy fixture is invalid.');
  const input = result.data;
  const errors = validateReadinessScopePullRequest(input);
  if (errors.length > 0) {
    for (const error of errors) console.log(error);
    process.exit(1);
  }
  console.log('OK: readiness scope pull request policy passed.');
}

if (import.meta.main) await main();
