import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import type { NotificationEvent } from '@orbit/services/notifications';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  deliverPendingNotificationEmails,
  deliverPendingSlackChannels,
  deliverPendingSlackDms,
  notifyRecipients,
} from '../../src/notifications/notify.ts';
import { resetDatabase } from '../../src/test-support.ts';

const previous = {
  APP_URL: process.env['APP_URL'],
  NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
  SLACK_ENABLED: process.env['SLACK_ENABLED'],
  EMAIL_FROM: process.env['EMAIL_FROM'],
  BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
};

beforeEach(async () => {
  await resetDatabase();
  process.env['APP_URL'] = 'https://orbit.example';
  delete process.env['NEXT_PUBLIC_APP_URL'];
  process.env['SLACK_ENABLED'] = 'true';
  process.env['EMAIL_FROM'] = 'Orbit <updates@example.com>';
  process.env['BETTER_AUTH_SECRET'] = 'provider-wrapper-test-secret';
});
afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function seed() {
  const organizationId = randomUUIDv7();
  const userId = randomUUIDv7();
  const projectId = randomUUIDv7();
  const integrationId = randomUUIDv7();
  await db
    .insert(schema.organization)
    .values({ id: organizationId, name: 'Provider workspace', slug: organizationId });
  await db.insert(schema.user).values({
    id: userId,
    name: 'Recipient',
    handle: userId,
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  await db
    .insert(schema.member)
    .values({ id: randomUUIDv7(), organizationId, userId, role: 'member' });
  await db.insert(schema.notificationSetting).values({ userId, quietHoursEnabled: false });
  await db
    .insert(schema.project)
    .values({ id: projectId, organizationId, name: 'Project', slug: projectId });
  await db.insert(schema.integration).values({
    id: integrationId,
    organizationId,
    provider: 'slack',
    externalId: 'default',
    connectedById: userId,
    credentials: { botToken: 'test-token' },
    config: {
      slackTeamId: `T-${organizationId}`,
      slackAppId: 'A-test',
      credentialGeneration: 0,
      scopes: ['chat:write', 'im:write'],
    },
  });
  await db.insert(schema.slackUserMapping).values({
    id: randomUUIDv7(),
    integrationId,
    organizationId,
    userId,
    slackUserId: 'U-test',
    slackChannelId: 'D-test',
  });
  await db.insert(schema.slackChannelSync).values({
    id: randomUUIDv7(),
    integrationId,
    organizationId,
    channelId: 'C-test',
    channelName: 'updates',
    events: [],
  });
  const event: NotificationEvent = {
    organizationId,
    userIds: [userId],
    type: 'mention',
    reason: 'mentioned',
    entityType: 'project',
    entityId: projectId,
    title: 'Review requested',
    body: 'Please review the project.',
    url: '/inbox',
    actor: { type: 'system', id: 'orbit', name: 'Orbit' },
  };
  return { organizationId, event };
}

describe('global notification provider routing', () => {
  it('persists shared-channel work even when an update has no personal recipients', async () => {
    const fixture = await seed();
    await notifyRecipients(db, [{ ...fixture.event, userIds: [] }]);
    const rows = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.organizationId, fixture.organizationId));
    expect(rows.map((row) => row.channel)).toEqual(['slack']);
    expect(rows[0]?.notificationId).toBeNull();
  });
  it('queues personal notifications across every eligible workspace', async () => {
    const first = await seed();
    const second = await seed();
    await notifyRecipients(db, [first.event, second.event]);
    const rows = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.channel, 'slack_dm'));
    expect(rows.map((row) => row.organizationId).sort()).toEqual(
      [first.organizationId, second.organizationId].sort(),
    );
  });

  it('keeps Slack disabled globally while retaining durable notification email', async () => {
    const fixture = await seed();
    process.env['SLACK_ENABLED'] = 'false';
    await notifyRecipients(db, [fixture.event]);
    const rows = await db.select().from(schema.notificationDelivery);
    expect(rows.map((row) => row.channel)).toEqual(['email']);
  });

  for (const [channel, deliver] of [
    ['slack_dm', deliverPendingSlackDms],
    ['slack', deliverPendingSlackChannels],
    ['email', deliverPendingNotificationEmails],
  ] as const) {
    it(`routes ${channel} through the shared durable worker without sending another provider`, async () => {
      const fixture = await seed();
      await notifyRecipients(db, [fixture.event]);
      const urls: string[] = [];
      const fetch = ((input: URL | RequestInfo) => {
        urls.push(String(input));
        return Promise.resolve(
          channel === 'email'
            ? Response.json({ id: 'email-confirmed' })
            : Response.json({
                ok: true,
                channel: channel === 'slack' ? 'C-test' : 'D-test',
                ts: '1.000',
              }),
        );
      }) as unknown as typeof globalThis.fetch;
      expect(await deliver(db, 100, fetch)).toBe(1);
      expect(urls).toEqual([
        channel === 'email'
          ? 'https://api.resend.com/emails'
          : 'https://slack.com/api/chat.postMessage',
      ]);
      const rows = await db
        .select()
        .from(schema.notificationDelivery)
        .where(
          and(
            eq(schema.notificationDelivery.organizationId, fixture.organizationId),
            eq(schema.notificationDelivery.status, 'delivered'),
          ),
        );
      expect(rows.map((row) => row.channel)).toEqual([channel]);
    });
  }
});
