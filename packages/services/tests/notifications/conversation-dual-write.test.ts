import { describe, expect, it } from 'bun:test';
import {
  notification,
  notificationConversation,
  notificationInboxState,
  notificationSnoozeWake,
  notificationSourceEvent,
  organization,
  user,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { asc, eq } from 'drizzle-orm';
import {
  dismissNotification,
  markRead,
  type NotificationEvent,
  notifyMany,
  snooze,
} from '../../src/notifications/index.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

interface Fixture {
  readonly organizationId: string;
  readonly actorId: string;
  readonly recipientId: string;
}

async function seed(tx: TestTransaction): Promise<Fixture> {
  const suffix = randomUUIDv7();
  const organizationId = `org_${suffix}`;
  const actorId = `usr_actor_${suffix}`;
  const recipientId = `usr_recipient_${suffix}`;
  await tx.insert(organization).values({
    id: organizationId,
    name: 'Conversation test',
    slug: `conversation-${suffix.toLowerCase()}`,
  });
  await tx.insert(user).values([
    {
      id: actorId,
      name: 'Actor',
      email: `actor.${suffix}@orbit.test`,
      handle: `actor-${suffix.toLowerCase()}`,
    },
    {
      id: recipientId,
      name: 'Recipient',
      email: `recipient.${suffix}@orbit.test`,
      handle: `recipient-${suffix.toLowerCase()}`,
    },
  ]);
  return { organizationId, actorId, recipientId };
}

function eventFor(
  fixture: Fixture,
  sourceEventKey: string,
  overrides: Partial<NotificationEvent> = {},
): NotificationEvent {
  return {
    organizationId: fixture.organizationId,
    type: 'comment_created',
    reason: 'commented',
    actor: { type: 'user', id: fixture.actorId, name: 'Actor' },
    entityType: 'issue',
    entityId: 'iss_conversation',
    userIds: [fixture.recipientId],
    title: 'Issue activity',
    body: sourceEventKey,
    url: '/issue/CON-1',
    source: {
      sourceEventKey,
      subjectType: 'issue',
      subjectKey: 'orbit-issue:iss_conversation:activity',
      occurredAt: new Date('2026-09-01T00:00:00.000Z'),
      payload: { sourceEventKey },
    },
    ...overrides,
  };
}

describe('notification conversation compatibility writes', () => {
  it('rejects a canonical key that changes its subject identity', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const first = eventFor(fixture, `pull:${randomUUIDv7()}`, {
        type: 'pr_comment',
        entityType: 'github_pull_request',
        entityId: 'pull_1',
      });
      const second = eventFor(fixture, `pull:${randomUUIDv7()}`, {
        type: 'pr_comment',
        entityType: 'github_pull_request',
        entityId: 'pull_2',
      });
      if (first.source === undefined || second.source === undefined) {
        throw new Error('Expected sourced events.');
      }
      first.source.subjectType = 'github_pull_request';
      first.source.subjectKey = 'github-pr:99:7';
      first.source.payload = { pullRequestId: 'pull_1' };
      second.source.subjectType = 'github_pull_request';
      second.source.subjectKey = 'github-pr:99:7';
      second.source.payload = { pullRequestId: 'pull_2' };

      await notifyMany(tx, [first]);
      await expect(notifyMany(tx, [second])).rejects.toThrow('identity conflicts');
    });
  });

  it('groups live events and materializes conversation counters once', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await notifyMany(tx, [
        eventFor(fixture, `comment:${randomUUIDv7()}`),
        eventFor(fixture, `mention:${randomUUIDv7()}`, {
          type: 'mention',
          reason: 'mentioned',
          title: 'You were mentioned',
        }),
      ]);

      const events = await tx
        .select()
        .from(notification)
        .where(eq(notification.userId, fixture.recipientId))
        .orderBy(asc(notification.ingestionSeq));
      const conversations = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      const states = await tx
        .select()
        .from(notificationInboxState)
        .where(eq(notificationInboxState.userId, fixture.recipientId));

      expect(events).toHaveLength(2);
      expect(events.every((event) => event.conversationId !== null)).toBe(true);
      expect(events.every((event) => event.surfaceInInbox === true)).toBe(true);
      expect(events[0]?.ingestionSeq).toBeLessThan(events[1]?.ingestionSeq ?? 0);
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({
        conversationKey: 'orbit-issue:iss_conversation:activity',
        category: 'activity',
        eventCount: 2,
        unreadEventCount: 2,
        unreadMentionCount: 1,
        latestType: 'mention',
      });
      expect(states[0]).toMatchObject({
        unreadCount: 1,
        unreadActivityCount: 1,
        unreadMentionCount: 1,
      });
    });
  });

  it('folds event-level read and unread mutations into grouped state', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [
        eventFor(fixture, `first:${randomUUIDv7()}`),
        eventFor(fixture, `second:${randomUUIDv7()}`),
      ]);
      const firstId = outcome.notifications[0]?.id;
      const secondId = outcome.notifications[1]?.id;
      if (firstId === undefined || secondId === undefined) throw new Error('Expected two events.');

      await markRead(tx, {
        userId: fixture.recipientId,
        organizationId: fixture.organizationId,
        notificationIds: [firstId],
        read: true,
      });
      let [conversation] = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      expect(conversation?.unreadEventCount).toBe(1);

      await markRead(tx, {
        userId: fixture.recipientId,
        organizationId: fixture.organizationId,
        notificationIds: [secondId],
        read: true,
      });
      [conversation] = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      let [state] = await tx
        .select()
        .from(notificationInboxState)
        .where(eq(notificationInboxState.userId, fixture.recipientId));
      expect(conversation).toMatchObject({ unreadEventCount: 0, manualUnread: false });
      expect(state?.unreadCount).toBe(0);

      await markRead(tx, {
        userId: fixture.recipientId,
        organizationId: fixture.organizationId,
        notificationIds: [firstId],
        read: false,
      });
      [conversation] = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      [state] = await tx
        .select()
        .from(notificationInboxState)
        .where(eq(notificationInboxState.userId, fixture.recipientId));
      expect(conversation).toMatchObject({ unreadEventCount: 1, manualUnread: false });
      expect(state?.unreadCount).toBe(1);
    });
  });

  it('folds snooze and dismissal across siblings and resurfaces on new activity', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const now = new Date('2026-09-01T01:00:00.000Z');
      const until = new Date('2026-09-02T01:00:00.000Z');
      const outcome = await notifyMany(
        tx,
        [
          eventFor(fixture, `first:${randomUUIDv7()}`),
          eventFor(fixture, `second:${randomUUIDv7()}`),
        ],
        { now },
      );
      const firstId = outcome.notifications[0]?.id;
      const secondId = outcome.notifications[1]?.id;
      if (firstId === undefined || secondId === undefined) throw new Error('Expected two events.');

      await snooze(tx, {
        userId: fixture.recipientId,
        organizationId: fixture.organizationId,
        notificationId: firstId,
        until,
      });
      let [conversation] = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      expect(conversation?.snoozedUntil).toBeNull();

      await snooze(tx, {
        userId: fixture.recipientId,
        organizationId: fixture.organizationId,
        notificationId: secondId,
        until,
      });
      [conversation] = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      let [state] = await tx
        .select()
        .from(notificationInboxState)
        .where(eq(notificationInboxState.userId, fixture.recipientId));
      const wakes = await tx
        .select()
        .from(notificationSnoozeWake)
        .where(eq(notificationSnoozeWake.userId, fixture.recipientId));
      expect(conversation?.snoozedUntil?.toISOString()).toBe(until.toISOString());
      expect(state?.unreadCount).toBe(0);
      expect(wakes).toHaveLength(1);

      await dismissNotification(tx, {
        userId: fixture.recipientId,
        organizationId: fixture.organizationId,
        notificationId: firstId,
      });
      [conversation] = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      expect(conversation?.dismissedAt).toBeNull();
      await dismissNotification(tx, {
        userId: fixture.recipientId,
        organizationId: fixture.organizationId,
        notificationId: secondId,
      });
      [conversation] = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      expect(conversation?.dismissedAt).toBeInstanceOf(Date);

      await notifyMany(tx, [eventFor(fixture, `third:${randomUUIDv7()}`)], {
        now: new Date(now.getTime() + 1_000),
      });
      [conversation] = await tx
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.userId, fixture.recipientId));
      [state] = await tx
        .select()
        .from(notificationInboxState)
        .where(eq(notificationInboxState.userId, fixture.recipientId));
      expect(conversation).toMatchObject({ dismissedAt: null, snoozedUntil: null });
      expect(state?.unreadCount).toBe(1);
    });
  });

  it('does not advance inbox state when a recipient source replay inserts no event', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const sourceEventKey = `replay:${randomUUIDv7()}`;
      const event = eventFor(fixture, sourceEventKey);
      await notifyMany(tx, [event]);
      const [before] = await tx
        .select()
        .from(notificationInboxState)
        .where(eq(notificationInboxState.userId, fixture.recipientId));
      await tx
        .update(notificationSourceEvent)
        .set({ fanoutCompletedAt: null })
        .where(eq(notificationSourceEvent.sourceEventKey, sourceEventKey));

      const replay = await notifyMany(tx, [eventFor(fixture, sourceEventKey)]);
      const [after] = await tx
        .select()
        .from(notificationInboxState)
        .where(eq(notificationInboxState.userId, fixture.recipientId));

      expect(replay.notifications).toHaveLength(0);
      expect(after?.syncId).toBe(before?.syncId);
    });
  });

  it('keeps audit duplicates immutable during legacy and live compatibility writes', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const now = new Date('2026-09-01T02:00:00.000Z');
      const until = new Date('2026-09-03T02:00:00.000Z');
      const readAt = new Date('2026-09-01T02:01:00.000Z');
      const outcome = await notifyMany(tx, [eventFor(fixture, `survivor:${randomUUIDv7()}`)], {
        now,
      });
      const survivor = outcome.notifications[0];
      if (survivor?.conversationId === null || survivor === undefined) {
        throw new Error('Expected a conversation survivor.');
      }
      const auditId = randomUUIDv7();
      await tx.insert(notification).values({
        id: auditId,
        organizationId: survivor.organizationId,
        userId: survivor.userId,
        type: survivor.type,
        reason: survivor.reason,
        actorType: survivor.actorType,
        actorId: survivor.actorId,
        actorName: survivor.actorName,
        entityType: survivor.entityType,
        entityId: survivor.entityId,
        title: survivor.title,
        body: survivor.body,
        url: survivor.url,
        conversationId: survivor.conversationId,
        occurredAt: now,
        ingestedAt: now,
        ingestionSeq: 10_000,
        surfaceInInbox: false,
        deduplicatedIntoNotificationId: survivor.id,
        deliveredChannels: [],
        readAt,
        snoozedUntil: until,
      });

      const updated = await markRead(tx, {
        userId: fixture.recipientId,
        organizationId: fixture.organizationId,
        notificationIds: [auditId],
        read: false,
      });
      await notifyMany(tx, [eventFor(fixture, `new:${randomUUIDv7()}`)], {
        now: new Date(now.getTime() + 1_000),
      });
      const [audit] = await tx.select().from(notification).where(eq(notification.id, auditId));

      expect(updated).toHaveLength(0);
      expect(audit?.readAt?.toISOString()).toBe(readAt.toISOString());
      expect(audit?.snoozedUntil?.toISOString()).toBe(until.toISOString());
    });
  });
});
