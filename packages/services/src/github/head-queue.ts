import { githubCheckHeadReconciliation, type githubRepositorySync } from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq } from 'drizzle-orm';
import type { GithubDatabase } from './apply.ts';

type RepositorySync = typeof githubRepositorySync.$inferSelect;

export async function lockedHeadReconciliation(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly headSha: string;
    readonly triggerKind: string;
    readonly triggerIdentity: string;
    readonly now: Date;
  },
) {
  await database
    .insert(githubCheckHeadReconciliation)
    .values({
      id: randomUUIDv7(),
      organizationId: context.repo.organizationId,
      repositorySyncId: context.repo.id,
      headSha: context.headSha,
      status: 'completed',
      triggerKind: context.triggerKind,
      triggerIdentity: context.triggerIdentity,
      availableAt: context.now,
      updatedAt: context.now,
    })
    .onConflictDoNothing();
  const [head] = await database
    .select()
    .from(githubCheckHeadReconciliation)
    .where(
      and(
        eq(githubCheckHeadReconciliation.organizationId, context.repo.organizationId),
        eq(githubCheckHeadReconciliation.repositorySyncId, context.repo.id),
        eq(githubCheckHeadReconciliation.headSha, context.headSha),
      ),
    )
    .limit(1)
    .for('update');
  if (head === undefined) throw new Error('GitHub head reconciliation row was not created.');
  return head;
}

export async function enqueueHeadReconciliation(
  database: GithubDatabase,
  context: {
    readonly repo: RepositorySync;
    readonly headSha: string;
    readonly triggerKind: string;
    readonly triggerIdentity: string;
    readonly now: Date;
  },
): Promise<void> {
  const head = await lockedHeadReconciliation(database, context);
  const processing = head.status === 'processing';
  await database
    .update(githubCheckHeadReconciliation)
    .set({
      status: processing ? 'processing' : 'pending',
      jobVersion: head.jobVersion + 1,
      triggerKind: context.triggerKind,
      triggerIdentity: context.triggerIdentity,
      attempts: 0,
      availableAt: context.now,
      settleDeadline: null,
      rerunRequired: processing,
      lastError: null,
      ...(processing
        ? {}
        : {
            claimToken: null,
            claimedAt: null,
            leaseExpiresAt: null,
            claimedJobVersion: null,
            claimedContextGeneration: null,
          }),
      updatedAt: context.now,
    })
    .where(eq(githubCheckHeadReconciliation.id, head.id));
}
