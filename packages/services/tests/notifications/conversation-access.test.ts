import { expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  lockNotificationSubjectAccess,
  refreshNotificationConversationAccess,
} from '../../src/notifications/conversation-access.ts';
import {
  defaultLegacySourceResolution,
  runNotificationConversationBackfill,
  verifyNotificationConversationBackfill,
} from '../../src/notifications/conversation-backfill.ts';
import { wakeDueNotificationConversations } from '../../src/notifications/conversation-snooze.ts';

async function fixture(
  run: (data: {
    organizationId: string;
    userId: string;
    authorId: string;
    docId: string;
    conversationId: string;
  }) => Promise<void>,
) {
  const id = randomUUIDv7();
  const organizationId = `access_org_${id}`;
  const userId = `access_user_${id}`;
  const authorId = `access_author_${id}`;
  const docId = `access_doc_${id}`;
  const conversationId = `access_conversation_${id}`;
  await db.insert(schema.user).values([
    { id: userId, name: 'Reader', email: `${userId}@example.com`, handle: userId },
    { id: authorId, name: 'Author', email: `${authorId}@example.com`, handle: authorId },
  ]);
  await db
    .insert(schema.organization)
    .values({ id: organizationId, name: 'Access', slug: organizationId });
  await db
    .insert(schema.member)
    .values({ id: `member_${id}`, organizationId, userId, role: 'member' });
  await db
    .insert(schema.doc)
    .values({ id: docId, organizationId, authorId, title: 'Restricted', visibility: 'private' });
  await db.insert(schema.notificationInboxState).values({ organizationId, userId });
  await db.insert(schema.notificationConversation).values({
    id: conversationId,
    organizationId,
    userId,
    subjectType: 'doc',
    subjectId: docId,
    conversationKey: `orbit-doc:${docId}:activity`,
    category: 'activity',
    eventCount: 1,
    unreadEventCount: 1,
  });
  try {
    await run({ organizationId, userId, authorId, docId, conversationId });
  } finally {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.delete(schema.user).where(eq(schema.user.id, authorId));
  }
}

it('hides restricted history, restores it after an exact grant, and keeps shared delivery private', async () => {
  await fixture(async ({ organizationId, userId, docId, conversationId }) => {
    const check = () =>
      db.transaction(
        async (tx) =>
          await lockNotificationSubjectAccess(tx, {
            organizationId,
            userId,
            subjectType: 'doc',
            subjectId: docId,
          }),
      );
    expect(await check()).toBe(false);
    expect(
      await db.transaction(
        async (tx) => await refreshNotificationConversationAccess(tx, organizationId, userId),
      ),
    ).toEqual([conversationId]);
    const [hidden] = await db
      .select()
      .from(schema.notificationInboxState)
      .where(eq(schema.notificationInboxState.organizationId, organizationId));
    expect(hidden?.unreadCount).toBe(0);
    await db.insert(schema.docAccess).values({
      id: randomUUIDv7(),
      organizationId,
      docId,
      subjectType: 'user',
      subjectId: userId,
      level: 'read',
    });
    expect(await check()).toBe(true);
    await db.transaction(
      async (tx) => await refreshNotificationConversationAccess(tx, organizationId, userId),
    );
    const [shown] = await db
      .select()
      .from(schema.notificationInboxState)
      .where(eq(schema.notificationInboxState.organizationId, organizationId));
    const [conversation] = await db
      .select()
      .from(schema.notificationConversation)
      .where(eq(schema.notificationConversation.id, conversationId));
    expect(shown?.unreadCount).toBe(1);
    expect(conversation?.accessGeneration).toBe(2);
    expect(
      await db.transaction(
        async (tx) =>
          await lockNotificationSubjectAccess(tx, {
            organizationId,
            subjectType: 'doc',
            subjectId: docId,
          }),
      ),
    ).toBe(false);
    await db.delete(schema.member).where(eq(schema.member.userId, userId));
    expect(await check()).toBe(false);
  });
});

it('does not finalize a snooze after its claimed lease expires', async () => {
  await fixture(async ({ organizationId, userId, docId, conversationId }) => {
    await db.update(schema.doc).set({ visibility: 'workspace' }).where(eq(schema.doc.id, docId));
    const now = new Date('2026-09-08T10:00:00Z');
    const wakeAt = new Date('2026-09-08T09:00:00Z');
    const expired = new Date('2026-09-08T10:01:01Z');
    await db
      .update(schema.notificationConversation)
      .set({ snoozedUntil: wakeAt, snoozeGeneration: 1 })
      .where(eq(schema.notificationConversation.id, conversationId));
    await db.insert(schema.notificationSnoozeWake).values({
      id: randomUUIDv7(),
      organizationId,
      userId,
      conversationId,
      snoozeGeneration: 1,
      wakeAt,
    });
    const options = { now, clock: () => expired };
    expect((await wakeDueNotificationConversations(db, options)).woken).toBe(0);
    const [conversation] = await db
      .select()
      .from(schema.notificationConversation)
      .where(eq(schema.notificationConversation.id, conversationId));
    expect(conversation?.snoozedUntil?.toISOString()).toBe(wakeAt.toISOString());
    expect(conversation?.snoozeGeneration).toBe(1);
    expect((await wakeDueNotificationConversations(db, { now: expired })).woken).toBe(1);
  });
});

it('claims a due snooze once, rejects an older generation, and restores visible counters', async () => {
  await fixture(async ({ organizationId, userId, docId, conversationId }) => {
    await db.update(schema.doc).set({ visibility: 'workspace' }).where(eq(schema.doc.id, docId));
    const now = new Date('2026-09-08T10:00:00Z');
    const wakeAt = new Date('2026-09-08T09:00:00Z');
    await db
      .update(schema.notificationConversation)
      .set({ snoozedUntil: wakeAt, snoozeGeneration: 2 })
      .where(eq(schema.notificationConversation.id, conversationId));
    await db.insert(schema.notificationSnoozeWake).values(
      [1, 2].map((generation) => ({
        id: randomUUIDv7(),
        organizationId,
        userId,
        conversationId,
        snoozeGeneration: generation,
        wakeAt,
      })),
    );
    const results = await Promise.all([
      wakeDueNotificationConversations(db, { now }),
      wakeDueNotificationConversations(db, { now }),
    ]);
    expect(results.reduce((sum, result) => sum + result.woken, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.stale, 0)).toBe(1);
    expect((await wakeDueNotificationConversations(db, { now })).woken).toBe(0);
    const [state] = await db
      .select()
      .from(schema.notificationInboxState)
      .where(eq(schema.notificationInboxState.organizationId, organizationId));
    expect(state?.unreadCount).toBe(1);
    const [conversation] = await db
      .select()
      .from(schema.notificationConversation)
      .where(eq(schema.notificationConversation.id, conversationId));
    expect(conversation?.snoozedUntil).toBeNull();
    expect(conversation?.snoozeGeneration).toBe(3);
  });
});

it('refuses a nonexistent organization and incomplete migration progress', async () => {
  await expect(
    verifyNotificationConversationBackfill(db, { organizationIds: [randomUUIDv7()] }),
  ).rejects.toThrow('does not exist');
  await fixture(async ({ organizationId }) => {
    const result = await verifyNotificationConversationBackfill(db, {
      organizationIds: [organizationId],
    });
    expect(result.ok).toBe(false);
    expect(result.totals.incompleteProgressPhases).toBe(5);
  });
});

it('proves historical pull-request identity without inventing equivalence or trusting cross-workspace IDs', async () => {
  await fixture(async ({ organizationId, userId }) => {
    const integrationId = randomUUIDv7();
    const repositorySyncId = randomUUIDv7();
    const pullId = randomUUIDv7();
    await db.insert(schema.integration).values({
      id: integrationId,
      organizationId,
      provider: 'github',
      externalId: '123',
      connectedById: userId,
    });
    await db.insert(schema.githubRepositorySync).values({
      id: repositorySyncId,
      organizationId,
      integrationId,
      repositoryId: '987',
      repositoryName: 'test/repository',
    });
    await db.insert(schema.githubPullRequest).values({
      id: pullId,
      organizationId,
      repositorySyncId,
      repositoryId: '987',
      repositoryName: 'test/repository',
      number: 7,
      url: 'https://github.com/test/repository/pull/7',
    });
    const input = {
      id: randomUUIDv7(),
      organizationId,
      userId,
      type: 'pr_comment',
      entityType: 'github_pull_request',
      entityId: pullId,
      url: `/pull-requests/${pullId}`,
      createdAt: new Date(),
    };
    const resolved = await defaultLegacySourceResolution(db, input);
    expect(resolved.subjectKey).toBe('github-pr:987:7');
    expect(resolved.payload).toEqual({ pullRequestId: pullId });
    expect(resolved.sourceEventKey).toBe(`legacy-notification:${input.id}`);
    expect(resolved.equivalentNotificationIds).toEqual([input.id]);
    const denied = await defaultLegacySourceResolution(db, {
      ...input,
      organizationId: randomUUIDv7(),
    });
    expect(denied.subjectKey).toBe(`legacy-notification:${input.id}`);
    expect(
      await db.transaction(
        async (tx) =>
          await lockNotificationSubjectAccess(tx, {
            organizationId,
            userId,
            subjectType: 'github_pull_request',
            subjectKey: 'github-pr:987:7',
          }),
      ),
    ).toBe(true);
  });
});

it('makes unmapped legacy Slack delivery unavailable without using the Orbit user as a provider destination', async () => {
  await fixture(async ({ organizationId, userId, docId }) => {
    const eventId = randomUUIDv7();
    const deliveryId = randomUUIDv7();
    await db.insert(schema.notification).values({
      id: eventId,
      organizationId,
      userId,
      actorId: userId,
      actorName: 'Reader',
      type: 'mention',
      entityType: 'doc',
      entityId: docId,
      title: 'Mention',
      body: 'Hello',
      url: `/docs/${docId}`,
      deliveredChannels: [],
    });
    await db.insert(schema.notificationDelivery).values({
      id: deliveryId,
      notificationId: eventId,
      organizationId,
      userId,
      channel: 'slack_dm',
      status: 'pending',
    });
    await runNotificationConversationBackfill(db, { organizationIds: [organizationId] });
    const [delivery] = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.id, deliveryId));
    expect(delivery?.status).toBe('unavailable');
    expect(delivery?.destinationId).toBe(`legacy-unresolved:${deliveryId}`);
    expect(delivery?.sourceEventId).not.toBeNull();
    expect(delivery?.lastError).toContain('cannot be resolved');
  });
});
