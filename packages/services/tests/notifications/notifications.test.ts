import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db } from '@orbit/db';
import {
  integration,
  notification,
  notificationDelivery,
  notificationPreference,
  notificationSetting,
  organization,
  slackUserMapping,
  user,
} from '@orbit/db/schema';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES, syncActionSchema } from '@orbit/shared';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { eq, inArray } from 'drizzle-orm';
import {
  claimSlackDmDeliveries,
  defaultPreferences,
  isWithinQuietHours,
  listInbox,
  markAllRead,
  markRead,
  markSlackDmDelivery,
  markSlackDmUnavailable,
  type NotificationEvent,
  nextQuietHoursEnd,
  notifyMany,
  parseClock,
  snooze,
  unreadCount,
  unreadCounters,
} from '../../src/notifications/index.ts';
import { slackFeatureEnabled } from '../../src/slack/feature.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

const previousSlackEnabled = process.env['SLACK_ENABLED'];

beforeAll(() => {
  process.env['SLACK_ENABLED'] = 'false';
});

afterAll(() => {
  if (previousSlackEnabled === undefined) delete process.env['SLACK_ENABLED'];
  else process.env['SLACK_ENABLED'] = previousSlackEnabled;
});

interface Fixture {
  readonly organizationId: string;
  readonly actorId: string;
  readonly adaId: string;
  readonly graceId: string;
}

async function seed(tx: TestTransaction, timezone = 'UTC'): Promise<Fixture> {
  const suffix = randomUUIDv7();
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
    reason: 'commented',
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

async function seedSlackDmConnection(
  tx: TestTransaction,
  fixture: Fixture,
  options: {
    readonly credentials?: Record<string, unknown>;
    readonly config?: Record<string, unknown>;
    readonly mapped?: boolean;
    readonly mappedUserIds?: readonly string[];
  } = {},
): Promise<void> {
  const integrationId = `int_${randomUUIDv7()}`;
  await tx.insert(integration).values({
    id: integrationId,
    organizationId: fixture.organizationId,
    provider: 'slack',
    externalId: 'default',
    connectedById: fixture.actorId,
    credentials: options.credentials ?? {
      botToken: {
        version: 1,
        iv: 'AAAAAAAAAAAAAAAA',
        ciphertext: 'AA',
        tag: 'AAAAAAAAAAAAAAAAAAAAAA',
      },
    },
    config: options.config ?? { scopes: ['chat:write', 'im:write'] },
  });
  if (options.mapped === false) return;
  const mappedUserIds = options.mappedUserIds ?? [fixture.adaId];
  await tx.insert(slackUserMapping).values(
    mappedUserIds.map((userId, index) => ({
      id: `map_${randomUUIDv7()}`,
      organizationId: fixture.organizationId,
      integrationId,
      userId,
      slackUserId: `U${index}`,
      slackDisplayName: `Slack user ${index}`,
    })),
  );
}

describe('notifyMany', () => {
  it('offers Slack DM as a distinct personal notification channel', () => {
    expect(NOTIFICATION_CHANNELS).toContain('slack_dm');
    expect(defaultPreferences()).toContainEqual({
      channel: 'slack_dm',
      type: 'mention',
      enabled: slackFeatureEnabled(),
    });
  });

  for (const scenario of [
    { name: 'no integration', setup: async () => undefined },
    {
      name: 'no bot token',
      setup: async (tx: TestTransaction, fixture: Fixture) =>
        await seedSlackDmConnection(tx, fixture, { credentials: {} }),
    },
    {
      name: 'missing scopes',
      setup: async (tx: TestTransaction, fixture: Fixture) =>
        await seedSlackDmConnection(tx, fixture, { config: { scopes: ['chat:write'] } }),
    },
    {
      name: 'reauthorization required',
      setup: async (tx: TestTransaction, fixture: Fixture) =>
        await seedSlackDmConnection(tx, fixture, {
          config: { scopes: ['chat:write', 'im:write'], slackReauthorize: true },
        }),
    },
    {
      name: 'user mapping missing',
      setup: async (tx: TestTransaction, fixture: Fixture) =>
        await seedSlackDmConnection(tx, fixture, { mapped: false }),
    },
  ]) {
    it(`does not enqueue a Slack DM when ${scenario.name}`, async () => {
      await withRollback(async (tx) => {
        const fixture = await seed(tx);
        await scenario.setup(tx, fixture);

        const outcome = await notifyMany(
          tx,
          [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })],
          { slackEnabled: true },
        );

        expect(outcome.slackDm).toEqual([]);
        expect(await tx.select().from(notificationDelivery)).toEqual([]);
      });
    });
  }

  it('enqueues a Slack DM for a fully eligible mapped user', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture);

      const outcome = await notifyMany(
        tx,
        [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })],
        { slackEnabled: true },
      );

      expect(outcome.slackDm).toHaveLength(1);
      expect(await tx.select().from(notificationDelivery)).toHaveLength(1);
    });
  });

  it('routes a personal event to Slack DM instead of the channel', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture);
      const outcome = await notifyMany(
        tx,
        [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })],
        { slackEnabled: true },
      );

      expect(outcome.slackDm).toHaveLength(1);
      expect(outcome.slack).toHaveLength(0);
      expect(outcome.notifications[0]?.deliveredChannels).not.toContain('slack_dm');
    });
  });

  for (const scenario of [
    { type: 'doc_access_requested', reason: 'access_requested' },
    { type: 'doc_access_granted', reason: 'access_granted' },
  ] as const) {
    it(`keeps ${scenario.reason} notifications out of shared Slack channels`, async () => {
      await withRollback(async (tx) => {
        const fixture = await seed(tx);
        await seedSlackDmConnection(tx, fixture);

        const outcome = await notifyMany(
          tx,
          [
            eventFor(fixture, {
              type: scenario.type,
              reason: scenario.reason,
              userIds: [fixture.adaId],
            }),
          ],
          { slackEnabled: true },
        );

        expect(outcome.slack).toEqual([]);
        expect(outcome.slackDm).toHaveLength(1);
      });
    });
  }

  it('persists a DM-only notification until quiet hours end', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'UTC');
      await seedSlackDmConnection(tx, fixture);
      await tx.insert(notificationPreference).values([
        {
          id: `np_${randomUUIDv7()}`,
          userId: fixture.adaId,
          channel: 'inbox',
          type: 'comment_created',
          enabled: false,
        },
        {
          id: `np_${randomUUIDv7()}`,
          userId: fixture.adaId,
          channel: 'email',
          type: 'comment_created',
          enabled: false,
        },
      ]);
      const event = eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' });
      const deferred = await notifyMany(tx, [event], {
        now: new Date('2026-07-22T20:00:00.000Z'),
        slackEnabled: true,
      });
      expect(deferred.notifications).toHaveLength(1);
      expect(deferred.slackDm).toHaveLength(1);
      expect(deferred.deduped).toBe(0);
      const pending = await tx.select().from(notificationDelivery);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.availableAt.getTime()).toBeGreaterThan(
        new Date('2026-07-22T20:00:00.000Z').getTime(),
      );
    });
  });

  it('keeps a team event on the Slack channel', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(
        tx,
        [eventFor(fixture, { userIds: [fixture.adaId], reason: 'state_changed' })],
        { slackEnabled: true },
      );

      expect(outcome.slack).toHaveLength(1);
      expect(outcome.slackDm).toHaveLength(0);
    });
  });

  it('retains a Slack DM with a deferred send time when email is also enabled', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'UTC');
      await seedSlackDmConnection(tx, fixture);
      await tx.insert(notificationPreference).values({
        id: `np_${randomUUIDv7()}`,
        userId: fixture.adaId,
        channel: 'inbox',
        type: 'comment_created',
        enabled: false,
      });
      const now = new Date('2026-07-22T20:00:00.000Z');
      const outcome = await notifyMany(
        tx,
        [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })],
        { now, slackEnabled: true },
      );
      expect(outcome.email).toHaveLength(1);
      expect(outcome.slackDm).toHaveLength(1);
      expect(outcome.slackDm[0]?.sendAt.getTime()).toBeGreaterThan(now.getTime());
      const deliveries = await tx
        .select({ channel: notificationDelivery.channel, status: notificationDelivery.status })
        .from(notificationDelivery)
        .where(eq(notificationDelivery.userId, fixture.adaId));
      expect(deliveries).toEqual([{ channel: 'slack_dm', status: 'pending' }]);
      const deferredAt = outcome.slackDm[0]?.sendAt;
      if (deferredAt === undefined) throw new Error('Expected a deferred Slack DM.');
      const claimedAfterQuietHours = await claimSlackDmDeliveries(
        tx,
        10,
        new Date(deferredAt.getTime() + 1),
      );
      expect(claimedAfterQuietHours).toHaveLength(1);
    });
  });

  it('claims failed Slack DM deliveries for retry without claiming succeeded rows', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture);
      await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })], {
        slackEnabled: true,
      });
      const first = await claimSlackDmDeliveries(tx, 10, new Date(Date.now() + 86_400_000));
      expect(first).toHaveLength(1);
      const delivery = first[0];
      if (delivery === undefined) throw new Error('Expected the first Slack DM claim.');
      await markSlackDmDelivery(tx, delivery.id, delivery.claimedAt ?? new Date(0), false);
      const retry = await claimSlackDmDeliveries(tx, 10, new Date(Date.now() + 31_000));
      expect(retry.map((row) => row.id)).toContain(delivery.id);
      const retriedDelivery = retry[0];
      if (retriedDelivery === undefined) throw new Error('Expected the retry Slack DM claim.');
      await markSlackDmDelivery(
        tx,
        retriedDelivery.id,
        retriedDelivery.claimedAt ?? new Date(0),
        true,
      );
      const afterSuccess = await claimSlackDmDeliveries(tx, 10, new Date(Date.now() + 60_000));
      expect(afterSuccess).toHaveLength(0);
      const rows = await tx.select().from(notificationDelivery);
      expect(rows[0]?.status).toBe('succeeded');
    });
  });

  it('skips a locked retry without overwriting a reschedule', async () => {
    const candidateAt = new Date('2000-01-01T00:00:00.000Z');
    const replacementClaimedAt = new Date('2000-01-01T00:00:01.000Z');
    const retryAt = new Date('2000-01-01T00:05:00.000Z');
    const seeded = await db.transaction(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture);
      await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })], {
        slackEnabled: true,
      });
      const [delivery] = await tx
        .select()
        .from(notificationDelivery)
        .where(eq(notificationDelivery.userId, fixture.adaId));
      if (delivery === undefined) throw new Error('Expected a Slack DM delivery.');
      await tx
        .update(notificationDelivery)
        .set({ status: 'failed', claimedAt: candidateAt, availableAt: candidateAt })
        .where(eq(notificationDelivery.id, delivery.id));
      return { fixture, deliveryId: delivery.id };
    });
    try {
      await db.transaction(async (locker) => {
        await locker
          .select({ id: notificationDelivery.id })
          .from(notificationDelivery)
          .where(eq(notificationDelivery.id, seeded.deliveryId))
          .for('update');
        expect(await claimSlackDmDeliveries(db, 1, candidateAt, true)).toEqual([]);
        await locker
          .update(notificationDelivery)
          .set({ status: 'failed', claimedAt: replacementClaimedAt, availableAt: retryAt })
          .where(eq(notificationDelivery.id, seeded.deliveryId));
      });

      const [stored] = await db
        .select({
          status: notificationDelivery.status,
          claimedAt: notificationDelivery.claimedAt,
          availableAt: notificationDelivery.availableAt,
        })
        .from(notificationDelivery)
        .where(eq(notificationDelivery.id, seeded.deliveryId));
      expect(stored).toEqual({
        status: 'failed',
        claimedAt: replacementClaimedAt,
        availableAt: retryAt,
      });
    } finally {
      await db.delete(organization).where(eq(organization.id, seeded.fixture.organizationId));
      await db
        .delete(user)
        .where(
          inArray(user.id, [seeded.fixture.actorId, seeded.fixture.adaId, seeded.fixture.graceId]),
        );
    }
  });

  it('does not lock the parent notification while claiming a Slack DM delivery', async () => {
    const claimAt = new Date('2030-01-01T00:00:00.000Z');
    const seeded = await db.transaction(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture);
      await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })], {
        slackEnabled: true,
      });
      const [delivery] = await tx
        .select({ notificationId: notificationDelivery.notificationId })
        .from(notificationDelivery)
        .where(eq(notificationDelivery.userId, fixture.adaId));
      if (delivery === undefined) throw new Error('Expected a Slack DM delivery.');
      return { fixture, notificationId: delivery.notificationId };
    });
    let announceClaim: () => void = () => undefined;
    const claimReady = new Promise<void>((resolve) => {
      announceClaim = resolve;
    });
    let releaseClaim: () => void = () => undefined;
    const claimRelease = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    const claim = db.transaction(async (tx) => {
      const rows = await claimSlackDmDeliveries(tx, 1, claimAt);
      announceClaim();
      await claimRelease;
      return rows;
    });

    let unlockedParent: { id: string } | undefined;
    try {
      await Promise.race([claimReady, claim.then(() => undefined)]);
      unlockedParent = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: notification.id })
          .from(notification)
          .where(eq(notification.id, seeded.notificationId))
          .for('update', { skipLocked: true });
        return row;
      });
    } finally {
      releaseClaim();
      await claim;
      await db.delete(organization).where(eq(organization.id, seeded.fixture.organizationId));
      await db
        .delete(user)
        .where(
          inArray(user.id, [seeded.fixture.actorId, seeded.fixture.adaId, seeded.fixture.graceId]),
        );
    }

    expect(unlockedParent).toEqual({ id: seeded.notificationId });
  });

  it('claims fresh Slack DM work ahead of a retry backlog', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture, {
        mappedUserIds: [fixture.adaId, fixture.graceId],
      });
      await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })], {
        slackEnabled: true,
      });
      const backlogClaimAt = new Date(Date.now() + 86_400_000);
      const backlog = await claimSlackDmDeliveries(tx, 10, backlogClaimAt);
      expect(backlog).toHaveLength(1);
      const retried = backlog[0];
      if (retried === undefined) throw new Error('Expected the retry backlog claim.');
      await markSlackDmDelivery(tx, retried.id, retried.claimedAt ?? new Date(0), false);

      await notifyMany(
        tx,
        [
          eventFor(fixture, {
            userIds: [fixture.graceId],
            reason: 'mentioned',
            entityId: 'iss_2',
          }),
        ],
        { slackEnabled: true },
      );
      const fresh = await tx
        .select()
        .from(notificationDelivery)
        .where(eq(notificationDelivery.userId, fixture.graceId));
      expect(fresh).toHaveLength(1);

      const claimed = await claimSlackDmDeliveries(
        tx,
        1,
        new Date(backlogClaimAt.getTime() + 31_000),
      );
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.userId).toBe(fixture.graceId);
      expect(claimed[0]?.attempts).toBe(0);
      const backlogAfter = await tx
        .select()
        .from(notificationDelivery)
        .where(eq(notificationDelivery.id, retried.id));
      expect(backlogAfter[0]?.attempts).toBe(1);
      expect(backlogAfter[0]?.status).toBe('failed');
    });
  });

  it('claims fresh Slack DM work ahead of a stale first-attempt claim', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture, {
        mappedUserIds: [fixture.adaId, fixture.graceId],
      });
      await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })], {
        slackEnabled: true,
      });
      const firstClaimAt = new Date(Date.now() + 86_400_000);
      const firstClaim = await claimSlackDmDeliveries(tx, 1, firstClaimAt);
      expect(firstClaim).toHaveLength(1);

      await notifyMany(
        tx,
        [
          eventFor(fixture, {
            userIds: [fixture.graceId],
            reason: 'mentioned',
            entityId: 'iss_fresh',
          }),
        ],
        { slackEnabled: true },
      );

      const claimed = await claimSlackDmDeliveries(
        tx,
        1,
        new Date(firstClaimAt.getTime() + 5 * 60_000 + 1),
      );

      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.userId).toBe(fixture.graceId);
      const stale = firstClaim[0];
      if (stale === undefined) throw new Error('Expected the original Slack DM claim.');
      const [storedStale] = await tx
        .select({ status: notificationDelivery.status, claimedAt: notificationDelivery.claimedAt })
        .from(notificationDelivery)
        .where(eq(notificationDelivery.id, stale.id));
      expect(storedStale?.status).toBe('processing');
      expect(storedStale?.claimedAt?.getTime()).toBe(firstClaimAt.getTime());
    });
  });

  it('reclaims an unfinalized Slack DM for at-least-once delivery', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture);
      await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })], {
        slackEnabled: true,
      });
      const claimAt = new Date(Date.now() + 86_400_000);
      const pendingRows = await tx.select().from(notificationDelivery);
      expect(pendingRows).toHaveLength(1);
      const claimed = await claimSlackDmDeliveries(tx, 10, claimAt);
      expect(claimed).toHaveLength(1);
      const reclaimed = await claimSlackDmDeliveries(
        tx,
        10,
        new Date(claimAt.getTime() + 5 * 60_000 + 1),
      );
      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0]?.id).toBe(claimed[0]?.id);
      expect(reclaimed[0]?.status).toBe('processing');
      expect(reclaimed[0]?.claimedAt?.getTime()).toBe(claimAt.getTime() + 5 * 60_000 + 1);
    });
  });

  it('does not finalize a delivery with an outdated claim after reclaim', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture);
      const outcome = await notifyMany(
        tx,
        [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })],
        { now: new Date('2026-07-22T11:00:00Z'), slackEnabled: true },
      );
      const first = await claimSlackDmDeliveries(tx, 10, new Date('2026-07-22T12:00:00Z'));
      const original = first[0];
      if (original === undefined || original.claimedAt === null) {
        throw new Error('Expected the original Slack DM claim.');
      }
      const reclaimed = await claimSlackDmDeliveries(tx, 10, new Date('2026-07-22T12:05:01Z'));
      const replacement = reclaimed[0];
      if (replacement === undefined || replacement.claimedAt === null) {
        throw new Error('Expected the replacement Slack DM claim.');
      }

      expect(await markSlackDmDelivery(tx, original.id, original.claimedAt, true)).toBe(false);
      expect(await markSlackDmDelivery(tx, replacement.id, replacement.claimedAt, true)).toBe(true);
      expect(outcome.notifications).toHaveLength(1);
    });
  });

  it('does not retry a delivery marked unavailable', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture);
      const now = new Date('2026-07-22T12:00:00Z');
      await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId], reason: 'mentioned' })], {
        now,
        slackEnabled: true,
      });
      const [delivery] = await claimSlackDmDeliveries(tx, 10, now);
      if (delivery === undefined) throw new Error('Expected an unavailable Slack DM claim.');
      await markSlackDmUnavailable(
        tx,
        delivery.id,
        delivery.claimedAt ?? new Date(0),
        'missing_scope',
      );
      expect(await claimSlackDmDeliveries(tx, 10, now)).toHaveLength(0);
      const [stored] = await tx
        .select({ status: notificationDelivery.status, lastError: notificationDelivery.lastError })
        .from(notificationDelivery)
        .where(eq(notificationDelivery.id, delivery.id));
      expect(stored).toEqual({ status: 'skipped', lastError: 'missing_scope' });
    });
  });

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
      expect(rows[0]?.deliveredChannels).toEqual(['inbox', 'email']);
      expect(outcome.slack).toEqual([]);
    });
  });

  it('addresses each delta to its recipient and to nobody else', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [eventFor(fixture, { type: 'mention' })]);

      expect(outcome.actions).toHaveLength(2);
      for (const action of outcome.actions) {
        expect(action.scopes).toEqual([`user:${action.data['userId'] as string}`]);
      }
      const recipients = outcome.actions.map((action) => action.data['userId']);
      expect(new Set(recipients)).toEqual(new Set([fixture.adaId, fixture.graceId]));
    });
  });

  it('records the reason the notification was raised', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [
        eventFor(fixture, { type: 'mention', reason: 'mentioned', userIds: [fixture.adaId] }),
      ]);
      expect(outcome.notifications[0]?.reason).toBe('mentioned');
      expect(outcome.actions[0]?.data['reason']).toBe('mentioned');
    });
  });

  it('keeps the external destination beside the internal Orbit route', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const event = {
        ...eventFor(fixture, { userIds: [fixture.adaId] }),
        externalUrl: 'https://github.com/acme/web/pull/7',
      };

      const outcome = await notifyMany(tx, [event]);
      const stored = outcome.notifications[0] as unknown as Record<string, unknown>;

      expect(stored['url']).toBe('/issue/ORB-1');
      expect(stored['externalUrl']).toBe('https://github.com/acme/web/pull/7');
      expect(outcome.actions[0]?.data['externalUrl']).toBe('https://github.com/acme/web/pull/7');
    });
  });

  it('keeps a type out of the inbox when the inbox channel is off', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx.insert(notificationPreference).values({
        id: `np_${randomUUIDv7()}`,
        userId: fixture.adaId,
        channel: 'inbox',
        type: 'comment_created',
        enabled: false,
      });
      const outcome = await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId] })]);

      expect(outcome.notifications[0]?.deliveredChannels).toEqual(['email']);
      expect(outcome.actions).toHaveLength(0);
      const page = await listInbox(tx, {
        userId: fixture.adaId,
        organizationId: fixture.organizationId,
      });
      expect(page.items).toHaveLength(0);
      expect(page.unreadCount).toBe(0);
      expect(await unreadCount(tx, fixture.adaId, fixture.organizationId)).toBe(0);
      expect(await unreadCounters(tx, fixture.adaId, fixture.organizationId)).toEqual({
        total: 0,
        mentions: 0,
        activity: 0,
      });
    });
  });

  it('writes nothing at all when every channel is off for that type', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx.insert(notificationPreference).values(
        NOTIFICATION_CHANNELS.map((channel) => ({
          id: `np_${randomUUIDv7()}`,
          userId: fixture.adaId,
          channel,
          type: 'comment_created',
          enabled: false,
        })),
      );
      const outcome = await notifyMany(tx, [eventFor(fixture, { userIds: [fixture.adaId] })]);
      expect(outcome.notifications).toHaveLength(0);
      expect(outcome.actions).toHaveLength(0);
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

  it('filters email while ignoring a legacy hidden Slack preference', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx.insert(notificationPreference).values([
        {
          id: `np_${randomUUIDv7()}`,
          userId: fixture.adaId,
          channel: 'email',
          type: 'comment_created',
          enabled: false,
        },
        {
          id: `np_${randomUUIDv7()}`,
          userId: fixture.graceId,
          channel: 'slack',
          type: 'comment_created',
          enabled: false,
        },
      ]);
      const outcome = await notifyMany(tx, [eventFor(fixture, { reason: 'state_changed' })], {
        slackEnabled: true,
      });

      expect(outcome.notifications).toHaveLength(2);
      expect(outcome.email.map((dispatch) => dispatch.userId)).toEqual([fixture.graceId]);
      expect(outcome.slack.map((dispatch) => dispatch.userId)).toEqual([
        fixture.adaId,
        fixture.graceId,
      ]);
      const ada = outcome.notifications.find((row) => row.userId === fixture.adaId);
      expect(ada?.deliveredChannels).toEqual(['inbox', 'slack']);
      expect(
        outcome.actions.find((action) => action.modelId === ada?.id)?.data['deliveredChannels'],
      ).toEqual(['inbox', 'slack']);
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

  it('deduplicates Slack DMs across retries of the same source delivery', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await seedSlackDmConnection(tx, fixture, {
        mappedUserIds: [fixture.adaId, fixture.graceId],
      });
      const sourceDeliveryId = 'github-delivery-retry';
      const now = new Date('2026-07-22T12:00:00.000Z');

      const first = await notifyMany(tx, [eventFor(fixture)], {
        now,
        slackEnabled: true,
        sourceDeliveryId,
      });
      const retry = await notifyMany(tx, [eventFor(fixture)], {
        now: new Date(now.getTime() + 61_000),
        slackEnabled: true,
        sourceDeliveryId,
      });

      expect(first.slackDm.length).toBeGreaterThan(0);
      expect(retry.slackDm).toEqual([]);
      expect(retry.deduped).toBeGreaterThan(0);
      expect(
        await tx
          .select({ id: notificationDelivery.id })
          .from(notificationDelivery)
          .where(eq(notificationDelivery.sourceDeliveryId, sourceDeliveryId)),
      ).toHaveLength(first.slackDm.length);
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

  it('keeps distinct GitHub activities on the same pull request', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const first = eventFor(fixture, {
        type: 'pr_comment',
        entityType: 'github_pull_request',
        entityId: 'pr_7',
        externalUrl: 'https://github.com/acme/web/pull/7#issuecomment-1',
      });
      const second = {
        ...first,
        body: 'A different comment',
        externalUrl: 'https://github.com/acme/web/pull/7#issuecomment-2',
      };

      const outcome = await notifyMany(tx, [first, second]);

      expect(outcome.notifications).toHaveLength(4);
      expect(outcome.deduped).toBe(0);
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

  it('splits unread counters into mentions and everything else', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await notifyMany(tx, [
        eventFor(fixture, {
          userIds: [fixture.adaId],
          type: 'pr_review_requested',
          entityId: 'iss_a',
        }),
        eventFor(fixture, { userIds: [fixture.adaId], type: 'comment_created', entityId: 'iss_b' }),
        eventFor(fixture, { userIds: [fixture.adaId], type: 'mention', entityId: 'iss_c' }),
        eventFor(fixture, { userIds: [fixture.adaId], type: 'mention', entityId: 'iss_d' }),
      ]);
      const counters = await unreadCounters(tx, fixture.adaId, fixture.organizationId);
      expect(counters.mentions).toBe(2);
      expect(counters.total).toBe(4);
    });
  });

  it('keeps issue field moves out of the activity counter', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await notifyMany(tx, [
        eventFor(fixture, {
          userIds: [fixture.adaId],
          type: 'issue_status_changed',
          entityId: 'iss_a',
        }),
        eventFor(fixture, { userIds: [fixture.adaId], type: 'issue_assigned', entityId: 'iss_b' }),
        eventFor(fixture, { userIds: [fixture.adaId], type: 'comment_created', entityId: 'iss_c' }),
        eventFor(fixture, { userIds: [fixture.adaId], type: 'mention', entityId: 'iss_d' }),
      ]);

      const counters = await unreadCounters(tx, fixture.adaId, fixture.organizationId);
      expect(counters.total).toBe(4);
      expect(counters.activity).toBe(2);
      expect(counters.mentions).toBe(1);
    });
  });

  it('counts a read field move out of both the total and the activity counter', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const outcome = await notifyMany(tx, [
        eventFor(fixture, {
          userIds: [fixture.adaId],
          type: 'issue_status_changed',
          entityId: 'iss_a',
        }),
        eventFor(fixture, { userIds: [fixture.adaId], type: 'comment_created', entityId: 'iss_b' }),
      ]);
      await markRead(tx, {
        userId: fixture.adaId,
        organizationId: fixture.organizationId,
        notificationIds: [outcome.notifications[0]?.id ?? ''],
      });

      const counters = await unreadCounters(tx, fixture.adaId, fixture.organizationId);
      expect(counters.total).toBe(1);
      expect(counters.activity).toBe(1);
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
      let error: unknown;
      try {
        await snooze(tx, {
          userId: fixture.graceId,
          organizationId: fixture.organizationId,
          notificationId: outcome.notifications[0]?.id ?? '',
          until: new Date(),
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeDefined();
    });
  });
});

describe('defaultPreferences', () => {
  it('produces the full channel by type matrix', () => {
    const matrix = defaultPreferences();
    expect(matrix).toHaveLength(NOTIFICATION_CHANNELS.length * NOTIFICATION_TYPES.length);
    expect(new Set(matrix.map((entry) => entry.channel)).size).toBe(NOTIFICATION_CHANNELS.length);
    expect(
      matrix
        .filter((entry) => entry.channel === 'slack' || entry.channel === 'slack_dm')
        .every((entry) => entry.enabled === slackFeatureEnabled()),
    ).toBe(true);
    expect(
      matrix
        .filter((entry) => entry.channel !== 'slack' && entry.channel !== 'slack_dm')
        .every((entry) => entry.enabled),
    ).toBe(true);
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

  it('resolves the wall-clock end across daylight-saving transitions', () => {
    const quiet = {
      enabled: true,
      start: '18:00',
      end: '09:00',
      timeZone: 'America/New_York',
    };
    expect(nextQuietHoursEnd(new Date('2026-03-08T06:30:00Z'), quiet).toISOString()).toBe(
      '2026-03-08T13:00:00.000Z',
    );
    expect(nextQuietHoursEnd(new Date('2026-11-01T05:30:00Z'), quiet).toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
  });

  it('falls back to utc for an unknown time zone', () => {
    const quiet = { enabled: true, start: '18:00', end: '09:00', timeZone: 'Mars/Olympus' };
    expect(isWithinQuietHours(new Date('2026-07-22T23:00:00Z'), quiet)).toBe(true);
  });
});
