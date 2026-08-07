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

export const GITHUB_REPOSITORY_PAGE_SIZE = 100;
export const GITHUB_MAX_REPOSITORY_PAGES = 100;

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
  const body = await githubJson(
    fetchImpl,
    `${base}/user/installations?per_page=100`,
    { headers: { authorization: `Bearer ${input.userToken}` } },
    userInstallationsSchema,
    'user installations',
  );
  return body.installations.map((entry) => String(entry.id));
}
