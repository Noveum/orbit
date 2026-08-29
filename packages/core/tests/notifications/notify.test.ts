import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { claimSlackDmDeliveries } from '@orbit/services/notifications';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { deliverPendingSlackDms } from '../../src/notifications/notify.ts';
import { resetDatabase } from '../../src/test-support.ts';

interface Fixture {
  readonly organizationId: string;
  readonly userId: string;
  readonly integrationId: string;
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

describe('deliverPendingSlackDms', () => {
  it('sends an absolute notification link and records the provider message identity', async () => {
    await seedPendingSlackDm();
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
      text: 'You were mentioned: https://orbit.example/issue/ORB-1',
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
      return calls === 3
        ? new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } }))
        : new Response(JSON.stringify({ ok: true, channel: 'D123', ts: '123.456' }));
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
    expect(authorization).toEqual([
      'Bearer xoxb-old',
      'Bearer xoxb-old',
      'Bearer xoxb-refreshed',
      'Bearer xoxb-refreshed',
    ]);
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
