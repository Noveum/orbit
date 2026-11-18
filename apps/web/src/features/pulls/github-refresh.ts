import { and, db, eq, isNull, lt, or, schema } from '@orbit/db';
import {
  fetchGithubPullRequestHistory,
  lockGithubRepositoryBinding,
  upsertGithubPullRequestHistory,
} from '@orbit/services';
import type { Principal } from '@orbit/shared/policy';
import type { GithubAppConfig } from '@/lib/env.ts';

export const GITHUB_HISTORY_REFRESH_MS = 5 * 60_000;
export const GITHUB_HISTORY_REFRESH_LEASE_MS = 2 * 60_000;

export async function refreshPullRequestHistory(input: {
  readonly principal: Pick<Principal, 'organizationId' | 'userId'>;
  readonly pullRequestId: string;
  readonly config: GithubAppConfig;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<number> {
  if (input.config.appId.length === 0 || input.config.privateKey.length === 0) return 0;
  const [membership] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, input.principal.organizationId),
        eq(schema.member.userId, input.principal.userId),
      ),
    )
    .limit(1);
  if (membership === undefined) return 0;

  const [pull] = await db
    .select({
      id: schema.githubPullRequest.id,
      repository: schema.githubPullRequest.repositoryName,
      number: schema.githubPullRequest.number,
      headSha: schema.githubPullRequest.headSha,
      historySyncedAt: schema.githubPullRequest.historySyncedAt,
      installationId: schema.githubInstallation.installationId,
      installationRowId: schema.githubInstallation.id,
      integrationId: schema.githubRepositorySync.integrationId,
      repositorySyncId: schema.githubRepositorySync.id,
      repositoryId: schema.githubRepositorySync.repositoryId,
    })
    .from(schema.githubPullRequest)
    .innerJoin(
      schema.githubRepositorySync,
      eq(schema.githubRepositorySync.id, schema.githubPullRequest.repositorySyncId),
    )
    .innerJoin(
      schema.githubInstallation,
      and(
        eq(schema.githubInstallation.integrationId, schema.githubRepositorySync.integrationId),
        eq(schema.githubInstallation.organizationId, input.principal.organizationId),
        eq(schema.githubInstallation.status, 'active'),
      ),
    )
    .where(
      and(
        eq(schema.githubPullRequest.id, input.pullRequestId),
        eq(schema.githubPullRequest.organizationId, input.principal.organizationId),
      ),
    )
    .limit(1);
  if (pull === undefined) return 0;
  if (
    pull.historySyncedAt !== null &&
    Date.now() - pull.historySyncedAt.getTime() < GITHUB_HISTORY_REFRESH_MS
  ) {
    return 0;
  }

  const claimedAt = new Date();
  const binding = {
    organizationId: input.principal.organizationId,
    installationRowId: pull.installationRowId,
    integrationId: pull.integrationId,
    installationId: pull.installationId,
    repositorySyncId: pull.repositorySyncId,
    repositoryId: pull.repositoryId,
  };
  const didClaim = await db.transaction(async (tx) => {
    if ((await lockGithubRepositoryBinding(tx, binding)) === null) return false;
    const claimed = await tx
      .update(schema.githubPullRequest)
      .set({ historyRefreshClaimedAt: claimedAt })
      .where(
        and(
          eq(schema.githubPullRequest.id, pull.id),
          eq(schema.githubPullRequest.repositorySyncId, pull.repositorySyncId),
          eq(schema.githubPullRequest.organizationId, input.principal.organizationId),
          or(
            isNull(schema.githubPullRequest.historySyncedAt),
            lt(
              schema.githubPullRequest.historySyncedAt,
              new Date(claimedAt.getTime() - GITHUB_HISTORY_REFRESH_MS),
            ),
          ),
          or(
            isNull(schema.githubPullRequest.historyRefreshClaimedAt),
            lt(
              schema.githubPullRequest.historyRefreshClaimedAt,
              new Date(claimedAt.getTime() - GITHUB_HISTORY_REFRESH_LEASE_MS),
            ),
          ),
        ),
      )
      .returning({ id: schema.githubPullRequest.id });
    return claimed.length === 1;
  });
  if (!didClaim) return 0;

  try {
    const history = await fetchGithubPullRequestHistory({
      appId: input.config.appId,
      privateKey: input.config.privateKey,
      installationId: pull.installationId,
      repository: pull.repository,
      number: pull.number,
      headSha: pull.headSha,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });
    return await db.transaction(async (tx) => {
      if ((await lockGithubRepositoryBinding(tx, binding)) === null) return 0;
      const [current] = await tx
        .select({ id: schema.githubPullRequest.id })
        .from(schema.githubPullRequest)
        .where(
          and(
            eq(schema.githubPullRequest.id, pull.id),
            eq(schema.githubPullRequest.organizationId, input.principal.organizationId),
            eq(schema.githubPullRequest.repositorySyncId, pull.repositorySyncId),
            eq(schema.githubPullRequest.historyRefreshClaimedAt, claimedAt),
          ),
        )
        .for('update');
      if (current === undefined) return 0;
      return await upsertGithubPullRequestHistory(tx, {
        organizationId: input.principal.organizationId,
        pullRequestId: pull.id,
        entries: history,
      });
    });
  } catch (error) {
    await db.transaction(async (tx) => {
      if ((await lockGithubRepositoryBinding(tx, binding)) === null) return;
      await tx
        .update(schema.githubPullRequest)
        .set({ historyRefreshClaimedAt: null })
        .where(
          and(
            eq(schema.githubPullRequest.id, pull.id),
            eq(schema.githubPullRequest.organizationId, input.principal.organizationId),
            eq(schema.githubPullRequest.repositorySyncId, pull.repositorySyncId),
            eq(schema.githubPullRequest.historyRefreshClaimedAt, claimedAt),
          ),
        );
    });
    throw error;
  }
}
