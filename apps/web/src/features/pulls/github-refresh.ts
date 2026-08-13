import { and, db, eq, schema } from '@orbit/db';
import { fetchGithubPullRequestHistory, upsertGithubPullRequestHistory } from '@orbit/services';
import type { Principal } from '@orbit/shared/policy';
import type { GithubAppConfig } from '@/lib/env.ts';

export const GITHUB_HISTORY_REFRESH_MS = 5 * 60_000;

export async function refreshPullRequestHistory(input: {
  readonly principal: Principal;
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

  const history = await fetchGithubPullRequestHistory({
    appId: input.config.appId,
    privateKey: input.config.privateKey,
    installationId: pull.installationId,
    repository: pull.repository,
    number: pull.number,
    headSha: pull.headSha,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  return await db.transaction(async (tx) =>
    upsertGithubPullRequestHistory(tx, {
      organizationId: input.principal.organizationId,
      pullRequestId: pull.id,
      entries: history,
    }),
  );
}
