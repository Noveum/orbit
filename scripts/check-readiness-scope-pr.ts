import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  githubPullResponseSchema,
  githubReviewResponseSchema,
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
  validateReadinessLedger,
  validateReadinessScopeArtifacts,
} from './check-readiness-ledger.ts';
import { createProductionReadinessEvidenceVerifier } from './readiness-evidence-verifier.ts';
import type { ReadinessReferenceRegistrySource } from './readiness-reference-registry.ts';
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

export type ReadinessScopePrInput = typeof readinessScopePrInputSchema._output;

function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Scope changes enforce one atomic policy contract.
export function validateReadinessScopePullRequest(input: ReadinessScopePrInput): string[] {
  const errors: string[] = [];
  let basePlan: ReturnType<typeof parsePlanFindings>;
  let headPlan: ReturnType<typeof parsePlanFindings>;
  let baseLedger: ReturnType<typeof parseFindingRows>;
  let headLedger: ReturnType<typeof parseFindingRows>;
  try {
    basePlan = parsePlanFindings(input.base.plan);
    headPlan = parsePlanFindings(input.head.plan);
    baseLedger = parseFindingRows(input.base.ledger);
    headLedger = parseFindingRows(input.head.ledger);
  } catch {
    return ['Readiness scope artifacts have an invalid table structure.'];
  }
  const baseManifestResult = readinessScopeManifestSchema.safeParse(
    parsedJson(input.base.manifest),
  );
  const headManifestResult = readinessScopeManifestSchema.safeParse(
    parsedJson(input.head.manifest),
  );
  if (!(baseManifestResult.success && headManifestResult.success))
    return ['Readiness scope manifest data is invalid.'];
  const baseManifest = baseManifestResult.data as ReadinessScopeManifest;
  const headManifest = headManifestResult.data as ReadinessScopeManifest;
  const artifactErrors = [
    ...validateReadinessScopeArtifacts(basePlan, baseLedger, baseManifest),
    ...validateReadinessScopeArtifacts(headPlan, headLedger, headManifest),
  ];
  if (artifactErrors.length > 0)
    errors.push('Readiness scope artifacts do not match the governed manifest.');
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
  const auditResult = readinessScopeAuditSchema.safeParse(parsedJson(input.head.audit));
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

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Trusted scope policy Git operation failed.');
  return String(result.stdout);
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

function readGitArtifact(root: string, commit: string, path: string): string {
  const object = `${commit}:${path}`;
  const type = git(root, ['cat-file', '-t', object]).trim();
  const size = Number(git(root, ['cat-file', '-s', object]).trim());
  if (type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || size > 1_000_000)
    throw new Error('Trusted scope policy artifact is invalid.');
  return git(root, ['cat-file', 'blob', object]);
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

async function productionInput(
  root: string,
  event: typeof pullRequestTargetEventSchema._output,
  token: string,
): Promise<ReadinessScopePrInput> {
  const baseSha = event.pull_request.base.sha;
  const headSha = event.pull_request.head.sha;
  if (git(root, ['rev-parse', 'HEAD']).trim() !== baseSha)
    throw new Error('Trusted scope policy base checkout mismatch.');
  authenticatedGit(root, ['fetch', '--no-tags', 'origin', `refs/pull/${event.number}/head`], token);
  if (git(root, ['rev-parse', 'FETCH_HEAD']).trim() !== headSha)
    throw new Error('Trusted scope policy head fetch mismatch.');
  const changedFiles = git(root, [
    'diff-tree',
    '-r',
    '--no-commit-id',
    '--name-only',
    '-z',
    '--no-renames',
    baseSha,
    headSha,
  ])
    .split('\0')
    .filter((value) => value.length > 0);
  const artifact = (commit: string, path: string) => readGitArtifact(root, commit, path);
  const artifacts = (commit: string) => ({
    plan: artifact(commit, ALLOWED_SCOPE_FILES[2]),
    ledger: artifact(commit, ALLOWED_SCOPE_FILES[0]),
    manifest: artifact(commit, ALLOWED_SCOPE_FILES[3]),
    audit: artifact(commit, ALLOWED_SCOPE_FILES[1]),
    registry: artifact(commit, REGISTRY_DATA_FILE),
  });
  const reviews = await githubReviews(event.number, token);
  const result = readinessScopePrInputSchema.safeParse({
    baseSha,
    headSha,
    changedFiles,
    base: artifacts(baseSha),
    head: artifacts(headSha),
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
  readonly token: string;
}> {
  const eventPath = process.env['GITHUB_EVENT_PATH'];
  const token = process.env['GITHUB_TOKEN'];
  if (eventPath === undefined || token === undefined || token.length === 0)
    throw new Error('Trusted scope policy context is unavailable.');
  const eventResult = pullRequestTargetEventSchema.safeParse(
    parsedJson(await readFile(eventPath, 'utf8')),
  );
  if (!eventResult.success) throw new Error('Trusted scope policy event is invalid.');
  return { event: eventResult.data, token };
}

async function productionMain(root: string): Promise<void> {
  const { event, token } = await productionContext();
  const headSha = event.pull_request.head.sha;
  await githubStatus(headSha, 'pending', 'Validating trusted readiness policy.', token);
  try {
    const input = await productionInput(root, event, token);
    const errors = [
      ...validateReadinessScopePullRequest(input),
      ...(await headReadinessErrors(root, input)),
    ];
    const currentResult = githubPullResponseSchema.safeParse(
      await githubJson(`https://api.github.com/repos/Noveum/orbit/pulls/${event.number}`, token),
    );
    if (!currentResult.success)
      throw new Error('Trusted scope policy pull request data is invalid.');
    const current = currentResult.data;
    if (current.base.sha !== input.baseSha || current.head.sha !== input.headSha)
      errors.push('Pull request head or base changed during scope validation.');
    if (errors.length > 0) {
      for (const error of errors) console.log(error);
      await githubStatus(headSha, 'failure', 'Trusted readiness policy failed.', token);
      process.exitCode = 1;
      return;
    }
    await githubStatus(headSha, 'success', 'Trusted readiness policy passed.', token);
    console.log('OK: trusted readiness pull request policy passed.');
  } catch {
    try {
      await githubStatus(headSha, 'failure', 'Trusted readiness policy failed.', token);
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
