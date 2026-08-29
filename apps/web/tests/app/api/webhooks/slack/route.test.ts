import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';

const SECRET = 'a-slack-webhook-secret';
process.env['SLACK_SIGNING_SECRET'] = SECRET;

const unfurled: { channel: string; ts: string; urls: string[] }[] = [];
const core = await import('@orbit/core');
const services = await import('@orbit/services');
const slackCapability = await import('@orbit/shared/constants');
mock.module('@orbit/core', () => ({ ...core, publishDeltas: () => Promise.resolve(undefined) }));
mock.module('@orbit/shared/constants', () => ({
  ...slackCapability,
  SLACK_INTEGRATION_ENABLED: true,
}));
mock.module('@orbit/services', () => ({
  ...services,
  SlackClient: class {
    unfurl(input: { channel: string; ts: string; unfurls: Record<string, unknown> }) {
      unfurled.push({ channel: input.channel, ts: input.ts, urls: Object.keys(input.unfurls) });
      return Promise.resolve();
    }
  },
  resolveIssueUnfurls: () => {
    return Promise.resolve({ 'https://app.orbit.ac/ORB/3': { title: 'Dashboard' } });
  },
}));
mock.module('@orbit/services/slack/dispatch', () => ({
  ...services,
  resolveSlackContext: async (_db: unknown, organizationId: string) => {
    if (organizationId === '') return null;
    const [row] = await db
      .select({ credentials: schema.integration.credentials })
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, organizationId),
          eq(schema.integration.provider, 'slack'),
        ),
      )
      .limit(1);
    return { integrationId: 'int', token: row ? 'xoxb-test' : null };
  },
}));
mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

const { POST } = await import('../../../../../src/app/api/webhooks/slack/route.ts');

afterAll(() => {
  mock.module('@orbit/core', () => core);
  mock.module('@orbit/services', () => services);
});

let workspace: Workspace;

function signedBody(payload: object): Request {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', SECRET).update(`v0:${timestamp}:${raw}`).digest('hex');
  return new Request('https://app.orbit.ac/api/webhooks/slack', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': `v0=${signature}`,
    },
    body: raw,
  });
}

function linkShared(teamId: string): Request {
  return signedBody({
    type: 'event_callback',
    team_id: teamId,
    event: {
      type: 'link_shared',
      channel: 'C123',
      message_ts: '1000000000.000100',
      links: [{ url: 'https://app.orbit.ac/ORB/3', domain: 'orbit.ac' }],
    },
  });
}

async function seedSlack(overrides: Record<string, unknown> = {}): Promise<void> {
  await resetDatabase();
  workspace = await createWorkspace('Slacky');
  await db.insert(schema.integration).values({
    id: `int_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    provider: 'slack',
    externalId: 'default',
    connectedById: workspace.adminUser.id,
    config: { scopes: ['chat:write'], slackTeamId: 'T0123' },
    credentials: { botToken: 'xoxb-test' },
    ...overrides,
  });
}

beforeEach(() => {
  unfurled.length = 0;
});

describe('slack webhook', () => {
  it('resolves the workspace through config.slackTeamId', async () => {
    await seedSlack();
    const res = await POST(linkShared('T0123'));
    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(1);
    expect(unfurled[0]!.channel).toBe('C123');
  });

  it('falls back to the legacy externalId for pre-#323 workspaces', async () => {
    await seedSlack({ config: { scopes: [] }, externalId: 'T0456' });
    const res = await POST(linkShared('T0456'));
    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(1);
  });

  it('does not unfurl for an unknown team', async () => {
    await seedSlack();
    const res = await POST(linkShared('T9999'));
    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(0);
  });

  it('answers url_verification challenges', async () => {
    const res = await POST(
      signedBody({
        type: 'url_verification',
        challenge: 'challenge-token',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'challenge-token' });
  });

  it('rejects unsigned requests', async () => {
    const res = await POST(
      new Request('https://app.orbit.ac/api/webhooks/slack', {
        method: 'POST',
        body: JSON.stringify({ type: 'url_verification', challenge: 'x' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(401);
  });
});
