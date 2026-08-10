import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
]);
const TRUST_POLICY_COMPANION_FILES = new Set([
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/maintainers/readiness-scope-governance.md',
  'packages/db/tests/check-readiness-ledger.test.ts',
  'packages/db/tests/check-readiness-scope-pr.test.ts',
  'packages/db/tests/readiness-production-artifacts.test.ts',
]);
export const TRUSTED_READINESS_WORKFLOW_DEFINITION_DIGEST =
  'sha256:16ee9762d4441a25db918d290e777a0b45418c93d526df4b4bca2ed87a444496';

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

function trustRootPath(path: string): boolean {
  return (
    TRUST_ROOT_FILES.has(path) ||
    path.startsWith('.github/workflows/') ||
    path.startsWith('.github/actions/') ||
    path.endsWith('/package.json') ||
    path === 'bunfig.toml' ||
    path.endsWith('/bunfig.toml')
  );
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
  const artifactErrors = [
    ...validateReadinessScopeArtifacts(basePlan, baseLedger, baseManifest),
    ...validateReadinessScopeArtifacts(headPlan, headLedger, headManifest),
  ];
  if (artifactErrors.length > 0)
    errors.push('Readiness scope artifacts do not match the governed manifest.');
  if (invalidSealTransition(baseLedger, headLedger))
    errors.push('Closure seals require a Ready for closure finding on the trusted base.');
  errors.push(...readyEvidenceErrors(input, baseLedger, headLedger, headRegistryJson.value));
  const semanticChange = semanticSignature(baseManifest) !== semanticSignature(headManifest);
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
  if (!exactChangedFiles(input.changedFiles, ALLOWED_SCOPE_FILES))
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
