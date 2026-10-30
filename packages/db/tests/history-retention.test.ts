import { describe, expect, it } from 'bun:test';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { pruneHistoryTables } from '../src/history-retention.ts';
import { db, eq, schema, type Transaction } from '../src/index.ts';

const OLD = new Date(Date.now() - 60 * 86_400_000);
const RECENT = new Date(Date.now() - 60_000);

async function withFixture(run: (tx: Transaction, fixture: Fixture) => Promise<void>) {
  const rollback = Symbol('rollback');
  try {
    await db.transaction(async (tx) => {
      const suffix = randomUUIDv7();
      const userId = `retention-user-${suffix}`;
      const organizationId = `retention-org-${suffix}`;
      const integrationId = `retention-integration-${suffix}`;
      const repositorySyncId = `retention-repository-${suffix}`;
      await tx.insert(schema.user).values({
        id: userId,
        name: 'Retention owner',
        email: `${suffix}@retention.test`,
        handle: `retention-${suffix}`,
      });
      await tx.insert(schema.organization).values({
        id: organizationId,
        name: 'Retention workspace',
        slug: `retention-${suffix}`,
      });
      await tx.insert(schema.integration).values({
        id: integrationId,
        organizationId,
        provider: 'github',
        externalId: suffix,
        connectedById: userId,
      });
      await tx.insert(schema.githubRepositorySync).values({
        id: repositorySyncId,
        organizationId,
        integrationId,
        repositoryId: suffix,
        repositoryName: 'retention/repository',
      });
      await run(tx, { userId, organizationId, repositorySyncId });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

interface Fixture {
  readonly userId: string;
  readonly organizationId: string;
  readonly repositorySyncId: string;
}

async function activity(tx: Transaction, fixture: Fixture, createdAt: Date) {
  const id = randomUUIDv7();
  const deliveryId = randomUUIDv7();
  await tx.insert(schema.webhookDelivery).values({
    id: deliveryId,
    organizationId: fixture.organizationId,
    provider: 'github',
    deliveryId,
    event: 'check_run',
    status: 'processed',
    createdAt,
  });
  await tx.insert(schema.githubCheckActivity).values({
    id,
    organizationId: fixture.organizationId,
    repositorySyncId: fixture.repositorySyncId,
    headSha: 'a'.repeat(40),
    sourceKind: 'check_run',
    contextKey: id,
    providerObjectId: id,
    providerUpdatedAt: createdAt,
    webhookDeliveryId: deliveryId,
    state: 'success',
    occurredAt: createdAt,
    createdAt,
  });
  return id;
}

async function headContext(tx: Transaction, fixture: Fixture, activityId: string) {
  const headId = randomUUIDv7();
  await tx.insert(schema.githubCheckHeadReconciliation).values({
    id: headId,
    organizationId: fixture.organizationId,
    repositorySyncId: fixture.repositorySyncId,
    headSha: 'a'.repeat(40),
    status: 'completed',
    triggerKind: 'check_run',
    triggerIdentity: headId,
    createdAt: OLD,
    updatedAt: OLD,
  });
  await tx.insert(schema.githubCheckHeadContext).values({
    id: randomUUIDv7(),
    organizationId: fixture.organizationId,
    repositorySyncId: fixture.repositorySyncId,
    headSha: 'a'.repeat(40),
    contextKey: activityId,
    sourceKind: 'check_run',
    state: 'success',
    providerUpdatedAt: OLD,
    latestProviderObjectId: activityId,
    latestActivityId: activityId,
    createdAt: OLD,
    updatedAt: OLD,
  });
  return headId;
}

async function pullRequest(tx: Transaction, fixture: Fixture, state = 'open') {
  const id = randomUUIDv7();
  await tx.insert(schema.githubPullRequest).values({
    id,
    organizationId: fixture.organizationId,
    repositorySyncId: fixture.repositorySyncId,
    repositoryId: fixture.repositorySyncId,
    repositoryName: 'retention/repository',
    number: 1,
    url: 'https://github.com/retention/repository/pull/1',
    headSha: 'a'.repeat(40),
    state,
  });
  return id;
}

describe('history retention', () => {
  it('deletes old unreferenced checks and keeps recent checks', async () => {
    await withFixture(async (tx, fixture) => {
      const oldId = await activity(tx, fixture, OLD);
      const recentId = await activity(tx, fixture, RECENT);
      await pruneHistoryTables(tx);
      const rows = await tx
        .select({ id: schema.githubCheckActivity.id })
        .from(schema.githubCheckActivity)
        .where(eq(schema.githubCheckActivity.organizationId, fixture.organizationId));
      expect(rows.map((row) => row.id)).toEqual([recentId]);
      expect(rows.some((row) => row.id === oldId)).toBe(false);
    });
  });

  it.each(['open', 'draft', 'approved', 'changes_requested'])(
    'keeps current check state for a live %s pull even when it is old',
    async (state) => {
      await withFixture(async (tx, fixture) => {
        const id = await activity(tx, fixture, OLD);
        await headContext(tx, fixture, id);
        const pullId = await pullRequest(tx, fixture, state);
        const [context] = await tx
          .select()
          .from(schema.githubCheckHeadContext)
          .where(eq(schema.githubCheckHeadContext.latestActivityId, id));
        if (context === undefined) throw new Error('Missing seeded check context');
        const projectionId = randomUUIDv7();
        await tx.insert(schema.githubPullRequestCheckContext).values({
          id: projectionId,
          organizationId: fixture.organizationId,
          repositorySyncId: fixture.repositorySyncId,
          pullRequestId: pullId,
          headContextId: context.id,
          headSha: context.headSha,
          contextKey: context.contextKey,
          capturedHeadEpoch: 0,
          projectedContextVersion: 0,
          projectedState: 'success',
          latestActivityId: id,
        });
        await pruneHistoryTables(tx);
        expect(
          await tx
            .select()
            .from(schema.githubCheckActivity)
            .where(eq(schema.githubCheckActivity.id, id)),
        ).toHaveLength(1);
        expect(
          await tx
            .select()
            .from(schema.githubPullRequestCheckContext)
            .where(eq(schema.githubPullRequestCheckContext.id, projectionId)),
        ).toHaveLength(1);
      });
    },
  );

  it('retires obsolete check contexts and their audit rows', async () => {
    await withFixture(async (tx, fixture) => {
      const id = await activity(tx, fixture, OLD);
      await headContext(tx, fixture, id);
      await pruneHistoryTables(tx);
      expect(
        await tx
          .select()
          .from(schema.githubCheckActivity)
          .where(eq(schema.githubCheckActivity.id, id)),
      ).toHaveLength(0);
      expect(
        await tx
          .select()
          .from(schema.githubCheckHeadContext)
          .where(eq(schema.githubCheckHeadContext.organizationId, fixture.organizationId)),
      ).toHaveLength(0);
    });
  });

  it('preserves pending reconciliation evidence', async () => {
    await withFixture(async (tx, fixture) => {
      const id = await activity(tx, fixture, OLD);
      const headId = await headContext(tx, fixture, id);
      await tx
        .update(schema.githubCheckHeadReconciliation)
        .set({ status: 'pending' })
        .where(eq(schema.githubCheckHeadReconciliation.id, headId));
      await pruneHistoryTables(tx);
      expect(
        await tx
          .select()
          .from(schema.githubCheckActivity)
          .where(eq(schema.githubCheckActivity.id, id)),
      ).toHaveLength(1);
    });
  });

  it('detaches expired audit evidence while preserving the PR timeline', async () => {
    await withFixture(async (tx, fixture) => {
      const id = await activity(tx, fixture, OLD);
      const pullId = await pullRequest(tx, fixture);
      const timelineId = randomUUIDv7();
      await tx.insert(schema.githubPullRequestActivity).values({
        id: timelineId,
        organizationId: fixture.organizationId,
        pullRequestId: pullId,
        checkActivityId: id,
        externalId: id,
        type: 'check',
        action: 'completed',
        body: 'CI passed',
        occurredAt: OLD,
      });
      await pruneHistoryTables(tx);
      const [timeline] = await tx
        .select()
        .from(schema.githubPullRequestActivity)
        .where(eq(schema.githubPullRequestActivity.id, timelineId));
      expect(timeline?.body).toBe('CI passed');
      expect(timeline?.checkActivityId).toBeNull();
      expect(
        await tx
          .select()
          .from(schema.githubCheckActivity)
          .where(eq(schema.githubCheckActivity.id, id)),
      ).toHaveLength(0);
    });
  });

  it('caps recent document snapshots at five and keeps the newest old snapshot', async () => {
    await withFixture(async (tx, fixture) => {
      for (const age of [OLD, RECENT]) {
        const docId = randomUUIDv7();
        await tx.insert(schema.doc).values({
          id: docId,
          organizationId: fixture.organizationId,
          authorId: fixture.userId,
          title: 'Current title',
          content: 'Current content',
        });
        for (let position = 0; position < 8; position += 1) {
          await tx.insert(schema.docVersion).values({
            id: `${docId}-${position}`,
            docId,
            organizationId: fixture.organizationId,
            ownedById: fixture.userId,
            title: 'Snapshot',
            content: `Version ${position}`,
            lastSavedAt: new Date(age.getTime() + position),
          });
        }
        await pruneHistoryTables(tx);
        const versions = await tx
          .select()
          .from(schema.docVersion)
          .where(eq(schema.docVersion.docId, docId));
        expect(versions).toHaveLength(age === OLD ? 1 : 5);
        expect(versions.some((version) => version.id === `${docId}-7`)).toBe(true);
        const [doc] = await tx.select().from(schema.doc).where(eq(schema.doc.id, docId));
        expect(doc?.content).toBe('Current content');
      }
    });
  });
});
