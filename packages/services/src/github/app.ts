import { createHash, createSign } from 'node:crypto';
import { internal } from '@orbit/shared';
import { z } from 'zod';

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

const GITHUB_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'orbit',
} as const;

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
}

export interface GithubAppJwtInput {
  readonly appId: string;
  readonly privateKey: string;
  readonly now?: Date;
}

export function githubAppJwt(input: GithubAppJwtInput): string {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: issuedAt - 60, exp: issuedAt + 540, iss: input.appId }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(normalizePrivateKey(input.privateKey)).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const installationTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().min(1).nullish(),
});

const repositorySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().max(255).default(''),
  full_name: z.string().min(1).max(512),
  private: z.boolean().default(false),
  archived: z.boolean().default(false),
  default_branch: z.string().min(1).max(255).default('main'),
  html_url: z.string().max(2048).default(''),
  owner: z.object({ login: z.string().max(255).default('') }).nullish(),
});

const repositoriesSchema = z.object({
  total_count: z.number().int().nonnegative().default(0),
  repositories: z.array(repositorySchema).default([]),
});

const openPullRequestSchema = z.object({
  id: z.number().int().nonnegative().default(0),
  node_id: z.string().max(255).default(''),
  number: z.number().int().positive(),
  title: z.string().max(1024).default(''),
  body: z.string().max(65536).nullable().default(null),
  html_url: z.string().url().max(2048),
  draft: z.boolean().default(false),
  head: z.object({
    ref: z.string().max(1024).default(''),
    sha: z.string().max(255).default(''),
  }),
  base: z.object({ ref: z.string().max(1024).default('') }),
  created_at: z.string().datetime().nullable().default(null),
  updated_at: z.string().datetime().nullable().default(null),
  user: z
    .object({ login: z.string().min(1).max(255), id: z.number().int().nonnegative() })
    .nullable()
    .default(null),
});

const openPullRequestsSchema = z.array(openPullRequestSchema);

const historyCommentSchema = z.object({
  id: z.number().int().nonnegative(),
  body: z.string().max(65536).default(''),
  html_url: z.string().url().max(2048),
  user: z
    .object({ login: z.string().min(1).max(255), id: z.number().int().nonnegative() })
    .nullable()
    .default(null),
  path: z.string().max(4096).nullable().optional(),
  line: z.number().int().positive().nullable().optional(),
  created_at: z.string().datetime().nullable().default(null),
  updated_at: z.string().datetime().nullable().default(null),
});

const historyReviewSchema = z.object({
  id: z.number().int().nonnegative(),
  state: z.string().max(64).default('COMMENTED'),
  body: z.string().max(65536).nullable().default(null),
  html_url: z.string().url().max(2048).nullable().default(null),
  user: z
    .object({ login: z.string().min(1).max(255), id: z.number().int().nonnegative() })
    .nullable()
    .default(null),
  submitted_at: z.string().datetime().nullable().default(null),
});

const historyCheckRunSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().max(255).default(''),
  status: z.string().max(64).nullable().default(null),
  conclusion: z.string().max(64).nullable().default(null),
  html_url: z.string().url().max(2048).nullable().default(null),
  started_at: z.string().datetime().nullable().default(null),
  completed_at: z.string().datetime().nullable().default(null),
});

const historyCheckRunsSchema = z.object({
  total_count: z.number().int().nonnegative().default(0),
  check_runs: z.array(historyCheckRunSchema).default([]),
});

const historyCommitStatusSchema = z.object({
  id: z.number().int().nonnegative(),
  state: z.string().max(64),
  context: z.string().max(255),
  description: z.string().max(1024).nullable().default(null),
  target_url: z.string().url().max(2048).nullable().default(null),
  creator: z
    .object({ login: z.string().min(1).max(255), id: z.number().int().nonnegative() })
    .nullable()
    .default(null),
  created_at: z.string().datetime().nullable().default(null),
  updated_at: z.string().datetime().nullable().default(null),
});

export const GITHUB_REPOSITORY_PAGE_SIZE = 100;
export const GITHUB_MAX_REPOSITORY_PAGES = 100;
export const GITHUB_PULL_REQUEST_PAGE_SIZE = 100;
export const GITHUB_MAX_PULL_REQUEST_PAGES = 100;

export const GITHUB_REPOSITORY_SELECTIONS = ['all', 'selected'] as const;
export type GithubRepositorySelection = (typeof GITHUB_REPOSITORY_SELECTIONS)[number];

const accountSchema = z.object({
  login: z.string().max(255).default(''),
  id: z.number().int().nonnegative().default(0),
  type: z.string().max(64).default('Organization'),
});

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: accountSchema.nullish(),
  target_type: z.string().max(64).default('Organization'),
  repository_selection: z.enum(GITHUB_REPOSITORY_SELECTIONS).default('selected'),
  suspended_at: z.string().nullish(),
});

const userInstallationsSchema = z.object({
  total_count: z.number().int().nonnegative().default(0),
  installations: z.array(z.object({ id: z.number().int().positive() })).default([]),
});

const GITHUB_USER_INSTALLATION_PAGE_SIZE = 100;
const GITHUB_MAX_USER_INSTALLATION_PAGES = 100;

const userTokenSchema = z.object({
  access_token: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export interface GithubInstalledRepository {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly name: string;
  readonly ownerLogin: string;
  readonly private: boolean;
  readonly archived: boolean;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
}

export interface GithubOpenPullRequest {
  readonly externalId: string;
  readonly nodeId: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly draft: boolean;
  readonly author: { readonly login: string; readonly id: number };
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface GithubPullRequestHistoryEntry {
  readonly externalId: string;
  readonly type: 'comment' | 'review' | 'review_comment' | 'checks';
  readonly actor: { readonly login: string; readonly id: number };
  readonly body: string;
  readonly url: string;
  readonly state: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly occurredAt: string;
}

export interface GithubInstallationAccount {
  readonly installationId: string;
  readonly accountLogin: string;
  readonly accountId: string;
  readonly accountType: string;
  readonly repositorySelection: GithubRepositorySelection;
  readonly suspended: boolean;
}

export interface GithubAppCredentials {
  readonly appId: string;
  readonly privateKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBase?: string;
}

export interface GithubAppRequest extends GithubAppCredentials {
  readonly installationId: string;
}

async function githubJson<T extends z.ZodTypeAny>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  schema: T,
  label: string,
): Promise<z.infer<T>> {
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...GITHUB_HEADERS, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw internal(`GitHub ${label} returned HTTP ${response.status}.`);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw internal(`GitHub ${label} returned an unexpected payload.`);
  return parsed.data;
}

function credentialOverrides(input: GithubAppCredentials): {
  fetch?: typeof globalThis.fetch;
  apiBase?: string;
} {
  return {
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.apiBase === undefined ? {} : { apiBase: input.apiBase }),
  };
}

export const GITHUB_TOKEN_DEFAULT_TTL_MS = 3_600_000;
export const GITHUB_TOKEN_REFRESH_MARGIN_MS = 300_000;

interface CachedToken {
  readonly token: string;
  readonly usableUntil: number;
}

const installationTokens = new Map<string, CachedToken>();

function tokenCacheKey(input: GithubAppRequest): string {
  const keyDigest = createHash('sha256').update(input.privateKey).digest('hex').slice(0, 16);
  return `${input.apiBase ?? GITHUB_API_BASE}|${input.appId}|${keyDigest}|${input.installationId}`;
}

function usableUntil(expiresAt: string | null | undefined, now: number): number {
  const parsed = expiresAt === null || expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);
  const expiry = Number.isNaN(parsed) ? now + GITHUB_TOKEN_DEFAULT_TTL_MS : parsed;
  return expiry - GITHUB_TOKEN_REFRESH_MARGIN_MS;
}

export function forgetGithubInstallationTokens(): void {
  installationTokens.clear();
}

export async function githubInstallationToken(input: GithubAppRequest): Promise<string> {
  const now = Date.now();
  const key = tokenCacheKey(input);
  const cached = installationTokens.get(key);
  if (cached !== undefined && cached.usableUntil > now) return cached.token;

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const base = input.apiBase ?? GITHUB_API_BASE;
  const jwt = githubAppJwt({ appId: input.appId, privateKey: input.privateKey });
  const body = await githubJson(
    fetchImpl,
    `${base}/app/installations/${input.installationId}/access_tokens`,
    { method: 'POST', headers: { authorization: `Bearer ${jwt}` } },
    installationTokenSchema,
    'installation token',
  );
  installationTokens.set(key, {
    token: body.token,
    usableUntil: usableUntil(body.expires_at, now),
  });
  return body.token;
}

function toInstallationAccount(
  parsed: z.infer<typeof installationSchema>,
): GithubInstallationAccount {
  return {
    installationId: String(parsed.id),
    accountLogin: parsed.account?.login ?? '',
    accountId: String(parsed.account?.id ?? 0),
    accountType: parsed.account?.type ?? parsed.target_type,
    repositorySelection: parsed.repository_selection,
    suspended: typeof parsed.suspended_at === 'string' && parsed.suspended_at.length > 0,
  };
}

export async function fetchGithubInstallation(
  input: GithubAppRequest,
): Promise<GithubInstallationAccount> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const base = input.apiBase ?? GITHUB_API_BASE;
  const jwt = githubAppJwt({ appId: input.appId, privateKey: input.privateKey });
  const body = await githubJson(
    fetchImpl,
    `${base}/app/installations/${input.installationId}`,
    { headers: { authorization: `Bearer ${jwt}` } },
    installationSchema,
    'installation',
  );
  return toInstallationAccount(body);
}

function toInstalledRepository(
  repository: z.infer<typeof repositorySchema>,
): GithubInstalledRepository {
  const fullName = repository.full_name;
  const separator = fullName.indexOf('/');
  return {
    repositoryId: String(repository.id),
    repositoryName: fullName,
    name: repository.name.length > 0 ? repository.name : fullName.slice(separator + 1),
    ownerLogin: repository.owner?.login ?? (separator > 0 ? fullName.slice(0, separator) : ''),
    private: repository.private,
    archived: repository.archived,
    defaultBranch: repository.default_branch,
    htmlUrl: repository.html_url,
  };
}

export interface GithubRepositoryPage {
  readonly repositories: GithubInstalledRepository[];
  readonly hasMore: boolean;
}

export async function listInstallationRepositoryPage(input: {
  readonly token: string;
  readonly page: number;
  readonly perPage?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBase?: string;
}): Promise<GithubRepositoryPage> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const base = input.apiBase ?? GITHUB_API_BASE;
  const perPage = input.perPage ?? GITHUB_REPOSITORY_PAGE_SIZE;
  const page = Math.max(1, input.page);
  const body = await githubJson(
    fetchImpl,
    `${base}/installation/repositories?per_page=${perPage}&page=${page}`,
    { headers: { authorization: `Bearer ${input.token}` } },
    repositoriesSchema,
    'installation repositories',
  );
  return {
    repositories: body.repositories.map(toInstalledRepository),
    hasMore: body.repositories.length === perPage && page * perPage < body.total_count,
  };
}

export async function fetchInstalledRepositories(
  input: GithubAppRequest,
): Promise<GithubInstalledRepository[]> {
  const token = await githubInstallationToken(input);
  const overrides = credentialOverrides(input);
  const collected: GithubInstalledRepository[] = [];
  for (let page = 1; page <= GITHUB_MAX_REPOSITORY_PAGES; page += 1) {
    const result = await listInstallationRepositoryPage({ token, page, ...overrides });
    collected.push(...result.repositories);
    if (!result.hasMore) return collected;
  }
  throw internal(
    `GitHub installation ${input.installationId} lists more than ${GITHUB_MAX_REPOSITORY_PAGES * GITHUB_REPOSITORY_PAGE_SIZE} repositories, so this snapshot is incomplete.`,
  );
}

export async function fetchGithubOpenPullRequests(
  input: GithubAppRequest & { readonly repository: string },
): Promise<GithubOpenPullRequest[]> {
  const token = await githubInstallationToken(input);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const base = input.apiBase ?? GITHUB_API_BASE;
  const repository = input.repository
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const collected: GithubOpenPullRequest[] = [];
  for (let page = 1; page <= GITHUB_MAX_PULL_REQUEST_PAGES; page += 1) {
    const body = await githubJson(
      fetchImpl,
      `${base}/repos/${repository}/pulls?state=open&per_page=${GITHUB_PULL_REQUEST_PAGE_SIZE}&page=${page}`,
      { headers: { authorization: `Bearer ${token}` } },
      openPullRequestsSchema,
      'open pull requests',
    );
    collected.push(
      ...body.map((pullRequest) => ({
        externalId: pullRequest.id === 0 ? '' : String(pullRequest.id),
        nodeId: pullRequest.node_id,
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body ?? '',
        url: pullRequest.html_url,
        headRef: pullRequest.head.ref,
        headSha: pullRequest.head.sha,
        baseRef: pullRequest.base.ref,
        draft: pullRequest.draft,
        author: pullRequest.user ?? { login: 'github', id: 0 },
        createdAt: pullRequest.created_at,
        updatedAt: pullRequest.updated_at,
      })),
    );
    if (body.length < GITHUB_PULL_REQUEST_PAGE_SIZE) return collected;
  }
  throw internal(
    `GitHub repository ${input.repository} lists more than ${GITHUB_MAX_PULL_REQUEST_PAGES * GITHUB_PULL_REQUEST_PAGE_SIZE} open pull requests, so this snapshot is incomplete.`,
  );
}

async function githubPagedArray<T extends z.ZodTypeAny>(input: {
  readonly fetchImpl: typeof globalThis.fetch;
  readonly endpoint: string;
  readonly token: string;
  readonly itemSchema: T;
  readonly label: string;
}): Promise<z.infer<T>[]> {
  const collected: z.infer<T>[] = [];
  for (let page = 1; page <= GITHUB_MAX_PULL_REQUEST_PAGES; page += 1) {
    const body = await githubJson(
      input.fetchImpl,
      `${input.endpoint}?per_page=${GITHUB_PULL_REQUEST_PAGE_SIZE}&page=${page}`,
      { headers: { authorization: `Bearer ${input.token}` } },
      z.array(input.itemSchema),
      input.label,
    );
    collected.push(...body);
    if (body.length < GITHUB_PULL_REQUEST_PAGE_SIZE) return collected;
  }
  throw internal(`GitHub ${input.label} exceeded the supported history size.`);
}

function historyActor(actor: { readonly login: string; readonly id: number } | null): {
  readonly login: string;
  readonly id: number;
} {
  return actor ?? { login: 'github', id: 0 };
}

export async function fetchGithubPullRequestHistory(
  input: GithubAppRequest & {
    readonly repository: string;
    readonly number: number;
    readonly headSha: string;
  },
): Promise<GithubPullRequestHistoryEntry[]> {
  const token = await githubInstallationToken(input);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const base = input.apiBase ?? GITHUB_API_BASE;
  const repository = input.repository
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const root = `${base}/repos/${repository}`;
  const [conversationComments, reviews, reviewComments] = await Promise.all([
    githubPagedArray({
      fetchImpl,
      endpoint: `${root}/issues/${input.number}/comments`,
      token,
      itemSchema: historyCommentSchema,
      label: 'pull request conversation comments',
    }),
    githubPagedArray({
      fetchImpl,
      endpoint: `${root}/pulls/${input.number}/reviews`,
      token,
      itemSchema: historyReviewSchema,
      label: 'pull request reviews',
    }),
    githubPagedArray({
      fetchImpl,
      endpoint: `${root}/pulls/${input.number}/comments`,
      token,
      itemSchema: historyCommentSchema,
      label: 'pull request review comments',
    }),
  ]);
  const checks: z.infer<typeof historyCheckRunSchema>[] = [];
  let statuses: z.infer<typeof historyCommitStatusSchema>[] = [];
  if (input.headSha.length > 0) {
    statuses = await githubPagedArray({
      fetchImpl,
      endpoint: `${root}/commits/${encodeURIComponent(input.headSha)}/statuses`,
      token,
      itemSchema: historyCommitStatusSchema,
      label: 'pull request commit statuses',
    });
    for (let page = 1; page <= GITHUB_MAX_PULL_REQUEST_PAGES; page += 1) {
      const body = await githubJson(
        fetchImpl,
        `${root}/commits/${encodeURIComponent(input.headSha)}/check-runs?per_page=${GITHUB_PULL_REQUEST_PAGE_SIZE}&page=${page}`,
        { headers: { authorization: `Bearer ${token}` } },
        historyCheckRunsSchema,
        'pull request check runs',
      );
      checks.push(...body.check_runs);
      if (body.check_runs.length < GITHUB_PULL_REQUEST_PAGE_SIZE) break;
      if (page === GITHUB_MAX_PULL_REQUEST_PAGES) {
        throw internal('GitHub pull request check runs exceeded the supported history size.');
      }
    }
  }

  const history: GithubPullRequestHistoryEntry[] = [
    ...conversationComments.map((comment) => ({
      externalId: `comment:${comment.id}`,
      type: 'comment' as const,
      actor: historyActor(comment.user),
      body: comment.body,
      url: comment.html_url,
      state: 'created',
      path: null,
      line: null,
      occurredAt: comment.updated_at ?? comment.created_at ?? new Date(0).toISOString(),
    })),
    ...reviews.map((review) => ({
      externalId: `review:${review.id}`,
      type: 'review' as const,
      actor: historyActor(review.user),
      body: review.body ?? '',
      url: review.html_url ?? '',
      state: review.state.toLowerCase(),
      path: null,
      line: null,
      occurredAt: review.submitted_at ?? new Date(0).toISOString(),
    })),
    ...reviewComments.map((comment) => ({
      externalId: `review_comment:${comment.id}`,
      type: 'review_comment' as const,
      actor: historyActor(comment.user),
      body: comment.body,
      url: comment.html_url,
      state: 'created',
      path: comment.path ?? null,
      line: comment.line ?? null,
      occurredAt: comment.updated_at ?? comment.created_at ?? new Date(0).toISOString(),
    })),
    ...checks.map((check) => ({
      externalId: `check_run:${check.id}:${check.conclusion === null ? 'created' : 'completed'}:${check.conclusion ?? check.status ?? ''}`,
      type: 'checks' as const,
      actor: { login: 'github-actions', id: 0 },
      body: check.name,
      url: check.html_url ?? '',
      state: check.conclusion ?? check.status ?? 'unknown',
      path: null,
      line: null,
      occurredAt: check.completed_at ?? check.started_at ?? new Date(0).toISOString(),
    })),
    ...statuses.map((status) => ({
      externalId: `status:${status.context}:${status.id}:${status.state}`,
      type: 'checks' as const,
      actor: historyActor(status.creator),
      body: status.context,
      url: status.target_url ?? '',
      state: status.state,
      path: null,
      line: null,
      occurredAt: status.updated_at ?? status.created_at ?? new Date(0).toISOString(),
    })),
  ];
  return history.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

export interface GithubUserAuthorization {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly oauthBase?: string;
  readonly apiBase?: string;
}

const GITHUB_OAUTH_BASE = 'https://github.com';

export async function exchangeGithubUserCode(input: GithubUserAuthorization): Promise<string> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const base = input.oauthBase ?? GITHUB_OAUTH_BASE;
  const response = await fetchImpl(`${base}/login/oauth/access_token`, {
    method: 'POST',
    headers: { ...GITHUB_HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
    }),
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw internal(`GitHub user token returned HTTP ${response.status}.`);
  const parsed = userTokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw internal('GitHub user token returned an unexpected payload.');
  if (parsed.data.access_token === undefined) {
    throw internal(`GitHub user token failed: ${parsed.data.error ?? 'unknown_error'}.`);
  }
  return parsed.data.access_token;
}

export async function listUserInstallationIds(input: {
  readonly userToken: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBase?: string;
}): Promise<string[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const base = input.apiBase ?? GITHUB_API_BASE;
  const collected: string[] = [];
  for (let page = 1; page <= GITHUB_MAX_USER_INSTALLATION_PAGES; page += 1) {
    const body = await githubJson(
      fetchImpl,
      `${base}/user/installations?per_page=${GITHUB_USER_INSTALLATION_PAGE_SIZE}&page=${page}`,
      { headers: { authorization: `Bearer ${input.userToken}` } },
      userInstallationsSchema,
      'user installations',
    );
    collected.push(...body.installations.map((entry) => String(entry.id)));
    if (
      body.installations.length < GITHUB_USER_INSTALLATION_PAGE_SIZE ||
      collected.length >= body.total_count
    ) {
      return collected;
    }
  }
  throw internal(
    `GitHub user controls more than ${GITHUB_MAX_USER_INSTALLATION_PAGES * GITHUB_USER_INSTALLATION_PAGE_SIZE} installations, so this snapshot is incomplete.`,
  );
}
