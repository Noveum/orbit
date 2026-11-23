import { DomainError, validationFailed } from '@orbit/shared/errors';
import {
  githubReplacementCatalogueSchema as catalogueSchema,
  type GithubReplacementRepositoryMetadata,
  githubReplacementInstallationSchema as installationSchema,
  githubReplacementInputSchema as replacementSchema,
  githubReplacementRequestSchema as requestSchema,
  githubReplacementTokenSchema as tokenSchema,
} from '@orbit/shared/validators';
import {
  GITHUB_API_BASE,
  GITHUB_MAX_REPOSITORY_PAGES,
  GITHUB_REPOSITORY_PAGE_SIZE,
  type GithubAppRequest,
  type GithubInstallationAccount,
  type GithubInstalledRepository,
  githubAppJwt,
} from './app.ts';

export const REPLACEMENT_REQUEST_TIMEOUT_MS = 10_000;
export const REPLACEMENT_OVERALL_TIMEOUT_MS = 30_000;
export const REPLACEMENT_MAX_BODY_BYTES = 1_048_576;

type ProofRequest = Pick<GithubAppRequest, 'appId' | 'privateKey' | 'installationId' | 'fetch'>;

export interface GithubReplacementInput extends ProofRequest {
  readonly previousInstallationId: string;
  readonly expectedAccountId: string;
  readonly expectedAccountType: 'User' | 'Organization';
  readonly watchedRepositoryIds: readonly string[];
}

export interface GithubReplacementProof {
  readonly previousInstallationId: string;
  readonly installation: GithubInstallationAccount;
  readonly repositories: readonly GithubInstalledRepository[];
}

interface ProofContext {
  readonly appId: string;
  readonly jwt: string;
  readonly fetch: typeof globalThis.fetch;
  readonly deadlineAt: number;
}

function failure(reason: string, operation: string): DomainError {
  return new DomainError('internal', 'GitHub replacement proof could not be verified.', {
    details: { reason, operation },
  });
}

function httpFailure(status: number, operation: string): DomainError {
  return new DomainError(
    'internal',
    'GitHub replacement proof returned an unexpected HTTP status.',
    {
      details: { reason: 'github_provider_http_error', operation, httpStatus: status },
    },
  );
}

function context(input: ProofRequest): ProofContext {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw validationFailed('GitHub replacement proof identities are invalid.');
  const deadlineAt = performance.now() + REPLACEMENT_OVERALL_TIMEOUT_MS;
  let jwt: string;
  try {
    jwt = githubAppJwt(parsed.data);
  } catch {
    throw validationFailed('GitHub replacement proof credentials are invalid.');
  }
  return { appId: parsed.data.appId, jwt, fetch: input.fetch ?? globalThis.fetch, deadlineAt };
}

async function bounded<T>(
  state: ProofContext,
  operation: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  const deadlineAt = Math.min(state.deadlineAt, startedAt + REPLACEMENT_REQUEST_TIMEOUT_MS);
  const remaining = deadlineAt - startedAt;
  if (remaining <= 0) throw failure('github_replacement_timeout', operation);
  const controller = new AbortController();
  const timeoutError = failure('github_replacement_timeout', operation);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        controller.abort();
        reject(timeoutError);
      },
      Math.min(remaining, REPLACEMENT_REQUEST_TIMEOUT_MS),
    );
  });
  try {
    const result = await Promise.race([run(controller.signal), timeout]);
    if (performance.now() >= deadlineAt) {
      controller.abort();
      throw timeoutError;
    }
    return result;
  } catch (error: unknown) {
    if (controller.signal.aborted) throw timeoutError;
    if (error instanceof DomainError) throw error;
    throw failure('github_replacement_provider_unavailable', operation);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function body(response: Response, signal: AbortSignal, operation: string): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw failure('github_replacement_invalid_payload', operation);
  const cancel = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const declared = response.headers.get('content-length');
    if (
      declared !== null &&
      (!Number.isSafeInteger(Number(declared)) ||
        Number(declared) < 0 ||
        Number(declared) > REPLACEMENT_MAX_BODY_BYTES)
    ) {
      throw failure('github_replacement_body_limit', operation);
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REPLACEMENT_MAX_BODY_BYTES)
        throw failure('github_replacement_body_limit', operation);
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return value;
    } catch {
      throw failure('github_replacement_invalid_payload', operation);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

function request<T>(
  state: ProofContext,
  path: string,
  authorization: string,
  method: 'GET' | 'POST',
  operation: string,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return bounded(state, operation, async (signal) => {
    const response = await state.fetch(GITHUB_API_BASE + path, {
      method,
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'orbit',
        authorization: `Bearer ${authorization}`,
      },
    });
    try {
      return await consume(response, signal);
    } finally {
      if (!response.bodyUsed) response.body?.cancel().catch(() => undefined);
    }
  });
}

function json(
  state: ProofContext,
  path: string,
  authorization: string,
  method: 'GET' | 'POST',
  operation: string,
  status: number,
): Promise<unknown> {
  return request(state, path, authorization, method, operation, (response, signal) => {
    if (response.status !== status) throw httpFailure(response.status, operation);
    return body(response, signal, operation);
  });
}

async function installation(
  state: ProofContext,
  installationId: string,
): Promise<GithubInstallationAccount> {
  const value = await json(
    state,
    `/app/installations/${installationId}`,
    state.jwt,
    'GET',
    'installation',
    200,
  );
  const parsed = installationSchema.safeParse(value);
  if (
    !parsed.success ||
    String(parsed.data.id) !== installationId ||
    String(parsed.data.app_id) !== state.appId
  ) {
    throw failure('github_replacement_invalid_identity', 'installation');
  }
  return {
    installationId: String(parsed.data.id),
    accountId: String(parsed.data.account.id),
    accountLogin: parsed.data.account.login,
    accountType: parsed.data.account.type,
    repositorySelection: parsed.data.repository_selection,
    suspended: parsed.data.suspended_at !== null,
  };
}

function repositoryFacts(
  repository: GithubReplacementRepositoryMetadata,
): GithubInstalledRepository {
  const segments = repository.full_name.split('/');
  const owner = segments[0];
  const name = segments[1];
  if (
    segments.length !== 2 ||
    !owner ||
    !name ||
    ['.', '..'].includes(owner) ||
    ['.', '..'].includes(name) ||
    /[\\\s?#%]/.test(repository.full_name)
  )
    throw failure('github_replacement_invalid_payload', 'installation repositories');
  return {
    repositoryId: String(repository.id),
    repositoryName: repository.full_name,
    name: repository.name || name,
    ownerLogin: repository.owner?.login ?? owner,
    private: repository.private,
    archived: repository.archived,
    defaultBranch: repository.default_branch,
    htmlUrl: repository.html_url,
  };
}

async function repositories(
  state: ProofContext,
  installationId: string,
): Promise<GithubInstalledRepository[]> {
  const minted = tokenSchema.safeParse(
    await json(
      state,
      `/app/installations/${installationId}/access_tokens`,
      state.jwt,
      'POST',
      'installation token',
      201,
    ),
  );
  if (!minted.success) throw failure('github_replacement_invalid_payload', 'installation token');
  const rows: GithubInstalledRepository[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let page = 1; page <= GITHUB_MAX_REPOSITORY_PAGES; page += 1) {
    const path = `/installation/repositories?per_page=${GITHUB_REPOSITORY_PAGE_SIZE}&page=${page}`;
    const parsed = catalogueSchema.safeParse(
      await json(state, path, minted.data.token, 'GET', 'installation repositories', 200),
    );
    if (!parsed.success || (total !== undefined && parsed.data.total_count !== total))
      throw failure('github_replacement_incomplete_catalogue', 'installation repositories');
    total = parsed.data.total_count;
    for (const repository of parsed.data.repositories) {
      const id = String(repository.id);
      if (seen.has(id))
        throw failure('github_replacement_incomplete_catalogue', 'installation repositories');
      seen.add(id);
      rows.push(repositoryFacts(repository));
    }
    if (rows.length > total)
      throw failure('github_replacement_incomplete_catalogue', 'installation repositories');
    if (rows.length === total) return rows;
    if (parsed.data.repositories.length !== GITHUB_REPOSITORY_PAGE_SIZE)
      throw failure('github_replacement_incomplete_catalogue', 'installation repositories');
  }
  throw failure('github_replacement_incomplete_catalogue', 'installation repositories');
}

export async function fetchReplacementInstallationProof(
  input: ProofRequest,
): Promise<GithubInstallationAccount> {
  const state = context(input);
  return await installation(state, input.installationId);
}

export async function fetchReplacementRepositoryProof(
  input: ProofRequest,
): Promise<GithubInstalledRepository[]> {
  const state = context(input);
  return await repositories(state, input.installationId);
}

export async function verifyGithubInstallationReplacement(
  input: GithubReplacementInput,
): Promise<GithubReplacementProof> {
  const parsed = replacementSchema.safeParse(input);
  if (!parsed.success) throw validationFailed('GitHub replacement proof identities are invalid.');
  const state = context(input);
  const current = await installation(state, parsed.data.installationId);
  if (
    current.suspended ||
    current.accountId !== parsed.data.expectedAccountId ||
    current.accountType !== parsed.data.expectedAccountType
  )
    throw validationFailed(
      'The replacement GitHub installation does not match the expected account.',
    );
  await request(
    state,
    `/app/installations/${parsed.data.previousInstallationId}`,
    state.jwt,
    'GET',
    'installation',
    (response) => {
      if (response.status !== 404) throw httpFailure(response.status, 'installation');
      return Promise.resolve(undefined);
    },
  );
  const catalogue = await repositories(state, parsed.data.installationId);
  const visible = new Set(catalogue.map((row) => row.repositoryId));
  if (parsed.data.watchedRepositoryIds.some((id) => !visible.has(id)))
    throw validationFailed(
      'The replacement GitHub installation cannot access every watched repository.',
    );
  return {
    previousInstallationId: parsed.data.previousInstallationId,
    installation: current,
    repositories: catalogue,
  };
}
