import { DomainError } from '@orbit/shared/errors';
import {
  githubRecoveryInstallationSchema,
  githubRecoveryPullRequestSchema,
  githubRecoveryRepositoriesSchema,
  githubRecoveryTokenSchema,
} from '@orbit/shared/validators';
import type { z } from 'zod';
import {
  GITHUB_API_BASE,
  GITHUB_REQUEST_TIMEOUT_MS,
  type GithubAppRequest,
  githubAppJwt,
} from './app.ts';

export interface GithubRecoveryProviderInput extends GithubAppRequest {
  readonly accountId: string;
  readonly repositoryId: string;
  readonly pullRequestNumber: number;
  readonly signal?: AbortSignal;
  readonly budgetMs?: number;
}

export interface GithubRecoveryProviderSnapshot {
  readonly installationId: string;
  readonly appId: string;
  readonly accountId: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly externalId: string;
  readonly number: number;
  readonly state: 'open' | 'closed';
  readonly merged: boolean;
  readonly draft: boolean;
  readonly headSha: string;
  readonly providerUpdatedAt: string;
}

export type GithubRecoveryProviderFailure =
  | 'github_provider_http_error'
  | 'github_provider_payload_invalid'
  | 'github_provider_request_failed'
  | 'github_recovery_identity_mismatch'
  | 'github_installation_suspended'
  | 'github_recovery_expired';
export type GithubRecoveryProviderOperation =
  | 'installation'
  | 'installation token'
  | 'repository'
  | 'pull request';

export class GithubRecoveryProviderError extends DomainError {
  constructor(
    readonly reason: GithubRecoveryProviderFailure,
    readonly operation: GithubRecoveryProviderOperation,
    readonly httpStatus?: number,
  ) {
    super('internal', 'GitHub recovery verification could not complete.', {
      details: { reason, operation, ...(httpStatus === undefined ? {} : { httpStatus }) },
    });
  }
}

const MAX_BODY_BYTES = 1_048_576;
const MAX_VERIFICATION_BUDGET_MS = 40_000;

function numericId(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseRecoveryBody<T extends z.ZodType>(
  chunks: readonly Uint8Array[],
  schema: T,
  operation: GithubRecoveryProviderOperation,
): z.output<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GithubRecoveryProviderError('github_provider_payload_invalid', operation);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new GithubRecoveryProviderError('github_provider_payload_invalid', operation);
  }
  return parsed.data;
}

async function readRecoveryBody<T extends z.ZodType>(
  response: Response,
  schema: T,
  operation: GithubRecoveryProviderOperation,
  aborted: Promise<never>,
  selected: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
): Promise<z.output<T>> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new GithubRecoveryProviderError('github_provider_payload_invalid', operation);
  }
  selected(reader);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const part = await Promise.race([reader.read(), aborted]);
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > MAX_BODY_BYTES) {
      throw new GithubRecoveryProviderError('github_provider_payload_invalid', operation);
    }
    chunks.push(part.value);
  }
  return parseRecoveryBody(chunks, schema, operation);
}

function cancelRecoveryBody(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  response: Response | undefined,
): void {
  if (reader !== undefined) {
    reader.cancel().catch(() => undefined);
    reader.releaseLock();
  } else if (response?.body !== null && response?.body !== undefined) {
    response.body.cancel().catch(() => undefined);
  }
}

function providerRequestOptions(
  credential: string,
  signal: AbortSignal,
  body?: { readonly repository_ids: readonly number[] },
): RequestInit {
  return {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'orbit',
      authorization: `Bearer ${credential}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
    redirect: 'error',
    cache: 'no-store',
  };
}

export async function verifyGithubRecoveryProvider(
  input: GithubRecoveryProviderInput,
): Promise<GithubRecoveryProviderSnapshot> {
  const repositoryId = numericId(input.repositoryId);
  if (
    repositoryId === null ||
    numericId(input.appId) === null ||
    numericId(input.installationId) === null ||
    numericId(input.accountId) === null ||
    !Number.isSafeInteger(input.pullRequestNumber) ||
    input.pullRequestNumber <= 0 ||
    (input.apiBase !== undefined && input.apiBase !== GITHUB_API_BASE)
  ) {
    throw new GithubRecoveryProviderError('github_recovery_identity_mismatch', 'installation');
  }
  const budgetMs = input.budgetMs ?? MAX_VERIFICATION_BUDGET_MS;
  if (!Number.isSafeInteger(budgetMs) || budgetMs <= 0 || budgetMs > MAX_VERIFICATION_BUDGET_MS) {
    throw new GithubRecoveryProviderError('github_recovery_expired', 'installation');
  }
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), budgetMs);
  const overall = AbortSignal.any([
    budget.signal,
    ...(input.signal === undefined ? [] : [input.signal]),
  ]);
  const fetchImpl = input.fetch ?? globalThis.fetch;

  async function request<T extends z.ZodType>(
    operation: GithubRecoveryProviderOperation,
    endpoint: string,
    credential: string,
    schema: T,
    body?: { readonly repository_ids: readonly number[] },
  ): Promise<z.output<T>> {
    const deadline = new AbortController();
    const requestTimer = setTimeout(() => deadline.abort(), GITHUB_REQUEST_TIMEOUT_MS);
    const signal = AbortSignal.any([overall, deadline.signal]);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let abortListener: (() => void) | undefined;
    const failure = () =>
      new GithubRecoveryProviderError(
        overall.aborted ? 'github_recovery_expired' : 'github_provider_request_failed',
        operation,
      );
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(failure());
      if (signal.aborted) abortListener();
      else signal.addEventListener('abort', abortListener, { once: true });
    });
    try {
      if (signal.aborted) throw failure();
      response = await Promise.race([
        fetchImpl(GITHUB_API_BASE + endpoint, providerRequestOptions(credential, signal, body)),
        aborted,
      ]);
      if (!response.ok) {
        throw new GithubRecoveryProviderError(
          'github_provider_http_error',
          operation,
          response.status,
        );
      }
      const data = await readRecoveryBody(response, schema, operation, aborted, (selected) => {
        reader = selected;
      });
      if (signal.aborted) throw failure();
      return data;
    } catch (error) {
      if (error instanceof GithubRecoveryProviderError) throw error;
      throw failure();
    } finally {
      clearTimeout(requestTimer);
      if (abortListener !== undefined) signal.removeEventListener('abort', abortListener);
      cancelRecoveryBody(reader, response);
    }
  }

  try {
    if (overall.aborted) {
      throw new GithubRecoveryProviderError('github_recovery_expired', 'installation');
    }
    let jwt: string;
    try {
      jwt = githubAppJwt(input);
    } catch {
      throw new GithubRecoveryProviderError('github_provider_request_failed', 'installation');
    }
    const installation = await request(
      'installation',
      `/app/installations/${input.installationId}`,
      jwt,
      githubRecoveryInstallationSchema,
    );
    if (
      String(installation.id) !== input.installationId ||
      String(installation.app_id) !== input.appId ||
      String(installation.account.id) !== input.accountId
    ) {
      throw new GithubRecoveryProviderError('github_recovery_identity_mismatch', 'installation');
    }
    if (installation.suspended_at !== null) {
      throw new GithubRecoveryProviderError('github_installation_suspended', 'installation');
    }
    const scoped = await request(
      'installation token',
      `/app/installations/${input.installationId}/access_tokens`,
      jwt,
      githubRecoveryTokenSchema,
      { repository_ids: [repositoryId] },
    );
    const catalogue = await request(
      'repository',
      '/installation/repositories?per_page=2&page=1',
      scoped.token,
      githubRecoveryRepositoriesSchema,
    );
    const repository = catalogue.repositories[0];
    if (String(repository.id) !== input.repositoryId) {
      throw new GithubRecoveryProviderError('github_recovery_identity_mismatch', 'repository');
    }
    const repositoryPath = repository.full_name.split('/').map(encodeURIComponent).join('/');
    const pull = await request(
      'pull request',
      `/repos/${repositoryPath}/pulls/${input.pullRequestNumber}`,
      scoped.token,
      githubRecoveryPullRequestSchema,
    );
    if (
      pull.number !== input.pullRequestNumber ||
      String(pull.base.repo.id) !== input.repositoryId
    ) {
      throw new GithubRecoveryProviderError('github_recovery_identity_mismatch', 'pull request');
    }
    if (overall.aborted) {
      throw new GithubRecoveryProviderError('github_recovery_expired', 'pull request');
    }
    return {
      installationId: String(installation.id),
      appId: String(installation.app_id),
      accountId: String(installation.account.id),
      repositoryId: String(repository.id),
      repositoryName: repository.full_name,
      externalId: String(pull.id),
      number: pull.number,
      state: pull.state,
      merged: pull.merged,
      draft: pull.draft,
      headSha: pull.head.sha,
      providerUpdatedAt: new Date(pull.updated_at).toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
