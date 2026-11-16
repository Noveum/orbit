import { describe, expect, it } from 'bun:test';
import { db, eq, schema, sql } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  bindGithubInstallation,
  purgeGithubInstallation,
  removeGithubInstallation,
  replaceGithubRepositories,
} from '../../src/github/installations.ts';
import {
  forgetWatchedRepositories,
  reconcileWatchedRepositories,
} from '../../src/github/watched.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';
import { account, repository, seedWorkspace, type TestWorkspace } from './fixtures.ts';

async function checkedInstallation(
  tx: TestTransaction,
  existing?: TestWorkspace,
  provenance = 'fetch',
) {
  const workspace = existing ?? (await seedWorkspace(tx));
  const installationId = randomUUIDv7();
  const installation = await bindGithubInstallation(tx, {
    organizationId: workspace.organizationId,
    connectedById: workspace.userId,
    account: account({ installationId }),
  });
  const repositorySyncId = randomUUIDv7();
  await replaceGithubRepositories(tx, {
    installation,
    repositories: [repository({ repositoryId: repositorySyncId })],
  });
  const headId = randomUUIDv7();
  const fetchId = randomUUIDv7();
  const activityId = randomUUIDv7();
  const deliveryId = randomUUIDv7();
  const contextId = randomUUIDv7();
  const pullId = randomUUIDv7();
  const headSha = 'a'.repeat(40);
  const now = new Date('2026-08-01T12:00:00Z');
  const owner = { organizationId: workspace.organizationId, repositorySyncId, headSha };
  await tx.insert(schema.githubRepositorySync).values({
    id: repositorySyncId,
    organizationId: workspace.organizationId,
    integrationId: installation.integrationId,
    repositoryId: repositorySyncId,
    repositoryName: 'acme/web',
    installationId,
  });
  await tx.insert(schema.githubCheckHeadReconciliation).values({
    id: headId,
    ...owner,
    status: 'completed',
    triggerKind: 'check_run',
    triggerIdentity: headId,
  });
  await tx.insert(schema.githubCheckReconciliationFetch).values({
    id: fetchId,
    ...owner,
    headReconciliationId: headId,
    attemptNumber: 1,
    capturedJobVersion: 0,
    capturedContextGeneration: 0,
    claimToken: randomUUIDv7(),
    disposition: 'accepted',
  });
  await tx
    .update(schema.githubCheckHeadReconciliation)
    .set({ acceptedFetchAttemptId: fetchId })
    .where(eq(schema.githubCheckHeadReconciliation.id, headId));
  await tx.insert(schema.webhookDelivery).values({
    id: deliveryId,
    organizationId: workspace.organizationId,
    provider: 'github',
    deliveryId,
    event: 'check_run',
    status: 'processed',
  });
  await tx.insert(schema.githubCheckActivity).values({
    id: activityId,
    ...owner,
    sourceKind: 'check_run',
    contextKey: 'ci',
    providerObjectId: 'check-1',
    providerUpdatedAt: now,
    reconciliationFetchId: provenance === 'fetch' ? fetchId : null,
    webhookDeliveryId: provenance === 'webhook' ? deliveryId : null,
    state: 'success',
    occurredAt: now,
  });
  await tx.insert(schema.githubCheckHeadContext).values({
    id: contextId,
    ...owner,
    contextKey: 'ci',
    sourceKind: 'check_run',
    state: 'success',
    providerUpdatedAt: now,
    latestProviderObjectId: 'check-1',
    latestActivityId: activityId,
  });
  await tx.insert(schema.githubPullRequest).values({
    id: pullId,
    organizationId: workspace.organizationId,
    repositorySyncId,
    repositoryId: repositorySyncId,
    repositoryName: 'acme/web',
    number: 1,
    url: 'https://github.com/acme/web/pull/1',
    headSha,
    state: 'open',
  });
  await tx.insert(schema.githubPullRequestCheckContext).values({
    id: randomUUIDv7(),
    ...owner,
    pullRequestId: pullId,
    headContextId: contextId,
    contextKey: 'ci',
    capturedHeadEpoch: 0,
    projectedContextVersion: 0,
    projectedState: 'success',
    latestActivityId: activityId,
  });
  return {
    ...workspace,
    installationId,
    integrationId: installation.integrationId,
    repositorySyncId,
    activityId,
    fetchId,
  };
}

describe('populated GitHub installation removal', () => {
  it.each(
    ['disconnect', 'uninstall', 'forget', 'reconcile', 'workspace'].flatMap((operation) =>
      ['fetch', 'webhook'].map((provenance) => ({ operation, provenance })),
    ),
  )(
    'removes the $provenance check graph through $operation without weakening unrelated workspaces',
    async ({ operation, provenance }) => {
      await withRollback(async (tx) => {
        const fixture = await checkedInstallation(tx, undefined, provenance);
        const sibling =
          operation === 'disconnect' || operation === 'uninstall'
            ? await checkedInstallation(tx, fixture)
            : null;
        const other = await checkedInstallation(tx);
        if (operation === 'disconnect') {
          expect(await removeGithubInstallation(tx, fixture)).toBe(true);
        } else if (operation === 'uninstall') {
          expect(await purgeGithubInstallation(tx, fixture.installationId)).toBe(true);
        } else if (operation === 'forget') {
          expect(
            await forgetWatchedRepositories(tx, {
              organizationId: fixture.organizationId,
              repositoryIds: [fixture.repositorySyncId],
            }),
          ).toBe(1);
        } else if (operation === 'reconcile') {
          expect(await reconcileWatchedRepositories(tx, fixture.organizationId)).toBe(0);
        } else {
          await tx
            .delete(schema.organization)
            .where(eq(schema.organization.id, fixture.organizationId));
        }
        expect(
          await tx
            .select()
            .from(schema.githubCheckActivity)
            .where(eq(schema.githubCheckActivity.id, fixture.activityId)),
        ).toHaveLength(0);
        expect(
          await tx
            .select()
            .from(schema.githubCheckHeadContext)
            .where(eq(schema.githubCheckHeadContext.repositorySyncId, fixture.repositorySyncId)),
        ).toHaveLength(0);
        expect(
          await tx
            .select()
            .from(schema.githubPullRequestCheckContext)
            .where(
              eq(schema.githubPullRequestCheckContext.repositorySyncId, fixture.repositorySyncId),
            ),
        ).toHaveLength(0);
        expect(
          await tx
            .select()
            .from(schema.githubCheckActivity)
            .where(eq(schema.githubCheckActivity.id, other.activityId)),
        ).toHaveLength(1);
        if (sibling !== null)
          expect(
            await tx
              .select()
              .from(schema.githubCheckActivity)
              .where(eq(schema.githubCheckActivity.id, sibling.activityId)),
          ).toHaveLength(1);
      });
    },
  );

  it('rejects deleting the latest activity while its live contexts remain', async () => {
    await withRollback(async (tx) => {
      const fixture = await checkedInstallation(tx);
      await expect(
        tx.transaction(async (savepoint) => {
          await savepoint
            .delete(schema.githubCheckActivity)
            .where(eq(schema.githubCheckActivity.id, fixture.activityId));
        }),
      ).rejects.toThrow();
      expect(
        await tx
          .select()
          .from(schema.githubCheckActivity)
          .where(eq(schema.githubCheckActivity.id, fixture.activityId)),
      ).toHaveLength(1);
    });
  });

  it('rejects deleting an accepted fetch while its evidence remains', async () => {
    await withRollback(async (tx) => {
      const fixture = await checkedInstallation(tx);
      await expect(
        tx.transaction(async (savepoint) => {
          await savepoint
            .delete(schema.githubCheckReconciliationFetch)
            .where(eq(schema.githubCheckReconciliationFetch.id, fixture.fetchId));
        }),
      ).rejects.toThrow();
    });
  });
});

describe('direct database installation removal', () => {
  it('rolls back the whole removal when integration deletion fails', async () => {
    const fixture = await db.transaction(async (tx) => checkedInstallation(tx));
    const trigger = `test_remove_${randomUUIDv7().replaceAll('-', '')}`;
    const functionName = `${trigger}_fn`;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(
            `create function "${functionName}"() returns trigger language plpgsql as $$ begin raise exception 'integration removal failure fixture'; end $$`,
          ),
        );
        await tx.execute(
          sql.raw(
            `create trigger "${trigger}" before delete on integration for each row when (old.id = '${fixture.integrationId}') execute function "${functionName}"()`,
          ),
        );
      });
      await expect(removeGithubInstallation(db, fixture)).rejects.toMatchObject({
        cause: { message: 'integration removal failure fixture' },
      });
      expect(
        await db
          .select()
          .from(schema.githubInstallation)
          .where(eq(schema.githubInstallation.installationId, fixture.installationId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.githubCheckActivity)
          .where(eq(schema.githubCheckActivity.id, fixture.activityId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.githubCheckHeadContext)
          .where(eq(schema.githubCheckHeadContext.repositorySyncId, fixture.repositorySyncId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.githubPullRequestCheckContext)
          .where(
            eq(schema.githubPullRequestCheckContext.repositorySyncId, fixture.repositorySyncId),
          ),
      ).toHaveLength(1);
    } finally {
      await db.execute(sql.raw(`drop trigger if exists "${trigger}" on integration`));
      await db.execute(sql.raw(`drop function if exists "${functionName}"()`));
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, fixture.organizationId));
      await db.delete(schema.user).where(eq(schema.user.id, fixture.userId));
    }
  });
});
