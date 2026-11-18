import { describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { applyGithubInstallationEvent, bindGithubInstallation } from '@orbit/services';
import { DomainError } from '@orbit/shared/errors';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  awaitReplacementBarrier,
  createReplacementFixture,
  observeReplacement,
  replacementBarrier,
  replacementWorkspace,
} from './github-replacement-fixture.ts';

async function parentAndWatch(fixture: Awaited<ReturnType<typeof createReplacementFixture>>) {
  const [installation] = await db
    .select()
    .from(schema.githubInstallation)
    .where(eq(schema.githubInstallation.id, fixture.original.id));
  const [watch] = await db
    .select()
    .from(schema.githubRepositorySync)
    .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
  return { installation, watch };
}

describe('replacement boundary current policy and binding', () => {
  for (const mode of [
    'demotion',
    'workspace-deletion',
    'new-watch',
    'old-uninstall',
    'target-claim',
  ] as const) {
    it(`does not adopt after ${mode} changes during provider proof`, async () => {
      const fixture = await createReplacementFixture();
      const before = await parentAndWatch(fixture);
      const barrier = replacementBarrier();
      let blocked = false;
      fixture.state.intercept = async (url, init) => {
        if (
          !blocked &&
          url.pathname === '/installation/repositories' &&
          new Headers(init?.headers).get('authorization') ===
            `Bearer local-boundary-installation-${fixture.newId}`
        ) {
          blocked = true;
          await barrier.hold();
        }
        return undefined;
      };
      const work = observeReplacement(fixture.adopt());
      try {
        await awaitReplacementBarrier(barrier.arrived, work);
        if (mode === 'demotion')
          await db
            .update(schema.member)
            .set({ role: 'member' })
            .where(
              and(
                eq(schema.member.organizationId, fixture.workspace.organizationId),
                eq(schema.member.userId, fixture.workspace.adminUser.id),
              ),
            );
        if (mode === 'workspace-deletion')
          await db
            .update(schema.organization)
            .set({ deletionRequestedAt: new Date() })
            .where(eq(schema.organization.id, fixture.workspace.organizationId));
        if (mode === 'new-watch')
          await db.insert(schema.githubRepositorySync).values({
            id: randomUUIDv7(),
            organizationId: fixture.workspace.organizationId,
            integrationId: fixture.original.integrationId,
            installationId: fixture.oldId,
            repositoryId: '12',
            repositoryName: 'fixture-account/unproven',
            defaultBranch: 'main',
          });
        if (mode === 'old-uninstall')
          await applyGithubInstallationEvent(db, {
            eventName: 'installation',
            body: { action: 'deleted', installation: { id: Number(fixture.oldId) } },
          });
        if (mode === 'target-claim') {
          const other = await replacementWorkspace();
          await db.transaction((tx) =>
            bindGithubInstallation(tx, {
              organizationId: other.organizationId,
              connectedById: other.adminUser.id,
              account: {
                installationId: fixture.newId,
                accountId: '42',
                accountLogin: 'fixture-account',
                accountType: 'Organization',
                repositorySelection: 'selected',
                suspended: false,
              },
            }),
          );
        }
        barrier.release();
        const result = await work;
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('A changed binding or policy was accepted');
        expect(result.error).toBeInstanceOf(DomainError);
        if (mode === 'old-uninstall') {
          expect((await parentAndWatch(fixture)).installation).toBeUndefined();
          const recreated = await db
            .select()
            .from(schema.githubInstallation)
            .where(eq(schema.githubInstallation.organizationId, fixture.workspace.organizationId));
          expect(recreated).toHaveLength(0);
        } else expect(await parentAndWatch(fixture)).toEqual(before);
        expect(fixture.counts.oauth).toBe(2);
      } finally {
        barrier.release();
        await work;
      }
    });
  }
});

describe('replacement boundary active work and locks', () => {
  for (const kind of ['head', 'pull'] as const) {
    it(`rejects an expired processing ${kind} without resetting its durable claim`, async () => {
      const fixture = await createReplacementFixture();
      const id = randomUUIDv7();
      const prior = new Date(Date.now() - 180_000);
      const common = {
        id,
        organizationId: fixture.workspace.organizationId,
        repositorySyncId: fixture.watch.id,
        status: 'processing',
        attempts: 8,
        jobVersion: 3,
        claimToken: randomUUIDv7(),
        claimedAt: prior,
        leaseExpiresAt: new Date(prior.getTime() + 1000),
        claimedJobVersion: 3,
      };
      if (kind === 'head')
        await db.insert(schema.githubCheckHeadReconciliation).values({
          ...common,
          headSha: 'a'.repeat(40),
          contextGeneration: 2,
          claimedContextGeneration: 2,
          triggerKind: 'manual_recovery',
          triggerIdentity: 'local-preserved-manual',
        });
      else
        await db.insert(schema.githubPullRequestReconciliation).values({
          ...common,
          pullRequestId: fixture.pullId,
          capturedHeadEpoch: 3,
          claimedHeadEpoch: 3,
          conflictingHeadShas: ['a'.repeat(40), 'b'.repeat(40)],
          conflictingProviderUpdatedAt: prior,
          triggerIdentity: 'local-preserved-pull',
        });
      const beforeHead = await db
        .select()
        .from(schema.githubCheckHeadReconciliation)
        .where(eq(schema.githubCheckHeadReconciliation.id, id));
      const beforePull = await db
        .select()
        .from(schema.githubPullRequestReconciliation)
        .where(eq(schema.githubPullRequestReconciliation.id, id));
      const result = await observeReplacement(fixture.adopt());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('A processing claim was overwritten');
      expect(result.error).toMatchObject({
        code: 'conflict',
        details: { reason: 'github_replacement_conflict' },
      });
      expect(
        await db
          .select()
          .from(schema.githubCheckHeadReconciliation)
          .where(eq(schema.githubCheckHeadReconciliation.id, id)),
      ).toEqual(beforeHead);
      expect(
        await db
          .select()
          .from(schema.githubPullRequestReconciliation)
          .where(eq(schema.githubPullRequestReconciliation.id, id)),
      ).toEqual(beforePull);
      expect((await parentAndWatch(fixture)).installation?.installationId).toBe(fixture.oldId);
    });
  }

  it('rejects a live history claim without consuming or clearing it', async () => {
    const fixture = await createReplacementFixture();
    const claimedAt = new Date();
    await db
      .update(schema.githubPullRequest)
      .set({ historyRefreshClaimedAt: claimedAt })
      .where(eq(schema.githubPullRequest.id, fixture.pullId));
    await expect(fixture.adopt()).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'github_replacement_conflict' },
    });
    const [pull] = await db
      .select()
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.id, fixture.pullId));
    expect(pull?.historyRefreshClaimedAt).toEqual(claimedAt);
    expect((await parentAndWatch(fixture)).installation?.installationId).toBe(fixture.oldId);
  });

  it('returns a finite conflict instead of waiting behind the repository-first worker lock order', async () => {
    const fixture = await createReplacementFixture();
    const barrier = replacementBarrier();
    const held = observeReplacement(
      db.transaction(async (tx) => {
        await tx
          .select({ id: schema.githubRepositorySync.id })
          .from(schema.githubRepositorySync)
          .where(eq(schema.githubRepositorySync.id, fixture.watch.id))
          .for('update');
        await barrier.hold();
      }),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, held);
      const startedAt = performance.now();
      const result = await observeReplacement(fixture.adopt());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('A held worker row was adopted');
      expect(result.error).toMatchObject({
        code: 'conflict',
        details: { reason: 'github_replacement_conflict' },
      });
      expect(performance.now() - startedAt).toBeLessThan(5000);
      expect((await parentAndWatch(fixture)).installation?.installationId).toBe(fixture.oldId);
    } finally {
      barrier.release();
      await held;
    }
  });

  it('retains unknown integration configuration and paused workspace policy in the successful path', async () => {
    const fixture = await createReplacementFixture();
    const config = { unknown: { nested: [null, true, 'opaque'] }, disabledPolicy: false };
    const credentials = { unknown: { retained: ['opaque-local-fixture'] } };
    await db
      .update(schema.integration)
      .set({ config, credentials })
      .where(eq(schema.integration.id, fixture.original.integrationId));
    await db
      .update(schema.githubRepositorySync)
      .set({
        enabled: false,
        teamId: fixture.workspace.teamId,
        pullRequestsBackfilledAt: new Date('2026-11-01T00:00:00Z'),
      })
      .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
    const before = await parentAndWatch(fixture);
    await fixture.adopt();
    const [integration] = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.id, fixture.original.integrationId));
    expect(integration?.config).toEqual(config);
    expect(integration?.credentials).toEqual(credentials);
    const after = await parentAndWatch(fixture);
    expect(after.watch?.enabled).toBe(false);
    expect(after.watch?.teamId).toBe(before.watch?.teamId);
    expect(after.watch?.pullRequestsBackfilledAt).toEqual(before.watch?.pullRequestsBackfilledAt);
  });
});
