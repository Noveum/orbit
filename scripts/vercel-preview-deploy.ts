import {
  type GithubPreviewPullRequest,
  type GithubPreviewRepository,
  type GithubPreviewWorkflowRun,
  githubPreviewFilesSchema,
  githubPreviewPullRequestSchema,
  githubPreviewPullRequestTargetEventSchema,
  githubPreviewRefSchema,
  githubPreviewRepositoryDispatchEventSchema,
  githubPreviewWorkflowRunEventSchema,
  githubPreviewWorkflowRunsSchema,
  githubPreviewWorkflowSchema,
  gitShaSchema,
  type VercelCanceledDeployment,
  type VercelCreatedDeployment,
  type VercelDeployment,
  type VercelDeploymentDetail,
  type VercelPreviewEnvironment,
  vercelCanceledDeploymentSchema,
  vercelCreatedDeploymentSchema,
  vercelDeploymentDetailSchema,
  vercelDeploymentsPageSchema,
  vercelPreviewEnvironmentSchema,
  vercelProjectSchema,
} from '../packages/shared/src/validators/index.ts';
import {
  isActiveVercelDeployment,
  isPreviewEligible,
  isReadyVercelDeployment,
  isSameRepositoryPullRequest,
  isWebPreviewFile,
  matchesVercelPullRequest,
} from './vercel-preview-policy.ts';

const GITHUB_API = 'https://api.github.com';
const VERCEL_API = 'https://api.vercel.com';
const REQUEST_TIMEOUT_MS = 15_000;
const CONTROLLER_TIMEOUT_MS = 23 * 60 * 1000;
const MAX_READ_ATTEMPTS = 3;
const MAX_RETRY_SLEEP_MS = 30_000;
const MAX_VERCEL_PAGES = 20;
const USER_AGENT = 'orbit-vercel-preview-reconciler';
const ORBIT_METADATA_KEYS = [
  'orbitDeploymentReason',
  'orbitGithubHeadRef',
  'orbitGithubHeadSha',
  'orbitGithubPrNumber',
  'orbitGithubRepositoryId',
  'orbitGithubWorkflowRunId',
] as const;

type PreviewReason =
  | 'event-not-actionable'
  | 'workflow-run-unassociated'
  | 'stale-event'
  | 'repository-mismatch'
  | 'fork-pull-request'
  | 'base-mismatch'
  | 'preview-eligible'
  | 'no-active-deployment'
  | 'web-unaffected'
  | 'ci-unavailable'
  | 'ci-not-current'
  | 'ci-not-green'
  | 'ready-deployment-reused'
  | 'active-deployment-reused'
  | 'created-ready'
  | 'canceled-active';

type SkippedReason = Exclude<
  PreviewReason,
  'ready-deployment-reused' | 'active-deployment-reused' | 'created-ready' | 'canceled-active'
>;

export type PreviewResult =
  | {
      readonly kind: 'skipped';
      readonly pullRequestNumber: number;
      readonly reason: SkippedReason;
    }
  | {
      readonly kind: 'created';
      readonly pullRequestNumber: number;
      readonly reason: 'ready-deployment-reused' | 'active-deployment-reused' | 'created-ready';
      readonly deploymentId: string;
      readonly url: string;
    }
  | {
      readonly kind: 'canceled';
      readonly pullRequestNumber: number;
      readonly reason: 'canceled-active';
      readonly deploymentId: string;
      readonly url: string;
    };

export type PreviewRuntime = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readText: (path: string) => Promise<string>;
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly scheduleTimeout: (callback: () => void, milliseconds: number) => () => void;
  readonly now: () => number;
  readonly log: (message: string) => void;
};

type ControllerRuntime = PreviewRuntime & {
  readonly assertBudget: (duration: number) => void;
};

type PreviewCandidate = {
  readonly number: number;
  readonly expectedHeadSha: string | null;
};

type RequestKind = 'github' | 'vercel';

class RequestFailure extends Error {
  readonly status: number | null;
  readonly ambiguousMutation: boolean;
  readonly retryDelay: number | null;

  constructor(
    message: string,
    status: number | null,
    ambiguousMutation = false,
    retryDelay: number | null = null,
  ) {
    super(message);
    this.status = status;
    this.ambiguousMutation = ambiguousMutation;
    this.retryDelay = retryDelay;
  }
}

type ResponseSchema<T> = {
  readonly safeParse: (
    value: unknown,
  ) => { readonly success: true; readonly data: T } | { readonly success: false };
};

function safeMessage(value: unknown, environment?: VercelPreviewEnvironment): string {
  const initial = value instanceof Error ? value.message : String(value);
  const secrets = environment ? [environment.GITHUB_TOKEN, environment.VERCEL_TOKEN] : [];
  return secrets
    .reduce((message, secret) => message.split(secret).join('[redacted]'), initial)
    .slice(0, 512);
}

function fail(message: string): never {
  throw new Error(message);
}

function withControllerDeadline(runtime: PreviewRuntime): ControllerRuntime {
  let previousTime = runtime.now();
  const deadline = previousTime + CONTROLLER_TIMEOUT_MS;
  const assertBudget = (duration: number) => {
    const currentTime = runtime.now();
    if (currentTime < previousTime || duration < 0 || currentTime > deadline - duration) {
      fail('controller-timeout');
    }
    previousTime = currentTime;
  };
  return {
    ...runtime,
    assertBudget,
    readText: async (path) => {
      assertBudget(0);
      const text = await runtime.readText(path);
      assertBudget(0);
      return text;
    },
    fetch: async (input, init) => {
      assertBudget(REQUEST_TIMEOUT_MS);
      const response = await runtime.fetch(input, init);
      assertBudget(0);
      return response;
    },
    sleep: async (milliseconds) => {
      assertBudget(milliseconds);
      await runtime.sleep(milliseconds);
      assertBudget(0);
    },
  };
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${label} returned invalid JSON`);
  }
}

function retryAfterMilliseconds(response: Response, runtime: PreviewRuntime): number | null {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    const milliseconds = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - runtime.now();
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > MAX_RETRY_SLEEP_MS) {
      return fail('retry wait is invalid or excessive');
    }
    return milliseconds;
  }
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  if (remaining === '0' && reset !== null) {
    const milliseconds = Number(reset) * 1000 - runtime.now();
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > MAX_RETRY_SLEEP_MS) {
      return fail('retry wait is invalid or excessive');
    }
    return milliseconds;
  }
  return null;
}

function shouldRetryRead(response: Response, kind: RequestKind): boolean {
  if (response.status === 429 || response.status >= 500) return true;
  if (kind !== 'github' || response.status !== 403) return false;
  return (
    response.headers.has('retry-after') ||
    (response.headers.get('x-ratelimit-remaining') === '0' &&
      response.headers.has('x-ratelimit-reset'))
  );
}

function requestHeaders(
  environment: VercelPreviewEnvironment,
  kind: RequestKind,
  includesBody: boolean,
): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${kind === 'github' ? environment.GITHUB_TOKEN : environment.VERCEL_TOKEN}`,
    'User-Agent': USER_AGENT,
  });
  if (kind === 'github') {
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
  }
  if (includesBody) headers.set('Content-Type', 'application/json');
  return headers;
}

function parseSuccessfulResponse<T>(
  response: Response,
  text: string,
  schema: ResponseSchema<T>,
  safeRead: boolean,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestFailure('response returned invalid JSON', response.status, !safeRead);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new RequestFailure('response did not match its schema', response.status, !safeRead);
  }
  return result.data;
}

function interpretResponse<T>(
  runtime: ControllerRuntime,
  kind: RequestKind,
  response: Response,
  text: string,
  schema: ResponseSchema<T>,
  safeRead: boolean,
): T {
  if (response.status >= 300 && response.status < 400) {
    throw new RequestFailure('redirect rejected', response.status);
  }
  if (response.ok) return parseSuccessfulResponse(response, text, schema, safeRead);
  const retryDelay =
    safeRead && shouldRetryRead(response, kind)
      ? (retryAfterMilliseconds(response, runtime) ?? 1000)
      : null;
  const ambiguousMutation =
    !safeRead && (response.status === 409 || response.status === 429 || response.status >= 500);
  throw new RequestFailure(
    `request failed with status ${response.status}`,
    response.status,
    ambiguousMutation,
    retryDelay,
  );
}

async function requestJsonAttempt<T>(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  kind: RequestKind,
  url: string,
  schema: ResponseSchema<T>,
  method: 'GET' | 'POST' | 'PATCH',
  body: unknown,
): Promise<T> {
  const safeRead = method === 'GET';
  const controller = new AbortController();
  const cancelTimeout = runtime.scheduleTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const request: RequestInit = {
    method,
    headers: requestHeaders(environment, kind, body !== undefined),
    redirect: 'manual',
    signal: controller.signal,
  };
  if (body !== undefined) request.body = JSON.stringify(body);
  try {
    let response: Response;
    try {
      response = await runtime.fetch(url, request);
    } catch (error) {
      throw new RequestFailure(
        safeMessage(error, environment),
        null,
        !safeRead,
        safeRead ? 1000 : null,
      );
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new RequestFailure(
        safeMessage(error, environment),
        response.status,
        !safeRead,
        safeRead ? 1000 : null,
      );
    }
    return interpretResponse(runtime, kind, response, text, schema, safeRead);
  } finally {
    cancelTimeout();
  }
}

async function requestJson<T>(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  kind: RequestKind,
  url: string,
  schema: ResponseSchema<T>,
  options: { readonly method?: 'GET' | 'POST' | 'PATCH'; readonly body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const safeRead = method === 'GET';
  const maximumAttempts = safeRead ? MAX_READ_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await requestJsonAttempt(
        runtime,
        environment,
        kind,
        url,
        schema,
        method,
        options.body,
      );
    } catch (error) {
      const retryDelay = error instanceof RequestFailure ? error.retryDelay : null;
      if (attempt === maximumAttempts || retryDelay === null) throw error;
      await runtime.sleep(retryDelay);
    }
  }
  return fail('read attempts exhausted');
}

function githubUrl(repositorySlug: string, path: string): string {
  return `${GITHUB_API}/repos/${repositorySlug}${path}`;
}

function vercelUrl(path: string, query: Readonly<Record<string, string>>): string {
  const url = new URL(path, VERCEL_API);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

async function verifyVercelProjectIdentity(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
): Promise<void> {
  const projectId = encodeURIComponent(environment.VERCEL_PROJECT_ID);
  const project = await requestJson(
    runtime,
    environment,
    'vercel',
    vercelUrl(`/v9/projects/${projectId}`, { teamId: environment.VERCEL_TEAM_ID }),
    vercelProjectSchema,
  );
  if (
    project.id !== environment.VERCEL_PROJECT_ID ||
    project.name !== environment.VERCEL_PROJECT_NAME ||
    project.accountId !== environment.VERCEL_TEAM_ID
  ) {
    fail('Vercel project identity mismatch');
  }
}

function repositorySlugMatches(
  repository: GithubPreviewRepository,
  configuredSlug: string,
): boolean {
  return (
    `${repository.owner.login}/${repository.name}`.toLowerCase() === configuredSlug.toLowerCase()
  );
}

function skipped(pullRequestNumber: number, reason: SkippedReason): PreviewResult {
  return { kind: 'skipped', pullRequestNumber, reason };
}

function resolveCandidates(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  eventValue: unknown,
): {
  readonly repository: GithubPreviewRepository;
  readonly candidates: readonly PreviewCandidate[];
} {
  if (environment.GITHUB_EVENT_NAME === 'pull_request_target') {
    const event = githubPreviewPullRequestTargetEventSchema.parse(eventValue);
    if (event.number !== event.pull_request.number) fail('event pull request numbers disagree');
    return {
      repository: event.repository,
      candidates: [{ number: event.number, expectedHeadSha: event.pull_request.head.sha }],
    };
  }
  if (environment.GITHUB_EVENT_NAME === 'repository_dispatch') {
    const event = githubPreviewRepositoryDispatchEventSchema.parse(eventValue);
    return {
      repository: event.repository,
      candidates: [{ number: event.client_payload.pull_request, expectedHeadSha: null }],
    };
  }
  const event = githubPreviewWorkflowRunEventSchema.parse(eventValue);
  const run = event.workflow_run;
  if (
    event.action !== 'completed' ||
    run.name !== 'CI' ||
    run.event !== 'pull_request' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  ) {
    runtime.log('event-not-actionable');
    return { repository: event.repository, candidates: [] };
  }
  if (run.pull_requests.length === 0) {
    runtime.log('workflow-run-unassociated');
    return { repository: event.repository, candidates: [] };
  }
  const numbers = [...new Set(run.pull_requests.map(({ number }) => number))].sort(
    (left, right) => left - right,
  );
  if (numbers.length > 1) {
    runtime.log('workflow-run-ambiguous-associations');
    return { repository: event.repository, candidates: [] };
  }
  return {
    repository: event.repository,
    candidates: numbers.map((number) => ({ number, expectedHeadSha: run.head_sha })),
  };
}

function fetchPullRequest(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  number: number,
) {
  return requestJson(
    runtime,
    environment,
    'github',
    githubUrl(environment.GITHUB_REPOSITORY, `/pulls/${number}`),
    githubPreviewPullRequestSchema,
  );
}

type CiProof =
  | { readonly ok: true; readonly workflowRunId: number; readonly mainSha: string }
  | { readonly ok: false; readonly reason: 'ci-unavailable' | 'ci-not-current' | 'ci-not-green' };

function newestWorkflowRun(
  runs: readonly GithubPreviewWorkflowRun[],
): GithubPreviewWorkflowRun | null {
  let newest: GithubPreviewWorkflowRun | null = null;
  for (const run of runs) {
    if (newest === null) {
      newest = run;
      continue;
    }
    const timeDifference = Date.parse(run.created_at) - Date.parse(newest.created_at);
    if (timeDifference > 0 || (timeDifference === 0 && run.id > newest.id)) newest = run;
  }
  return newest;
}

function runAssociationMatches(
  run: GithubPreviewWorkflowRun,
  pullRequest: GithubPreviewPullRequest,
  mainSha: string,
): boolean {
  return run.pull_requests.some(
    (association) =>
      association.number === pullRequest.number &&
      association.head.sha === pullRequest.head.sha &&
      association.head.ref === pullRequest.head.ref &&
      association.head.repo.id === pullRequest.head.repo.id &&
      association.base.sha === mainSha &&
      association.base.ref === pullRequest.base.ref &&
      association.base.repo.id === pullRequest.base.repo.id,
  );
}

async function fetchWorkflowRuns(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  workflowId: number,
  headSha: string,
): Promise<readonly GithubPreviewWorkflowRun[]> {
  const runsUrl = new URL(
    githubUrl(environment.GITHUB_REPOSITORY, `/actions/workflows/${workflowId}/runs`),
  );
  runsUrl.searchParams.set('event', 'pull_request');
  runsUrl.searchParams.set('head_sha', headSha);
  runsUrl.searchParams.set('per_page', '100');
  const runs: GithubPreviewWorkflowRun[] = [];
  const seenRunIds = new Set<number>();
  let expectedTotal: number | null = null;
  for (let pageNumber = 1; pageNumber <= 10; pageNumber += 1) {
    runsUrl.searchParams.set('page', String(pageNumber));
    const page = await requestJson(
      runtime,
      environment,
      'github',
      runsUrl.toString(),
      githubPreviewWorkflowRunsSchema,
    );
    if (expectedTotal === null) expectedTotal = page.total_count;
    if (page.total_count !== expectedTotal) fail('workflow run total_count changed between pages');
    for (const run of page.workflow_runs) {
      if (seenRunIds.has(run.id)) fail('workflow run pagination returned a duplicate ID');
      seenRunIds.add(run.id);
      runs.push(run);
    }
    if (runs.length > expectedTotal) fail('workflow run total_count is inconsistent');
    if (runs.length === expectedTotal) return runs;
  }
  return fail('workflow run pagination is incomplete');
}

async function proveCurrentCi(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
): Promise<CiProof> {
  const workflow = await requestJson(
    runtime,
    environment,
    'github',
    githubUrl(environment.GITHUB_REPOSITORY, '/actions/workflows/ci.yml'),
    githubPreviewWorkflowSchema,
  );
  if (
    workflow.name !== 'CI' ||
    workflow.path !== '.github/workflows/ci.yml' ||
    workflow.state !== 'active'
  ) {
    return { ok: false, reason: 'ci-not-current' };
  }
  const main = await requestJson(
    runtime,
    environment,
    'github',
    githubUrl(environment.GITHUB_REPOSITORY, '/git/ref/heads/main'),
    githubPreviewRefSchema,
  );
  const runs = await fetchWorkflowRuns(runtime, environment, workflow.id, pullRequest.head.sha);
  const newest = newestWorkflowRun(runs);
  if (newest === null) return { ok: false, reason: 'ci-unavailable' };
  if (
    newest.workflow_id !== workflow.id ||
    newest.event !== 'pull_request' ||
    newest.head_sha !== pullRequest.head.sha ||
    !runAssociationMatches(newest, pullRequest, main.object.sha)
  ) {
    return { ok: false, reason: 'ci-not-current' };
  }
  if (newest.status !== 'completed' || newest.conclusion !== 'success') {
    return { ok: false, reason: 'ci-not-green' };
  }
  return { ok: true, workflowRunId: newest.id, mainSha: main.object.sha };
}

async function affectsWeb(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequestNumber: number,
): Promise<boolean> {
  const url = new URL(
    githubUrl(environment.GITHUB_REPOSITORY, `/pulls/${pullRequestNumber}/files`),
  );
  url.searchParams.set('per_page', '100');
  for (let pageNumber = 1; pageNumber <= 30; pageNumber += 1) {
    url.searchParams.set('page', String(pageNumber));
    const files = await requestJson(
      runtime,
      environment,
      'github',
      url.toString(),
      githubPreviewFilesSchema,
    );
    if (files.some(isWebPreviewFile)) return true;
    if (files.length < 100) return false;
  }
  return fail('pull request files pagination is incomplete');
}

function deploymentMetadata(pullRequest: GithubPreviewPullRequest, workflowRunId: number) {
  return {
    orbitDeploymentReason: 'ci-green-pr-preview',
    orbitGithubHeadRef: pullRequest.head.ref,
    orbitGithubHeadSha: pullRequest.head.sha,
    orbitGithubPrNumber: String(pullRequest.number),
    orbitGithubRepositoryId: String(pullRequest.base.repo.id),
    orbitGithubWorkflowRunId: String(workflowRunId),
  };
}

async function listDeployments(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
  includeSha: boolean,
): Promise<readonly VercelDeployment[]> {
  const query: Record<string, string> = {
    teamId: environment.VERCEL_TEAM_ID,
    projectId: environment.VERCEL_PROJECT_ID,
    branch: pullRequest.head.ref,
    limit: '100',
  };
  if (includeSha) query['sha'] = pullRequest.head.sha;
  const deployments: VercelDeployment[] = [];
  const seenCursors = new Set<number>();
  let cursor: number | null = null;
  for (let pageNumber = 1; pageNumber <= MAX_VERCEL_PAGES; pageNumber += 1) {
    const pageQuery = { ...query };
    if (cursor !== null) pageQuery['until'] = String(cursor);
    const page = await requestJson(
      runtime,
      environment,
      'vercel',
      vercelUrl('/v7/deployments', pageQuery),
      vercelDeploymentsPageSchema,
    );
    for (const deployment of page.deployments) {
      assertSafeDeploymentId(deployment.uid, environment);
    }
    deployments.push(...page.deployments);
    const next = page.pagination.next;
    if (next === null) return deployments;
    if (seenCursors.has(next)) fail('Vercel deployment pagination repeated a cursor');
    seenCursors.add(next);
    cursor = next;
  }
  return fail('Vercel deployment pagination is incomplete');
}

function detailIdentityMatches(
  detail: VercelDeploymentDetail,
  id: string,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
  expectedMetadata: Readonly<Record<string, unknown>>,
  headSha?: string,
): boolean {
  const comparable = comparableDeployment(detail);
  return (
    detail.id === id &&
    ORBIT_METADATA_KEYS.every((key) => {
      const expected = expectedMetadata[key];
      const actual = detail.meta[key];
      return expected !== undefined && expected !== null && String(actual) === String(expected);
    }) &&
    matchesVercelPullRequest(comparable, pullRequest, environment.VERCEL_PROJECT_ID, headSha)
  );
}

function assertSafeDeploymentUrl(url: string, environment: VercelPreviewEnvironment): string {
  if (url.includes(environment.GITHUB_TOKEN) || url.includes(environment.VERCEL_TOKEN)) {
    fail('deployment URL is unsafe');
  }
  return url;
}

function assertSafeDeploymentId(id: string, environment: VercelPreviewEnvironment): string {
  if (id.includes(environment.GITHUB_TOKEN) || id.includes(environment.VERCEL_TOKEN)) {
    fail('deployment ID is unsafe');
  }
  return id;
}

function deploymentPathSegment(id: string, environment: VercelPreviewEnvironment): string {
  return encodeURIComponent(assertSafeDeploymentId(id, environment));
}

function assertSafePreviewResults(
  results: readonly PreviewResult[],
  environment: VercelPreviewEnvironment,
): readonly PreviewResult[] {
  const serialized = JSON.stringify(results);
  if (
    serialized.includes(environment.GITHUB_TOKEN) ||
    serialized.includes(environment.VERCEL_TOKEN)
  ) {
    fail('preview result is unsafe');
  }
  return results;
}

type DeploymentPollResult =
  | { readonly kind: 'ready'; readonly deployment: VercelDeploymentDetail }
  | { readonly kind: 'interrupted'; readonly result: PreviewResult };

function comparableDeployment(detail: VercelDeploymentDetail): VercelDeployment {
  return {
    uid: detail.id,
    projectId: detail.projectId,
    url: detail.url,
    target: detail.target,
    readyState: detail.readyState,
    meta: detail.meta,
  };
}

function trustedCurrentPullRequest(
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
): boolean {
  return (
    repositorySlugMatches(pullRequest.base.repo, environment.GITHUB_REPOSITORY) &&
    isSameRepositoryPullRequest(pullRequest) &&
    pullRequest.base.ref === 'main'
  );
}

async function cancelPolledDeployment(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
  deployment: VercelDeployment,
  intent: CancellationIntent,
): Promise<PreviewResult> {
  return (
    (await cancelOneActiveDeployment(runtime, environment, pullRequest, deployment, intent)) ??
    skipped(pullRequest.number, 'no-active-deployment')
  );
}

async function pollingInterruption(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  originalPullRequest: GithubPreviewPullRequest,
  currentPullRequest: GithubPreviewPullRequest,
  deployment: VercelDeployment,
): Promise<PreviewResult | null> {
  if (!trustedCurrentPullRequest(environment, currentPullRequest)) {
    return skipped(originalPullRequest.number, 'stale-event');
  }
  if (pullRequestIdentityMatches(originalPullRequest, currentPullRequest)) {
    if (currentPullRequest.state === 'open' && isPreviewEligible(currentPullRequest)) return null;
    return await cancelPolledDeployment(
      runtime,
      environment,
      currentPullRequest,
      deployment,
      'ineligible-current',
    );
  }
  if (!supersedingHeadMatches(originalPullRequest, currentPullRequest)) {
    return skipped(originalPullRequest.number, 'stale-event');
  }
  return await cancelPolledDeployment(
    runtime,
    environment,
    originalPullRequest,
    deployment,
    'superseded-head',
  );
}

async function pollDeployment(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
  deploymentId: string,
  expectedMetadata: Readonly<Record<string, unknown>>,
): Promise<DeploymentPollResult> {
  for (let detailRequest = 0; detailRequest <= 240; detailRequest += 1) {
    const encodedDeploymentId = deploymentPathSegment(deploymentId, environment);
    const detail = await requestJson(
      runtime,
      environment,
      'vercel',
      vercelUrl(`/v13/deployments/${encodedDeploymentId}`, {
        teamId: environment.VERCEL_TEAM_ID,
      }),
      vercelDeploymentDetailSchema,
    );
    assertSafeDeploymentId(detail.id, environment);
    assertSafeDeploymentUrl(detail.url, environment);
    if (
      !detailIdentityMatches(
        detail,
        deploymentId,
        environment,
        pullRequest,
        expectedMetadata,
        pullRequest.head.sha,
      )
    ) {
      return fail('deployment detail identity drift');
    }
    if (detail.readyState === 'READY') return { kind: 'ready', deployment: detail };
    const comparable = comparableDeployment(detail);
    if (!isActiveVercelDeployment(comparable))
      return fail(`deployment ended in ${detail.readyState}`);
    const currentPullRequest = await fetchPullRequest(runtime, environment, pullRequest.number);
    const interruption = await pollingInterruption(
      runtime,
      environment,
      pullRequest,
      currentPullRequest,
      comparable,
    );
    if (interruption) return { kind: 'interrupted', result: interruption };
    if (detailRequest === 240) return fail('deployment polling timed out');
    await runtime.sleep(5000);
  }
  return fail('deployment polling timed out');
}

function repositoryIdentityMatches(
  first: GithubPreviewRepository,
  current: GithubPreviewRepository,
): boolean {
  return (
    first.id === current.id &&
    first.name.toLowerCase() === current.name.toLowerCase() &&
    first.owner.login.toLowerCase() === current.owner.login.toLowerCase()
  );
}

function pullRequestIdentityMatches(
  first: GithubPreviewPullRequest,
  current: GithubPreviewPullRequest,
): boolean {
  return (
    first.number === current.number &&
    first.head.sha === current.head.sha &&
    first.head.ref === current.head.ref &&
    repositoryIdentityMatches(first.head.repo, current.head.repo) &&
    first.base.ref === current.base.ref &&
    repositoryIdentityMatches(first.base.repo, current.base.repo)
  );
}

function supersedingHeadMatches(
  first: GithubPreviewPullRequest,
  current: GithubPreviewPullRequest,
): boolean {
  return (
    first.number === current.number &&
    first.head.sha !== current.head.sha &&
    first.head.ref === current.head.ref &&
    repositoryIdentityMatches(first.head.repo, current.head.repo) &&
    first.base.ref === current.base.ref &&
    repositoryIdentityMatches(first.base.repo, current.base.repo)
  );
}

function currentStateMatches(
  first: GithubPreviewPullRequest,
  current: GithubPreviewPullRequest,
): boolean {
  const firstLabels = first.labels
    .map(({ name }) => name)
    .sort()
    .join('\n');
  const currentLabels = current.labels
    .map(({ name }) => name)
    .sort()
    .join('\n');
  return (
    pullRequestIdentityMatches(first, current) &&
    first.state === current.state &&
    first.draft === current.draft &&
    firstLabels === currentLabels
  );
}

type CancellationIntent = 'eligible-current' | 'ineligible-current' | 'superseded-head';

function cancellationPreflightFailure(
  environment: VercelPreviewEnvironment,
  expectedPullRequest: GithubPreviewPullRequest,
  currentPullRequest: GithubPreviewPullRequest,
  intent: CancellationIntent,
): SkippedReason | null {
  if (!trustedCurrentPullRequest(environment, currentPullRequest)) return 'stale-event';
  if (intent === 'superseded-head') {
    return supersedingHeadMatches(expectedPullRequest, currentPullRequest) ? null : 'stale-event';
  }
  if (!pullRequestIdentityMatches(expectedPullRequest, currentPullRequest)) return 'stale-event';
  const eligible = currentPullRequest.state === 'open' && isPreviewEligible(currentPullRequest);
  if (intent === 'eligible-current') return eligible ? null : 'stale-event';
  return eligible ? 'preview-eligible' : null;
}

async function cancelOneActiveDeployment(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
  item: VercelDeployment,
  intent: CancellationIntent,
): Promise<PreviewResult | null> {
  let canceled: VercelCanceledDeployment;
  const encodedDeploymentId = deploymentPathSegment(item.uid, environment);
  await verifyVercelProjectIdentity(runtime, environment);
  const currentPullRequest = await fetchPullRequest(runtime, environment, pullRequest.number);
  const preflightFailure = cancellationPreflightFailure(
    environment,
    pullRequest,
    currentPullRequest,
    intent,
  );
  if (preflightFailure !== null) return skipped(pullRequest.number, preflightFailure);
  try {
    canceled = await requestJson(
      runtime,
      environment,
      'vercel',
      vercelUrl(`/v12/deployments/${encodedDeploymentId}/cancel`, {
        teamId: environment.VERCEL_TEAM_ID,
      }),
      vercelCanceledDeploymentSchema,
      { method: 'PATCH' },
    );
  } catch (error) {
    if (!(error instanceof RequestFailure)) throw error;
    if (error.status !== 400 && !error.ambiguousMutation) throw error;
    const detail = await requestJson(
      runtime,
      environment,
      'vercel',
      vercelUrl(`/v13/deployments/${encodedDeploymentId}`, {
        teamId: environment.VERCEL_TEAM_ID,
      }),
      vercelDeploymentDetailSchema,
    );
    assertSafeDeploymentId(detail.id, environment);
    assertSafeDeploymentUrl(detail.url, environment);
    if (!detailIdentityMatches(detail, item.uid, environment, pullRequest, item.meta)) {
      fail('canceled deployment identity drift');
    }
    if (isActiveVercelDeployment({ ...item, readyState: detail.readyState })) {
      fail('deployment remains active after cancel race');
    }
    return null;
  }
  assertSafeDeploymentId(canceled.id, environment);
  if (
    canceled.readyState !== 'CANCELED' ||
    !detailIdentityMatches(canceled, item.uid, environment, pullRequest, item.meta)
  ) {
    fail('canceled deployment identity drift');
  }
  return {
    kind: 'canceled',
    pullRequestNumber: pullRequest.number,
    reason: 'canceled-active',
    deploymentId: canceled.id,
    url: assertSafeDeploymentUrl(canceled.url, environment),
  };
}

type PriorHeadCancellation = {
  readonly current: boolean;
  readonly results: readonly PreviewResult[];
};

function isActivePriorHeadDeployment(
  deployment: VercelDeployment,
  pullRequest: GithubPreviewPullRequest,
  projectId: string,
): boolean {
  const headSha = deployment.meta['orbitGithubHeadSha'];
  const parsedHeadSha = gitShaSchema.safeParse(headSha);
  return (
    isActiveVercelDeployment(deployment) &&
    matchesVercelPullRequest(deployment, pullRequest, projectId) &&
    parsedHeadSha.success &&
    parsedHeadSha.data !== pullRequest.head.sha
  );
}

async function cancelPriorHeadDeployments(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
): Promise<PriorHeadCancellation> {
  const listed = await listDeployments(runtime, environment, pullRequest, false);
  const activePriorHeads = listed
    .filter((deployment) =>
      isActivePriorHeadDeployment(deployment, pullRequest, environment.VERCEL_PROJECT_ID),
    )
    .sort((left, right) => left.uid.localeCompare(right.uid));
  const results: PreviewResult[] = [];
  for (const deployment of activePriorHeads) {
    const currentPullRequest = await fetchPullRequest(runtime, environment, pullRequest.number);
    const stateIsCurrent =
      currentStateMatches(pullRequest, currentPullRequest) &&
      repositorySlugMatches(currentPullRequest.base.repo, environment.GITHUB_REPOSITORY) &&
      isSameRepositoryPullRequest(currentPullRequest) &&
      currentPullRequest.base.ref === 'main' &&
      currentPullRequest.state === 'open' &&
      isPreviewEligible(currentPullRequest);
    if (!stateIsCurrent) {
      return {
        current: false,
        results: results.length > 0 ? results : [skipped(pullRequest.number, 'stale-event')],
      };
    }
    const result = await cancelOneActiveDeployment(
      runtime,
      environment,
      currentPullRequest,
      deployment,
      'eligible-current',
    );
    if (result?.kind === 'skipped') {
      return {
        current: false,
        results: results.length > 0 ? results : [result],
      };
    }
    if (result) results.push(result);
  }
  return { current: true, results };
}

function activeCancellationFailure(
  environment: VercelPreviewEnvironment,
  expectedPullRequest: GithubPreviewPullRequest,
  currentPullRequest: GithubPreviewPullRequest,
): SkippedReason | null {
  const identityIsCurrent =
    pullRequestIdentityMatches(expectedPullRequest, currentPullRequest) &&
    repositorySlugMatches(currentPullRequest.base.repo, environment.GITHUB_REPOSITORY) &&
    isSameRepositoryPullRequest(currentPullRequest);
  if (!identityIsCurrent) return 'stale-event';
  return currentPullRequest.state === 'open' && isPreviewEligible(currentPullRequest)
    ? 'preview-eligible'
    : null;
}

async function cancelActiveDeployments(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
): Promise<readonly PreviewResult[]> {
  const listed = await listDeployments(runtime, environment, pullRequest, false);
  const active = listed
    .filter(
      (item) =>
        isActiveVercelDeployment(item) &&
        matchesVercelPullRequest(item, pullRequest, environment.VERCEL_PROJECT_ID),
    )
    .sort((left, right) => left.uid.localeCompare(right.uid));
  if (active.length === 0) {
    return [skipped(pullRequest.number, 'no-active-deployment')];
  }
  const results: PreviewResult[] = [];
  for (const item of active) {
    const finalPullRequest = await fetchPullRequest(runtime, environment, pullRequest.number);
    const failure = activeCancellationFailure(environment, pullRequest, finalPullRequest);
    if (failure !== null) {
      return results.length > 0 ? results : [skipped(pullRequest.number, failure)];
    }
    const result = await cancelOneActiveDeployment(
      runtime,
      environment,
      finalPullRequest,
      item,
      'ineligible-current',
    );
    if (result?.kind === 'skipped') return results.length > 0 ? results : [result];
    if (result) results.push(result);
  }
  return results.length > 0 ? results : [skipped(pullRequest.number, 'no-active-deployment')];
}

async function reusedDeploymentResult(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
  deployments: readonly VercelDeployment[],
): Promise<PreviewResult | null> {
  const ready = deployments.find(isReadyVercelDeployment);
  if (ready) {
    let final: { readonly id: string; readonly url: string };
    if (ready.url) {
      final = { id: ready.uid, url: assertSafeDeploymentUrl(ready.url, environment) };
    } else {
      const polled = await pollDeployment(runtime, environment, pullRequest, ready.uid, ready.meta);
      if (polled.kind === 'interrupted') return polled.result;
      final = polled.deployment;
    }
    return {
      kind: 'created',
      pullRequestNumber: pullRequest.number,
      reason: 'ready-deployment-reused',
      deploymentId: final.id,
      url: final.url,
    };
  }
  const active = deployments.find(isActiveVercelDeployment);
  if (!active) return null;
  const polled = await pollDeployment(runtime, environment, pullRequest, active.uid, active.meta);
  if (polled.kind === 'interrupted') return polled.result;
  const final = polled.deployment;
  return {
    kind: 'created',
    pullRequestNumber: pullRequest.number,
    reason: 'active-deployment-reused',
    deploymentId: final.id,
    url: final.url,
  };
}

async function observeAmbiguousCreate(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
  preCreateDeploymentIds: ReadonlySet<string>,
): Promise<PreviewResult> {
  for (let observation = 1; observation <= 3; observation += 1) {
    if (observation > 1) await runtime.sleep(2000);
    const observed = await listDeployments(runtime, environment, pullRequest, true);
    const newlyVisible = observed.filter(
      (item) =>
        !preCreateDeploymentIds.has(item.uid) &&
        matchesVercelPullRequest(
          item,
          pullRequest,
          environment.VERCEL_PROJECT_ID,
          pullRequest.head.sha,
        ),
    );
    const result = await reusedDeploymentResult(runtime, environment, pullRequest, newlyVisible);
    if (result) return result;
    if (newlyVisible.length > 0) fail('ambiguous create observed a terminal deployment');
  }
  return fail('ambiguous create produced no new deployment');
}

async function createDeployment(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  pullRequest: GithubPreviewPullRequest,
  forceNew: boolean,
  preCreateDeploymentIds: ReadonlySet<string>,
): Promise<PreviewResult> {
  await verifyVercelProjectIdentity(runtime, environment);
  const ci = await proveCurrentCi(runtime, environment, pullRequest);
  if (!ci.ok) return skipped(pullRequest.number, ci.reason);
  const mutationPullRequest = await fetchPullRequest(runtime, environment, pullRequest.number);
  const mutationStateIsCurrent =
    currentStateMatches(pullRequest, mutationPullRequest) &&
    repositorySlugMatches(mutationPullRequest.base.repo, environment.GITHUB_REPOSITORY) &&
    isSameRepositoryPullRequest(mutationPullRequest) &&
    mutationPullRequest.base.ref === 'main' &&
    mutationPullRequest.state === 'open' &&
    isPreviewEligible(mutationPullRequest);
  if (!mutationStateIsCurrent) return skipped(pullRequest.number, 'stale-event');
  const currentMain = await requestJson(
    runtime,
    environment,
    'github',
    githubUrl(environment.GITHUB_REPOSITORY, '/git/ref/heads/main'),
    githubPreviewRefSchema,
  );
  if (currentMain.object.sha !== ci.mainSha) return skipped(pullRequest.number, 'ci-not-current');
  const metadata = deploymentMetadata(mutationPullRequest, ci.workflowRunId);
  let created: VercelCreatedDeployment;
  try {
    created = await requestJson(
      runtime,
      environment,
      'vercel',
      vercelUrl('/v13/deployments', {
        teamId: environment.VERCEL_TEAM_ID,
        ...(forceNew ? { forceNew: '1' } : {}),
      }),
      vercelCreatedDeploymentSchema,
      {
        method: 'POST',
        body: {
          name: environment.VERCEL_PROJECT_NAME,
          project: environment.VERCEL_PROJECT_ID,
          gitSource: {
            type: 'github',
            repoId: mutationPullRequest.base.repo.id,
            ref: mutationPullRequest.head.ref,
            sha: mutationPullRequest.head.sha,
          },
          meta: metadata,
        },
      },
    );
    assertSafeDeploymentId(created.id, environment);
    assertSafeDeploymentUrl(created.url, environment);
    if (
      !detailIdentityMatches(
        created,
        created.id,
        environment,
        mutationPullRequest,
        metadata,
        mutationPullRequest.head.sha,
      )
    ) {
      throw new RequestFailure('created deployment identity drift', 200, true);
    }
  } catch (error) {
    if (!(error instanceof RequestFailure && error.ambiguousMutation)) throw error;
    return observeAmbiguousCreate(
      runtime,
      environment,
      mutationPullRequest,
      preCreateDeploymentIds,
    );
  }
  const polled = await pollDeployment(
    runtime,
    environment,
    mutationPullRequest,
    created.id,
    created.meta,
  );
  if (polled.kind === 'interrupted') return polled.result;
  const ready = polled.deployment;
  return {
    kind: 'created',
    pullRequestNumber: mutationPullRequest.number,
    reason: 'created-ready',
    deploymentId: ready.id,
    url: ready.url,
  };
}

function candidateIdentityFailure(
  environment: VercelPreviewEnvironment,
  eventRepository: GithubPreviewRepository,
  candidate: PreviewCandidate,
  pullRequest: GithubPreviewPullRequest,
): SkippedReason | null {
  if (
    !repositorySlugMatches(eventRepository, environment.GITHUB_REPOSITORY) ||
    eventRepository.id !== pullRequest.base.repo.id ||
    !repositorySlugMatches(pullRequest.base.repo, environment.GITHUB_REPOSITORY)
  ) {
    return 'repository-mismatch';
  }
  if (candidate.expectedHeadSha !== null && candidate.expectedHeadSha !== pullRequest.head.sha) {
    return 'stale-event';
  }
  if (!isSameRepositoryPullRequest(pullRequest)) return 'fork-pull-request';
  if (pullRequest.base.ref !== 'main') return 'base-mismatch';
  return null;
}

async function reconcileCandidate(
  runtime: ControllerRuntime,
  environment: VercelPreviewEnvironment,
  eventRepository: GithubPreviewRepository,
  candidate: PreviewCandidate,
): Promise<readonly PreviewResult[]> {
  const pullRequest = await fetchPullRequest(runtime, environment, candidate.number);
  const identityFailure = candidateIdentityFailure(
    environment,
    eventRepository,
    candidate,
    pullRequest,
  );
  if (identityFailure) return [skipped(candidate.number, identityFailure)];
  if (pullRequest.state !== 'open' || !isPreviewEligible(pullRequest)) {
    return cancelActiveDeployments(runtime, environment, pullRequest);
  }
  const priorHeadCancellation = await cancelPriorHeadDeployments(runtime, environment, pullRequest);
  if (!priorHeadCancellation.current) return priorHeadCancellation.results;
  const priorHeadResults = priorHeadCancellation.results;
  const ci = await proveCurrentCi(runtime, environment, pullRequest);
  if (!ci.ok) return [...priorHeadResults, skipped(candidate.number, ci.reason)];
  if (!(await affectsWeb(runtime, environment, pullRequest.number))) {
    return [...priorHeadResults, skipped(candidate.number, 'web-unaffected')];
  }
  const listed = await listDeployments(runtime, environment, pullRequest, true);
  const exact = listed.filter((item) =>
    matchesVercelPullRequest(
      item,
      pullRequest,
      environment.VERCEL_PROJECT_ID,
      pullRequest.head.sha,
    ),
  );
  const reused = await reusedDeploymentResult(runtime, environment, pullRequest, exact);
  if (reused) return [...priorHeadResults, reused];
  const finalPullRequest = await fetchPullRequest(runtime, environment, pullRequest.number);
  if (!currentStateMatches(pullRequest, finalPullRequest)) {
    return [...priorHeadResults, skipped(candidate.number, 'stale-event')];
  }
  return [
    ...priorHeadResults,
    await createDeployment(
      runtime,
      environment,
      finalPullRequest,
      exact.length > 0,
      new Set(listed.map(({ uid }) => uid)),
    ),
  ];
}

export async function reconcileVercelPreviews(
  runtime: PreviewRuntime,
): Promise<readonly PreviewResult[]> {
  const environment = vercelPreviewEnvironmentSchema.parse(runtime.env);
  const controllerRuntime = withControllerDeadline(runtime);
  try {
    const eventText = await controllerRuntime.readText(environment.GITHUB_EVENT_PATH);
    const eventValue = parseJsonText(eventText, 'event');
    const resolved = await resolveCandidates(controllerRuntime, environment, eventValue);
    const results: PreviewResult[] = [];
    for (const candidate of resolved.candidates) {
      results.push(
        ...(await reconcileCandidate(
          controllerRuntime,
          environment,
          resolved.repository,
          candidate,
        )),
      );
    }
    return assertSafePreviewResults(results, environment);
  } catch (error) {
    throw new Error(safeMessage(error, environment));
  }
}

if (import.meta.main) {
  const runtime: PreviewRuntime = {
    env: process.env,
    readText: (path) => Bun.file(path).text(),
    fetch: globalThis.fetch,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    scheduleTimeout: (callback, milliseconds) => {
      const timeout = setTimeout(callback, milliseconds);
      return () => clearTimeout(timeout);
    },
    now: () => Date.now(),
    log: (message) => console.log(message),
  };
  try {
    const results = await reconcileVercelPreviews(runtime);
    for (const result of results) runtime.log(JSON.stringify(result));
  } catch (error) {
    console.error(safeMessage(error));
    process.exitCode = 1;
  }
}
