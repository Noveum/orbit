import {
  notification,
  notificationPreference,
  notificationSetting,
  organization,
  user,
} from '@orbit/db/schema';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES, syncActionSchema } from '@orbit/shared';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDatabase, type TestTransaction, withRollback } from '../test-database.ts';
import {
  defaultPreferences,
  isWithinQuietHours,
  listInbox,
  markAllRead,
  markRead,
  type NotificationEvent,
  nextQuietHoursEnd,
  notifyMany,
  parseClock,
  snooze,
  unreadCount,
} from './index.ts';

afterAll(async () => {
  await closeTestDatabase();
});

interface Fixture {
  readonly organizationId: string;
  readonly actorId: string;
  readonly adaId: string;
  readonly graceId: string;
}

async function seed(tx: TestTransaction, timezone = 'UTC'): Promise<Fixture> {
  const suffix = ulid();
  const organizationId = `org_${suffix}`;
  await tx.insert(organization).values({
    id: organizationId,
    name: 'Acme',
    slug: `acme-${suffix.toLowerCase()}`,
  });
  const people = ['actor', 'ada', 'grace'].map((label) => ({
    id: `usr_${label}_${suffix}`,
    name: label,
    email: `${label}.${suffix}@orbit.local`,
    handle: `${label}-${suffix.toLowerCase()}`,
    timezone,
  }));
  await tx.insert(user).values(people);
  return {
    organizationId,
    actorId: `usr_actor_${suffix}`,
    adaId: `usr_ada_${suffix}`,
    graceId: `usr_grace_${suffix}`,
  };
}

function eventFor(fixture: Fixture, overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    organizationId: fixture.organizationId,
    type: 'comment_created',
    actor: { type: 'user', id: fixture.actorId, name: 'Actor' },
    entityType: 'issue',
    entityId: 'iss_1',
    userIds: [fixture.adaId, fixture.graceId],
    title: 'Actor commented on ORB-1',
    body: 'Looks good',
    url: '/issue/ORB-1',
    ...overrides,
  };
}

describe('notifyMany', () => {
  it('always writes an inbox row and returns valid sync actions', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [eventFor(fixture)]);

      expect(outcome.notifications).toHaveLength(2);
      expect(outcome.actions).toHaveLength(2);
      for (const action of outcome.actions) {
        expect(() => syncActionSchema.parse(action)).not.toThrow();
        expect(action.model).toBe('notification');
        expect(action.action).toBe('insert');
        expect(action.syncId).toBeGreaterThan(0);
        expect(action.scopes).toContain(`user:${action.data['userId'] as string}`);
      }
      const rows = await tx
        .select()
        .from(notification)
        .where(eq(notification.organizationId, fixture.organizationId));
      expect(rows).toHaveLength(2);
      expect(rows[0]?.deliveredChannels).toEqual(['inbox', 'email', 'slack']);
    });
  });

  it('never notifies the actor about their own action', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [
        eventFor(fixture, { userIds: [fixture.actorId, fixture.adaId] }),
      ]);
      expect(outcome.notifications).toHaveLength(1);
      expect(outcome.notifications[0]?.userId).toBe(fixture.adaId);
    });
  });

  it('returns nothing when the actor is the only target', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.actorId] })]);
      expect(outcome.notifications).toHaveLength(0);
      expect(outcome.actions).toHaveLength(0);
    });
  });

  it('filters email and slack by preference but keeps the inbox row', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx.insert(notificationPreference).values([
        {
          id: `np_${ulid()}`,
          userId: fixture.adaId,
          channel: 'email',
          type: 'comment_created',
          enabled: false,
        },
        {
          id: `np_${ulid()}`,
          userId: fixture.graceId,
          channel: 'slack',
          type: 'comment_created',
          enabled: false,
        },
      ]);
      const outcome = await notifyMany(tx, [eventFor(fixture)]);

      expect(outcome.notifications).toHaveLength(2);
      expect(outcome.email.map((dispatch) => dispatch.userId)).toEqual([fixture.graceId]);
      expect(outcome.slack.map((dispatch) => dispatch.userId)).toEqual([fixture.adaId]);
      const ada = outcome.notifications.find((row) => row.userId === fixture.adaId);
      expect(ada?.deliveredChannels).toEqual(['inbox', 'slack']);
    });
  });

  it('collapses the same user, type and entity inside the dedupe window', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const now = new Date('2026-07-22T12:00:00.000Z');
      await notifyMany(tx, [eventFor(fixture)], { now });

      const repeat = await notifyMany(tx, [eventFor(fixture)], {
        now: new Date(now.getTime() + 30_000),
      });
      expect(repeat.notifications).toHaveLength(0);
      expect(repeat.deduped).toBe(2);

      const later = await notifyMany(tx, [eventFor(fixture)], {
        now: new Date(now.getTime() + 61_000),
      });
      expect(later.notifications).toHaveLength(2);
    });
  });

  it('collapses duplicates inside a single batch', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [eventFor(fixture), eventFor(fixture)]);
      expect(outcome.notifications).toHaveLength(2);
      expect(outcome.deduped).toBe(2);
    });
  });

  it('defers non urgent email during quiet hours', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'Asia/Kolkata');
      const now = new Date('2026-07-22T20:00:00.000Z');
      const outcome = await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId] })], {
        now,
      });
      const dispatch = outcome.email[0];
      expect(dispatch?.deferred).toBe(true);
      expect(dispatch?.sendAt.toISOString()).toBe('2026-07-23T03:30:00.000Z');
    });
  });

  it('lets an urgent assignment bypass quiet hours', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'Asia/Kolkata');
      const now = new Date('2026-07-22T20:00:00.000Z');
      const outcome = await notifyMany(
        tx,
        [
          eventFor(fixture, {
            userIds: [fixture.adaId],
            type: 'issue_assigned',
            priority: 1,
          }),
        ],
        { now },
      );
      expect(outcome.email[0]?.deferred).toBe(false);
      expect(outcome.email[0]?.sendAt.toISOString()).toBe(now.toISOString());
    });
  });

  it('keeps urgent email deferred when the bypass is off', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'Asia/Kolkata');
      await tx.insert(notificationSetting).values({
        userId: fixture.adaId,
        quietHoursEnabled: true,
        quietHoursStart: '18:00',
        quietHoursEnd: '09:00',
        urgentBypassEnabled: false,
      });
      const outcome = await notifyMany(
        tx,
        [eventFor(fixture, { userIds: [fixture.adaId], type: 'issue_assigned', priority: 1 })],
        { now: new Date('2026-07-22T20:00:00.000Z') },
      );
      expect(outcome.email[0]?.deferred).toBe(true);
    });
  });

  it('sends immediately outside quiet hours', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'Asia/Kolkata');
      const now = new Date('2026-07-22T06:00:00.000Z');
      const outcome = await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId] })], {
        now,
      });
      expect(outcome.email[0]?.deferred).toBe(false);
    });
  });

  it('rejects a malformed event', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await expect(notifyMany(tx, [eventFor(fixture, { title: '' })])).rejects.toThrow();
    });
  });
});

describe('inbox reads and writes', () => {
  it('paginates, counts unread, marks read and snoozes', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const base = new Date('2026-07-22T12:00:00.000Z');
      for (let index = 0; index < 5; index += 1) {
        await notifyMany(
          tx,
          [eventFor(fixture, { userIds: [fixture.adaId], entityId: `iss_${index}` })],
          { now: new Date(base.getTime() + index * 1000) },
        );
      }

      const first = await listInbox(tx, {
        userId: fixture.adaId,
        organizationId: fixture.organizationId,
        limit: 2,
      });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      expect(first.unreadCount).toBe(5);

      const second = await listInbox(tx, {
        userId: fixture.adaId,
        organizationId: fixture.organizationId,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.items).toHaveLength(2);
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

      const readIds = await markRead(tx, {
        userId: fixture.adaId,
        organizationId: fixture.organizationId,
        notificationIds: [first.items[0]?.id ?? ''],
      });
      expect(readIds).toHaveLength(1);
      expect(await unreadCount(tx, fixture.adaId, fixture.organizationId)).toBe(4);

      const snoozed = await snooze(tx, {
        userId: fixture.adaId,
        organizationId: fixture.organizationId,
        notificationId: first.items[1]?.id ?? '',
        until: new Date(base.getTime() + 86_400_000),
      });
      expect(snoozed.snoozedUntil).not.toBeNull();
      expect(await unreadCount(tx, fixture.adaId, fixture.organizationId, base)).toBe(3);

      expect(
        await markAllRead(tx, {
          userId: fixture.adaId,
          organizationId: fixture.organizationId,
        }),
      ).toBe(4);
      expect(await unreadCount(tx, fixture.adaId, fixture.organizationId)).toBe(0);
    });
  });

  it('filters the inbox to unread only', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId] })]);
      await markRead(tx, {
        userId: fixture.adaId,
        organizationId: fixture.organizationId,
        notificationIds: [outcome.notifications[0]?.id ?? ''],
      });
      const page = await listInbox(tx, {
        userId: fixture.adaId,
        organizationId: fixture.organizationId,
        unreadOnly: true,
      });
      expect(page.items).toHaveLength(0);
    });
  });

  it('rejects snoozing a notification that is not yours', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId] })]);
      await expect(
        snooze(tx, {
          userId: fixture.graceId,
          organizationId: fixture.organizationId,
          notificationId: outcome.notifications[0]?.id ?? '',
          until: new Date(),
        }),
      ).rejects.toThrow();
    });
  });
});

describe('defaultPreferences', () => {
  it('produces the full channel by type matrix', () => {
    const matrix = defaultPreferences();
    expect(matrix).toHaveLength(NOTIFICATION_CHANNELS.length * NOTIFICATION_TYPES.length);
    expect(matrix.every((entry) => entry.enabled)).toBe(true);
    expect(new Set(matrix.map((entry) => entry.channel)).size).toBe(NOTIFICATION_CHANNELS.length);
  });
});

describe('quiet hours helpers', () => {
  it('parses clock strings and falls back on nonsense', () => {
    expect(parseClock('18:30')).toBe(1110);
    expect(parseClock('9:05')).toBe(545);
    expect(parseClock('99:99')).toBe(0);
    expect(parseClock('nope')).toBe(0);
  });

  it('handles windows that wrap midnight and windows that do not', () => {
    const wrapping = { enabled: true, start: '18:00', end: '09:00', timeZone: 'UTC' };
    expect(isWithinQuietHours(new Date('2026-07-22T23:00:00Z'), wrapping)).toBe(true);
    expect(isWithinQuietHours(new Date('2026-07-22T08:00:00Z'), wrapping)).toBe(true);
    expect(isWithinQuietHours(new Date('2026-07-22T12:00:00Z'), wrapping)).toBe(false);

    const daytime = { enabled: true, start: '09:00', end: '17:00', timeZone: 'UTC' };
    expect(isWithinQuietHours(new Date('2026-07-22T12:00:00Z'), daytime)).toBe(true);
    expect(isWithinQuietHours(new Date('2026-07-22T20:00:00Z'), daytime)).toBe(false);
    expect(
      isWithinQuietHours(new Date('2026-07-22T12:00:00Z'), { ...daytime, enabled: false }),
    ).toBe(false);
  });

  it('finds the next window opening', () => {
    const quiet = { enabled: true, start: '18:00', end: '09:00', timeZone: 'UTC' };
    expect(nextQuietHoursEnd(new Date('2026-07-22T23:00:00Z'), quiet).toISOString()).toBe(
      '2026-07-23T09:00:00.000Z',
    );
    expect(nextQuietHoursEnd(new Date('2026-07-22T08:00:00Z'), quiet).toISOString()).toBe(
      '2026-07-22T09:00:00.000Z',
    );
  });

  it('falls back to utc for an unknown time zone', () => {
    const quiet = { enabled: true, start: '18:00', end: '09:00', timeZone: 'Mars/Olympus' };
    expect(isWithinQuietHours(new Date('2026-07-22T23:00:00Z'), quiet)).toBe(true);
  });
});
