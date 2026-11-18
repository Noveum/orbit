import type { Database } from '@orbit/db';
import {
  githubRepository as catalog,
  githubCheckHeadReconciliation as head,
  githubInstallation as installation,
  integration,
  githubPullRequest as pull,
  githubRepositorySync as watch,
} from '@orbit/db/schema';
import type { GithubRecoveryCandidate } from '@orbit/shared/validators';
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { assertGithubIntegrationManager } from './installations.ts';
import { RECOVERABLE_PULL_STATES } from './pull-state.ts';

export async function listGithubCheckRecoveryCandidates(
  database: Database,
  manager: { readonly organizationId: string; readonly userId: string },
): Promise<GithubRecoveryCandidate[]> {
  await assertGithubIntegrationManager(database, manager);
  return await database
    .selectDistinctOn([head.updatedAt, head.id], {
      repositoryName: watch.repositoryName,
      pullRequestNumber: pull.number,
      selector: {
        reconciliationId: head.id,
        pullRequestId: pull.id,
        expectedJobVersion: head.jobVersion,
        expectedContextGeneration: head.contextGeneration,
        expectedHeadEpoch: pull.headEpoch,
        expectedHeadSha: head.headSha,
      },
    })
    .from(head)
    .innerJoin(
      watch,
      and(eq(watch.id, head.repositorySyncId), eq(watch.organizationId, head.organizationId)),
    )
    .innerJoin(
      pull,
      and(
        eq(pull.repositorySyncId, watch.id),
        eq(pull.organizationId, watch.organizationId),
        eq(pull.repositoryId, watch.repositoryId),
        eq(pull.headSha, head.headSha),
      ),
    )
    .innerJoin(
      installation,
      and(
        eq(installation.integrationId, watch.integrationId),
        eq(installation.organizationId, watch.organizationId),
        eq(installation.installationId, watch.installationId),
      ),
    )
    .innerJoin(
      integration,
      and(
        eq(integration.id, installation.integrationId),
        eq(integration.organizationId, watch.organizationId),
        eq(integration.provider, 'github'),
        eq(integration.externalId, installation.installationId),
      ),
    )
    .innerJoin(
      catalog,
      and(
        eq(catalog.installationRowId, installation.id),
        eq(catalog.organizationId, watch.organizationId),
        eq(catalog.repositoryId, watch.repositoryId),
      ),
    )
    .where(
      and(
        eq(head.organizationId, manager.organizationId),
        eq(head.status, 'failed'),
        gt(head.jobVersion, 0),
        sql`${head.headSha} ~ '^[0-9a-f]{40}$'`,
        eq(watch.enabled, true),
        eq(installation.status, 'active'),
        ne(installation.accountId, ''),
        inArray(pull.state, RECOVERABLE_PULL_STATES),
        eq(pull.merged, false),
      ),
    )
    .orderBy(desc(head.updatedAt), asc(head.id), asc(pull.number), asc(pull.id))
    .limit(20);
}
