import type { Database, Transaction } from '@orbit/db';
import {
  githubCheckHeadReconciliation,
  githubInstallation,
  githubPullRequest,
  githubRepository,
  githubRepositorySync,
  integration,
} from '@orbit/db/schema';
import { notFound } from '@orbit/shared/errors';
import {
  type GithubRecoveryRequest,
  type GithubRecoveryResult,
  type GithubRecoveryStatus,
  githubRecoveryRequestSchema,
} from '@orbit/shared/validators';
import { and, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { enqueueHeadReconciliation } from './head-queue.ts';
import { assertGithubIntegrationManager } from './installations.ts';
import { isActiveGithubPullRequest, RECOVERABLE_PULL_STATES } from './pull-state.ts';
import {
  GithubRecoveryProviderError,
  type GithubRecoveryProviderInput,
  type GithubRecoveryProviderSnapshot,
  verifyGithubRecoveryProvider,
} from './recovery-provider.ts';
import { GITHUB_MANUAL_RECOVERY_TRIGGER } from './recovery-trigger.ts';

export type { GithubRecoveryResult, GithubRecoveryStatus } from '@orbit/shared/validators';

export interface GithubRecoveryInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly selector: GithubRecoveryRequest;
  readonly appId: string;
  readonly privateKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  readonly now?: Date;
  readonly verifyProvider?: (
    input: GithubRecoveryProviderInput,
  ) => Promise<GithubRecoveryProviderSnapshot>;
}

interface RecoveryTarget {
  readonly head: typeof githubCheckHeadReconciliation.$inferSelect;
  readonly pull: typeof githubPullRequest.$inferSelect;
  readonly repo: typeof githubRepositorySync.$inferSelect;
  readonly installation: typeof githubInstallation.$inferSelect | null;
  readonly catalog: typeof githubRepository.$inferSelect | null;
}

class RecoveryExpired extends Error {}

function boundedDatabaseFailure(error: unknown): boolean {
  const wrapperCause = error instanceof Error ? error.cause : null;
  const cause = error instanceof postgres.PostgresError ? error : wrapperCause;
  return (
    cause instanceof postgres.PostgresError && (cause.code === '55P03' || cause.code === '57014')
  );
}

function triggerIdentity(selector: GithubRecoveryRequest): string {
  return [
    selector.reconciliationId,
    selector.pullRequestId,
    selector.expectedJobVersion,
    selector.expectedContextGeneration,
    selector.expectedHeadEpoch,
    selector.expectedHeadSha,
  ].join(':');
}

async function loadTarget(
  database: Database,
  input: GithubRecoveryInput,
): Promise<RecoveryTarget | null> {
  const [target] = await database
    .select({
      head: githubCheckHeadReconciliation,
      pull: githubPullRequest,
      repo: githubRepositorySync,
      installation: githubInstallation,
      catalog: githubRepository,
    })
    .from(githubCheckHeadReconciliation)
    .innerJoin(
      githubRepositorySync,
      and(
        eq(githubRepositorySync.id, githubCheckHeadReconciliation.repositorySyncId),
        eq(githubRepositorySync.organizationId, githubCheckHeadReconciliation.organizationId),
      ),
    )
    .innerJoin(
      githubPullRequest,
      and(
        eq(githubPullRequest.id, input.selector.pullRequestId),
        eq(githubPullRequest.organizationId, githubRepositorySync.organizationId),
        eq(githubPullRequest.repositorySyncId, githubRepositorySync.id),
      ),
    )
    .leftJoin(
      githubInstallation,
      and(
        eq(githubInstallation.integrationId, githubRepositorySync.integrationId),
        eq(githubInstallation.installationId, githubRepositorySync.installationId),
        eq(githubInstallation.organizationId, githubRepositorySync.organizationId),
      ),
    )
    .leftJoin(
      githubRepository,
      and(
        eq(githubRepository.installationRowId, githubInstallation.id),
        eq(githubRepository.repositoryId, githubRepositorySync.repositoryId),
        eq(githubRepository.organizationId, githubRepositorySync.organizationId),
      ),
    )
    .where(
      and(
        eq(githubCheckHeadReconciliation.id, input.selector.reconciliationId),
        eq(githubCheckHeadReconciliation.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return target ?? null;
}

function eligibility(
  target: RecoveryTarget,
  selector: GithubRecoveryRequest,
): GithubRecoveryStatus | null {
  if (
    target.head.headSha !== selector.expectedHeadSha ||
    target.pull.headSha !== selector.expectedHeadSha ||
    target.pull.headEpoch !== selector.expectedHeadEpoch
  )
    return 'superseded';
  if (
    !(isActiveGithubPullRequest(target.pull) && RECOVERABLE_PULL_STATES.includes(target.pull.state))
  )
    return 'not_active';
  if (
    target.head.triggerKind === GITHUB_MANUAL_RECOVERY_TRIGGER &&
    target.head.triggerIdentity === triggerIdentity(selector) &&
    target.head.jobVersion === selector.expectedJobVersion + 1
  ) {
    return target.head.status === 'pending' || target.head.status === 'processing'
      ? 'already_queued'
      : 'already_attempted';
  }
  if (
    target.head.jobVersion !== selector.expectedJobVersion ||
    target.head.contextGeneration !== selector.expectedContextGeneration
  )
    return 'superseded';
  if (target.head.status !== 'failed') return 'busy';
  if (!target.repo.enabled) return 'repository_unavailable';
  if (target.installation === null || target.installation.accountId === '')
    return 'installation_unavailable';
  if (target.installation.status !== 'active') return 'installation_suspended';
  if (target.catalog === null) return 'repository_unavailable';
  return null;
}

function providerFailure(error: unknown): GithubRecoveryStatus {
  if (!(error instanceof GithubRecoveryProviderError)) return 'provider_temporarily_unavailable';
  if (error.reason === 'github_recovery_expired') return 'expired';
  if (error.reason === 'github_installation_suspended') return 'installation_suspended';
  if (error.reason === 'github_recovery_identity_mismatch') return 'superseded';
  if (error.reason !== 'github_provider_http_error') return 'provider_temporarily_unavailable';
  if (error.httpStatus === 401) return 'provider_authentication_failed';
  if (error.httpStatus === 422 && error.operation === 'installation token')
    return 'repository_access_required';
  if (error.httpStatus !== 404) return 'provider_temporarily_unavailable';
  if (error.operation === 'repository') return 'repository_unavailable';
  if (error.operation === 'pull request') return 'pull_request_unavailable';
  return 'installation_unavailable';
}

async function lockTarget(
  database: Transaction,
  initial: RecoveryTarget,
  organizationId: string,
  boundStatement: () => Promise<void>,
): Promise<RecoveryTarget | null> {
  if (initial.installation === null) return null;
  await boundStatement();
  const [parent] = await database
    .select({ installation: githubInstallation })
    .from(integration)
    .innerJoin(githubInstallation, eq(githubInstallation.integrationId, integration.id))
    .where(
      and(
        eq(integration.id, initial.repo.integrationId),
        eq(integration.organizationId, organizationId),
        eq(integration.provider, 'github'),
        eq(githubInstallation.id, initial.installation.id),
        eq(githubInstallation.organizationId, organizationId),
        eq(githubInstallation.installationId, initial.repo.installationId),
      ),
    )
    .limit(1)
    .for('update');
  if (parent === undefined) return null;
  await boundStatement();
  const [repo] = await database
    .select()
    .from(githubRepositorySync)
    .where(
      and(
        eq(githubRepositorySync.id, initial.repo.id),
        eq(githubRepositorySync.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for('update');
  if (repo === undefined) return null;
  await boundStatement();
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(
      and(
        eq(githubCheckHeadReconciliation.id, initial.head.id),
        eq(githubCheckHeadReconciliation.organizationId, organizationId),
        eq(githubCheckHeadReconciliation.repositorySyncId, repo.id),
      ),
    )
    .limit(1)
    .for('update');
  await boundStatement();
  const [pull] = await database
    .select()
    .from(githubPullRequest)
    .where(
      and(
        eq(githubPullRequest.id, initial.pull.id),
        eq(githubPullRequest.organizationId, organizationId),
        eq(githubPullRequest.repositorySyncId, repo.id),
      ),
    )
    .limit(1)
    .for('update');
  if (head === undefined || pull === undefined) return null;
  await boundStatement();
  const [catalog] = await database
    .select()
    .from(githubRepository)
    .where(
      and(
        eq(githubRepository.installationRowId, parent.installation.id),
        eq(githubRepository.organizationId, organizationId),
        eq(githubRepository.repositoryId, repo.repositoryId),
      ),
    )
    .limit(1);
  return { head, pull, repo, installation: parent.installation, catalog: catalog ?? null };
}

function mappingMatches(
  target: RecoveryTarget,
  initial: RecoveryTarget,
  provider: GithubRecoveryProviderSnapshot,
  appId: string,
): boolean {
  return (
    target.installation !== null &&
    initial.installation !== null &&
    target.repo.integrationId === initial.repo.integrationId &&
    target.repo.installationId === initial.repo.installationId &&
    target.repo.repositoryId === initial.repo.repositoryId &&
    target.installation.id === initial.installation.id &&
    target.installation.accountId === initial.installation.accountId &&
    provider.appId === appId &&
    provider.installationId === target.repo.installationId &&
    provider.accountId === target.installation.accountId &&
    provider.repositoryId === target.repo.repositoryId &&
    target.pull.repositoryId === target.repo.repositoryId &&
    provider.number === target.pull.number
  );
}

async function queueVerifiedRecovery(
  database: Database,
  input: GithubRecoveryInput,
  initial: RecoveryTarget,
  provider: GithubRecoveryProviderSnapshot,
  providerUpdatedAt: Date,
  deadline: number,
  expired: () => boolean,
  now: Date,
): Promise<GithubRecoveryResult> {
  try {
    return await database.transaction(async (tx) => {
      const boundStatement = async () => {
        const remaining = deadline - Date.now();
        if (expired()) throw new RecoveryExpired();
        await tx.execute(
          sql`select set_config('lock_timeout', ${`${String(Math.min(2000, remaining))}ms`}, true), set_config('statement_timeout', ${`${String(Math.min(5000, remaining))}ms`}, true)`,
        );
        if (expired()) throw new RecoveryExpired();
      };
      const target = await lockTarget(tx, initial, input.organizationId, boundStatement);
      if (target === null) return { status: 'superseded' as const };
      const status = eligibility(target, input.selector);
      if (status !== null) return { status };
      if (
        !mappingMatches(target, initial, provider, input.appId) ||
        (target.pull.providerUpdatedAt !== null &&
          providerUpdatedAt.getTime() < target.pull.providerUpdatedAt.getTime())
      )
        return { status: 'superseded' as const };
      await boundStatement();
      await assertGithubIntegrationManager(tx, input);
      await boundStatement();
      await enqueueHeadReconciliation(tx, {
        repo: target.repo,
        headSha: input.selector.expectedHeadSha,
        triggerKind: GITHUB_MANUAL_RECOVERY_TRIGGER,
        triggerIdentity: triggerIdentity(input.selector),
        now,
      });
      await boundStatement();
      await tx
        .update(githubRepositorySync)
        .set({
          repositoryName: provider.repositoryName,
          updatedAt: now,
        })
        .where(eq(githubRepositorySync.id, target.repo.id));
      if (expired()) throw new RecoveryExpired();
      return { status: 'queued' as const };
    });
  } catch (error) {
    if (error instanceof RecoveryExpired) return { status: 'expired' };
    if (boundedDatabaseFailure(error)) return { status: expired() ? 'expired' : 'busy' };
    throw error;
  }
}

export async function requestGithubCheckRecovery(
  database: Database,
  raw: GithubRecoveryInput,
): Promise<GithubRecoveryResult> {
  const input = { ...raw, selector: githubRecoveryRequestSchema.parse(raw.selector) };
  const deadline = Date.now() + 45_000;
  const expired = () => input.signal?.aborted === true || Date.now() >= deadline;
  await assertGithubIntegrationManager(database, input);
  const initial = await loadTarget(database, input);
  if (initial === null)
    throw notFound('That GitHub recovery target does not exist in this workspace.');
  const initialStatus = eligibility(initial, input.selector);
  if (initialStatus !== null) return { status: initialStatus };
  const installation = initial.installation;
  if (installation === null) return { status: 'installation_unavailable' };
  if (expired()) return { status: 'expired' };
  let provider: GithubRecoveryProviderSnapshot;
  try {
    provider = await (input.verifyProvider ?? verifyGithubRecoveryProvider)({
      appId: input.appId,
      privateKey: input.privateKey,
      installationId: installation.installationId,
      accountId: installation.accountId,
      repositoryId: initial.repo.repositoryId,
      pullRequestNumber: initial.pull.number,
      budgetMs: Math.min(40_000, Math.max(1, deadline - Date.now())),
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  } catch (error) {
    return { status: expired() ? 'expired' : providerFailure(error) };
  }
  if (expired()) return { status: 'expired' };
  if (!mappingMatches(initial, initial, provider, input.appId)) return { status: 'superseded' };
  if (!isActiveGithubPullRequest(provider)) return { status: 'not_active' };
  if (provider.headSha !== input.selector.expectedHeadSha) return { status: 'head_changed' };
  const providerUpdatedAt = new Date(provider.providerUpdatedAt);
  if (!Number.isFinite(providerUpdatedAt.getTime()))
    return { status: 'provider_temporarily_unavailable' };
  const now = input.now ?? new Date();
  return await queueVerifiedRecovery(
    database,
    input,
    initial,
    provider,
    providerUpdatedAt,
    deadline,
    expired,
    now,
  );
}
