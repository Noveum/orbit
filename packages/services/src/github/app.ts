import { createSign } from 'node:crypto';
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

const installationTokenSchema = z.object({ token: z.string().min(1) });

const repositorySchema = z.object({
  id: z.number().int().nonnegative(),
  full_name: z.string().min(1).max(512),
  default_branch: z.string().min(1).max(255).default('main'),
});

const repositoriesSchema = z.object({
  total_count: z.number().int().nonnegative().default(0),
  repositories: z.array(repositorySchema).default([]),
});

const GITHUB_REPOSITORY_PAGE_SIZE = 30;

export interface GithubInstalledRepository {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly defaultBranch: string;
}

export interface GithubAppRequest {
  readonly appId: string;
  readonly privateKey: string;
  readonly installationId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBase?: string;
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

export async function githubInstallationToken(input: GithubAppRequest): Promise<string> {
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
  return body.token;
}

export async function listInstallationRepositories(input: {
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBase?: string;
}): Promise<GithubInstalledRepository[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const base = input.apiBase ?? GITHUB_API_BASE;
  const body = await githubJson(
    fetchImpl,
    `${base}/installation/repositories?per_page=100`,
    { headers: { authorization: `Bearer ${input.token}` } },
    repositoriesSchema,
    'installation repositories',
  );
  return body.repositories.map((repository) => ({
    repositoryId: String(repository.id),
    repositoryName: repository.full_name,
    defaultBranch: repository.default_branch,
  }));
}

export async function fetchInstalledRepositories(
  input: GithubAppRequest,
): Promise<GithubInstalledRepository[]> {
  const token = await githubInstallationToken(input);
  return listInstallationRepositories({
    token,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.apiBase === undefined ? {} : { apiBase: input.apiBase }),
  });
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
    repositories: body.repositories.map((repository) => ({
      repositoryId: String(repository.id),
      repositoryName: repository.full_name,
      defaultBranch: repository.default_branch,
    })),
    hasMore: page * perPage < body.total_count,
  };
}

export async function fetchInstalledRepositoryPage(
  input: GithubAppRequest & { readonly page: number; readonly perPage?: number },
): Promise<GithubRepositoryPage> {
  const token = await githubInstallationToken(input);
  return listInstallationRepositoryPage({
    token,
    page: input.page,
    ...(input.perPage === undefined ? {} : { perPage: input.perPage }),
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.apiBase === undefined ? {} : { apiBase: input.apiBase }),
  });
}
