import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { claimSlackDmDeliveries } from '@orbit/services/notifications';
import { SlackApiError } from '@orbit/services/slack';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { deliverPendingSlackDms } from '../../src/notifications/notify.ts';
import { resetDatabase } from '../../src/test-support.ts';

const existingAppUrl = process.env['APP_URL'];
const existingPublicAppUrl = process.env['NEXT_PUBLIC_APP_URL'];

interface Fixture {
  readonly organizationId: string;
  readonly userId: string;
  readonly integrationId: string;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: () => resolve?.() };
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the worker state.');
}

async function seedPendingSlackDm(): Promise<Fixture> {
  const suffix = randomUUIDv7();
  const organizationId = `org_${suffix}`;
  const userId = `usr_${suffix}`;
  const integrationId = `int_${suffix}`;
  const notificationId = `not_${suffix}`;
  await db.insert(schema.organization).values({
    id: organizationId,
    name: 'Acme',
    slug: `acme-${suffix.toLowerCase()}`,
  });
  await db.insert(schema.user).values({
    id: userId,
    name: 'Ada',
    email: `ada.${suffix}@orbit.local`,
    handle: `ada-${suffix.toLowerCase()}`,
  });
  await db.insert(schema.integration).values({
    id: integrationId,
    organizationId,
    provider: 'slack',
    externalId: 'default',
    connectedById: userId,
    credentials: { botToken: 'xoxb-old' },
    config: { scopes: ['chat:write', 'im:write'] },
  });
  await db.insert(schema.slackUserMapping).values({
    id: `map_${suffix}`,
    organizationId,
    integrationId,
    userId,
    slackUserId: 'U123',
    slackDisplayName: 'Ada Slack',
  });
  await db.insert(schema.notification).values({
    id: notificationId,
    organizationId,
    userId,
    type: 'mention',
    reason: 'mentioned',
    actorId: `actor_${suffix}`,
    actorName: 'Grace',
    entityType: 'issue',
    entityId: `issue_${suffix}`,
    title: 'You were mentioned',
    url: '/issue/ORB-1',
  });
  await db.insert(schema.notificationDelivery).values({
    id: `delivery_${suffix}`,
    notificationId,
    userId,
    channel: 'slack_dm',
  });
  return { organizationId, userId, integrationId };
}

beforeEach(async () => {
  await resetDatabase();
  process.env['APP_URL'] = 'https://orbit.example';
  delete process.env['NEXT_PUBLIC_APP_URL'];
});

afterAll(() => {
  if (existingAppUrl === undefined) delete process.env['APP_URL'];
  else process.env['APP_URL'] = existingAppUrl;
  if (existingPublicAppUrl === undefined) delete process.env['NEXT_PUBLIC_APP_URL'];
  else process.env['NEXT_PUBLIC_APP_URL'] = existingPublicAppUrl;
});

describe('deliverPendingSlackDms', () => {
  it('claims only the deliveries it can start concurrently', async () => {
    await Promise.all(Array.from({ length: 6 }, () => seedPendingSlackDm()));
    const gate = deferred();
    let active = 0;
    let maxActive = 0;
    const dispatch = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
      return { delivered: 1, channel: 'D123', ts: randomUUIDv7() } as const;
    };
    const running = deliverPendingSlackDms(db, 6, globalThis.fetch, dispatch, undefined, {
      concurrency: 2,
    });

    try {
      await waitUntil(async () => active > 0);
      const rows = await db
        .select({ status: schema.notificationDelivery.status })
        .from(schema.notificationDelivery);
      expect(rows.filter((row) => row.status === 'processing')).toHaveLength(2);
      expect(rows.filter((row) => row.status === 'pending')).toHaveLength(4);
      expect(active).toBe(2);
    } finally {
      gate.resolve();
      await running;
    }

    expect(await running).toBe(6);
    expect(maxActive).toBe(2);
  });

  it('lets two workers race while dispatching one provider message', async () => {
    await seedPendingSlackDm();
    const gate = deferred();
    let dispatches = 0;
    const dispatch = async () => {
      dispatches += 1;
      await gate.promise;
      return { delivered: 1, channel: 'D123', ts: '123.456' } as const;
    };

    const workers = [
      deliverPendingSlackDms(db, 1, globalThis.fetch, dispatch),
      deliverPendingSlackDms(db, 1, globalThis.fetch, dispatch),
    ];
    await waitUntil(async () => dispatches > 0);
    gate.resolve();
    const results = await Promise.all(workers);

    expect(results.sort()).toEqual([0, 1]);
    expect(dispatches).toBe(1);
    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(stored).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('does not finalize a Slack DM when Slack omits its message timestamp', async () => {
    await seedPendingSlackDm();
    const dispatch = () => Promise.resolve({ delivered: 1, channel: 'D123', ts: '' });

    expect(await deliverPendingSlackDms(db, 10, globalThis.fetch, dispatch)).toBe(0);

    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(stored).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('stops before another claim when its deadline is reached', async () => {
    await Promise.all(Array.from({ length: 6 }, () => seedPendingSlackDm()));
    let nowMs = Date.now() + 60_000;
    const deadlineAt = new Date(nowMs + 100);
    let dispatches = 0;
    const dispatch = () => {
      dispatches += 1;
      if (dispatches === 2) nowMs = deadlineAt.getTime();
      return Promise.resolve({ delivered: 1, channel: 'D123', ts: randomUUIDv7() } as const);
    };

    expect(
      await deliverPendingSlackDms(db, 6, globalThis.fetch, dispatch, undefined, {
        concurrency: 2,
        deadlineAt,
        now: () => new Date(nowMs),
      }),
    ).toBe(2);

    const rows = await db
      .select({ status: schema.notificationDelivery.status })
      .from(schema.notificationDelivery);
    expect(rows.filter((row) => row.status === 'succeeded')).toHaveLength(2);
    expect(rows.filter((row) => row.status === 'pending')).toHaveLength(4);
    expect(rows.filter((row) => row.status === 'processing')).toHaveLength(0);
  });

  it('escapes Slack markup in the title and preserves the notification link', async () => {
    await seedPendingSlackDm();
    await db
      .update(schema.notification)
      .set({ title: 'Deploy <!channel> <@U123> <https://evil.example|click>' });
    const requests: Record<string, unknown>[] = [];
    const fetch = ((_input: URL | RequestInfo, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return Promise.resolve(
        requests.length === 1
          ? new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } }))
          : new Response(JSON.stringify({ ok: true, channel: 'D123', ts: '123.456' })),
      );
    }) as unknown as typeof globalThis.fetch;

    expect(await deliverPendingSlackDms(db, 10, fetch)).toBe(1);

    const [storedDelivery] = await db.select().from(schema.notificationDelivery);
    const [storedNotification] = await db
      .select({ deliveredChannels: schema.notification.deliveredChannels })
      .from(schema.notification);
    expect(requests[1]).toEqual({
      channel: 'D123',
      text: 'Deploy &lt;!channel&gt; &lt;@U123&gt; &lt;https://evil.example|click&gt;: https://orbit.example/issue/ORB-1',
    });
    expect(storedDelivery).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      providerMessageChannel: 'D123',
      providerMessageTs: '123.456',
    });
    expect(storedNotification?.deliveredChannels).toEqual(['slack_dm']);
  });

  it('reclaims an accepted DM after finalization is interrupted', async () => {
    await seedPendingSlackDm();
    let dispatches = 0;
    const dispatch = () => {
      dispatches += 1;
      return Promise.resolve({ delivered: 1, channel: 'D123', ts: `123.${dispatches}` });
    };

    expect(
      await deliverPendingSlackDms(db, 10, globalThis.fetch, dispatch, async () => false),
    ).toBe(0);

    const [interrupted] = await db.select().from(schema.notificationDelivery);
    expect(interrupted).toMatchObject({ status: 'processing', attempts: 0 });
    if (interrupted?.claimedAt === null || interrupted === undefined)
      throw new Error('Expected a claimed delivery.');
    await db
      .update(schema.notificationDelivery)
      .set({ claimedAt: new Date(interrupted.claimedAt.getTime() - 5 * 60_000 - 1) })
      .where(eq(schema.notificationDelivery.id, interrupted.id));

    expect(await deliverPendingSlackDms(db, 10, globalThis.fetch, dispatch)).toBe(1);

    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(dispatches).toBe(2);
    expect(stored).toMatchObject({
      id: interrupted.id,
      status: 'succeeded',
      attempts: 1,
      providerMessageChannel: 'D123',
      providerMessageTs: '123.2',
    });
  });

  it('retries without calling Slack when an absolute application URL is unavailable', async () => {
    await seedPendingSlackDm();
    delete process.env['APP_URL'];
    const fetch = (() => {
      throw new Error('Slack must not receive a relative notification URL.');
    }) as unknown as typeof globalThis.fetch;

    expect(await deliverPendingSlackDms(db, 10, fetch)).toBe(0);

    const [stored] = await db
      .select({
        status: schema.notificationDelivery.status,
        attempts: schema.notificationDelivery.attempts,
        lastError: schema.notificationDelivery.lastError,
      })
      .from(schema.notificationDelivery);
    expect(stored).toEqual({
      status: 'failed',
      attempts: 1,
      lastError: 'APP_URL is required for Slack notification links',
    });
  });

  it('does not finalize a Slack DM when Slack omits its message timestamp', async () => {
    await seedPendingSlackDm();
    const dispatch = () => Promise.resolve({ delivered: 1, channel: 'D123', ts: '' });

    expect(await deliverPendingSlackDms(db, 10, globalThis.fetch, dispatch)).toBe(0);

    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(stored).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('keeps a transient provider failure available for retry', async () => {
    await seedPendingSlackDm();
    let calls = 0;
    const fetch = (() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } }))
          : new Response(JSON.stringify({ ok: false, error: 'ratelimited' })),
      );
    }) as unknown as typeof globalThis.fetch;

    expect(await deliverPendingSlackDms(db, 10, fetch)).toBe(0);

    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(stored).toMatchObject({ status: 'failed', attempts: 1 });
    expect(stored?.lastError).toContain('ratelimited');
    if (stored === undefined) throw new Error('Expected a failed delivery.');
    const reclaimed = await db.transaction((tx) =>
      claimSlackDmDeliveries(tx, 10, new Date(stored.availableAt.getTime() + 1)),
    );
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.id).toBe(stored.id);
  });

  it('uses exponential backoff for a repeated transient failure', async () => {
    await seedPendingSlackDm();
    await db.update(schema.notificationDelivery).set({ attempts: 2 });
    const now = new Date(Date.now() + 86_400_000);
    const dispatch = () => Promise.reject(new SlackApiError('chat.postMessage', 'internal_error'));

    expect(
      await deliverPendingSlackDms(db, 1, globalThis.fetch, dispatch, undefined, {
        now: () => now,
        deadlineAt: new Date(now.getTime() + 1_000),
      }),
    ).toBe(0);

    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(stored).toMatchObject({ status: 'failed', attempts: 3 });
    expect(stored?.availableAt.getTime()).toBe(now.getTime() + 120_000);
  });

  it('honors a longer provider Retry-After delay', async () => {
    await seedPendingSlackDm();
    const now = new Date(Date.now() + 86_400_000);
    const dispatch = () =>
      Promise.reject(new SlackApiError('chat.postMessage', 'ratelimited', 90_000));

    expect(
      await deliverPendingSlackDms(db, 1, globalThis.fetch, dispatch, undefined, {
        now: () => now,
        deadlineAt: new Date(now.getTime() + 1_000),
      }),
    ).toBe(0);

    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(stored).toMatchObject({ status: 'failed', attempts: 1 });
    expect(stored?.availableAt.getTime()).toBe(now.getTime() + 90_000);
  });

  it('dead-letters a transient failure at the fifth attempt', async () => {
    await seedPendingSlackDm();
    await db.update(schema.notificationDelivery).set({ attempts: 4 });
    const dispatch = () => Promise.reject(new SlackApiError('chat.postMessage', 'internal_error'));

    expect(await deliverPendingSlackDms(db, 1, globalThis.fetch, dispatch)).toBe(0);

    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(stored).toMatchObject({ status: 'dead_letter', attempts: 5 });
    expect(await claimSlackDmDeliveries(db, 1, new Date(Date.now() + 86_400_000))).toEqual([]);
  });

  it('dead-letters a permanent Slack API failure without retrying', async () => {
    await seedPendingSlackDm();
    const dispatch = () =>
      Promise.reject(new SlackApiError('chat.postMessage', 'channel_not_found'));

    expect(await deliverPendingSlackDms(db, 1, globalThis.fetch, dispatch)).toBe(0);

    const [stored] = await db.select().from(schema.notificationDelivery);
    expect(stored).toMatchObject({
      status: 'dead_letter',
      attempts: 1,
      lastError: 'Slack chat.postMessage failed: channel_not_found.',
    });
    expect(await claimSlackDmDeliveries(db, 1, new Date(Date.now() + 86_400_000))).toEqual([]);
  });

  it('does not count an attempt when Slack becomes unavailable before dispatch', async () => {
    await seedPendingSlackDm();
    const dispatch = async () => ({ delivered: 0, channel: null, ts: null });

    expect(await deliverPendingSlackDms(db, 10, globalThis.fetch, dispatch)).toBe(0);

    const [stored] = await db
      .select({
        status: schema.notificationDelivery.status,
        attempts: schema.notificationDelivery.attempts,
        lastError: schema.notificationDelivery.lastError,
      })
      .from(schema.notificationDelivery);
    expect(stored).toEqual({
      status: 'skipped',
      attempts: 0,
      lastError: 'Slack user mapping unavailable',
    });
  });

  it('records a permanent provider failure and requires Slack reauthorization', async () => {
    const fixture = await seedPendingSlackDm();
    let calls = 0;
    const fetch = (() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } }))
          : new Response(JSON.stringify({ ok: false, error: 'token_revoked' })),
      );
    }) as unknown as typeof globalThis.fetch;

    expect(await deliverPendingSlackDms(db, 10, fetch)).toBe(0);

    const [storedIntegration] = await db
      .select({ config: schema.integration.config })
      .from(schema.integration)
      .where(eq(schema.integration.id, fixture.integrationId));
    const [storedDelivery] = await db
      .select({
        status: schema.notificationDelivery.status,
        attempts: schema.notificationDelivery.attempts,
        lastError: schema.notificationDelivery.lastError,
      })
      .from(schema.notificationDelivery);
    expect(storedDelivery).toEqual({ status: 'skipped', attempts: 1, lastError: 'token_revoked' });
    expect(storedIntegration?.config['slackReauthorize']).toBe(true);
  });

  it('retries a permanent failure after a concurrent token refresh', async () => {
    const fixture = await seedPendingSlackDm();
    let calls = 0;
    const authorization: string[] = [];
    const fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      calls += 1;
      authorization.push(String(new Headers(init?.headers).get('authorization')));
      if (calls === 1) {
        return new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } }));
      }
      if (calls === 2) {
        await db
          .update(schema.integration)
          .set({
            credentials: { botToken: 'xoxb-refreshed' },
            config: { scopes: ['chat:write', 'im:write'] },
            updatedAt: new Date(Date.now() + 1_000),
          })
          .where(eq(schema.integration.id, fixture.integrationId));
        return new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }));
      }
      return new Response(JSON.stringify({ ok: true, channel: 'D123', ts: '123.456' }));
    }) as unknown as typeof globalThis.fetch;

    expect(await deliverPendingSlackDms(db, 10, fetch)).toBe(0);

    const [storedIntegration] = await db
      .select({ config: schema.integration.config, credentials: schema.integration.credentials })
      .from(schema.integration)
      .where(eq(schema.integration.id, fixture.integrationId));
    const [failedDelivery] = await db.select().from(schema.notificationDelivery);
    expect(storedIntegration).toEqual({
      config: { scopes: ['chat:write', 'im:write'] },
      credentials: { botToken: 'xoxb-refreshed' },
    });
    expect(failedDelivery).toMatchObject({ status: 'failed', attempts: 1 });
    if (failedDelivery === undefined) throw new Error('Expected a retryable delivery.');
    await db
      .update(schema.notificationDelivery)
      .set({ availableAt: new Date(0) })
      .where(eq(schema.notificationDelivery.id, failedDelivery.id));

    expect(await deliverPendingSlackDms(db, 10, fetch)).toBe(1);
    expect(authorization).toEqual(['Bearer xoxb-old', 'Bearer xoxb-old', 'Bearer xoxb-refreshed']);
  });

  it('does not mark a same-token refreshed Slack integration for reauthorization', async () => {
    const fixture = await seedPendingSlackDm();
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } }));
      }
      await db
        .update(schema.integration)
        .set({
          config: { scopes: ['chat:write', 'im:write'], reconnectMarker: 'fresh' },
          updatedAt: new Date(Date.now() + 1_000),
        })
        .where(eq(schema.integration.id, fixture.integrationId));
      return new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }));
    }) as unknown as typeof globalThis.fetch;

    expect(await deliverPendingSlackDms(db, 10, fetch)).toBe(0);

    const [storedIntegration] = await db
      .select({ config: schema.integration.config })
      .from(schema.integration)
      .where(eq(schema.integration.id, fixture.integrationId));
    const [storedDelivery] = await db.select().from(schema.notificationDelivery);
    expect(storedIntegration?.config).toEqual({
      scopes: ['chat:write', 'im:write'],
      reconnectMarker: 'fresh',
    });
    expect(storedDelivery).toMatchObject({ status: 'failed', attempts: 1 });
  });
});
