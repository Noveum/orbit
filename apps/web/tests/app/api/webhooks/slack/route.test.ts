import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';

const SECRET = 'a-slack-webhook-secret';
const originalSigningSecret = process.env['SLACK_SIGNING_SECRET'];
process.env['SLACK_SIGNING_SECRET'] = SECRET;

const unfurled: { channel: string; ts: string; token: string; urls: string[] }[] = [];
const core = { ...(await import('@orbit/core')) };
const services = { ...(await import('@orbit/services')) };
const slackCapability = { ...(await import('@orbit/shared/constants')) };
const nextHeaders = { ...(await import('next/headers')) };
mock.module('@orbit/core', () => ({ ...core, publishDeltas: () => Promise.resolve(undefined) }));
mock.module('@orbit/shared/constants', () => ({
  ...slackCapability,
  SLACK_INTEGRATION_ENABLED: true,
}));
mock.module('@orbit/services', () => ({
  ...services,
  SlackClient: class {
    private readonly token: string;

    constructor(input: { token: string }) {
      this.token = input.token;
    }

    unfurl(input: { channel: string; ts: string; unfurls: Record<string, unknown> }) {
      unfurled.push({
        channel: input.channel,
        ts: input.ts,
        token: this.token,
        urls: Object.keys(input.unfurls),
      });
      return Promise.resolve();
    }
  },
  resolveIssueUnfurls: () => {
    return Promise.resolve({ 'https://app.orbit.ac/ORB/3': { title: 'Dashboard' } });
  },
}));
mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

const { POST } = await import('../../../../../src/app/api/webhooks/slack/route.ts');

afterAll(() => {
  if (originalSigningSecret === undefined) delete process.env['SLACK_SIGNING_SECRET'];
  else process.env['SLACK_SIGNING_SECRET'] = originalSigningSecret;
  mock.module('@orbit/core', () => core);
  mock.module('@orbit/services', () => services);
  mock.module('@orbit/shared/constants', () => slackCapability);
  mock.module('next/headers', () => nextHeaders);
});

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

async function addSlack(
  workspace: Workspace,
  input: {
    readonly externalId: string;
    readonly config: Record<string, unknown>;
    readonly token: string;
  },
): Promise<void> {
  await db.insert(schema.integration).values({
    id: `int_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    provider: 'slack',
    externalId: input.externalId,
    connectedById: workspace.adminUser.id,
    config: input.config,
    credentials: { botToken: input.token },
  });
}

async function seedSlack(
  input: {
    readonly externalId?: string;
    readonly config?: Record<string, unknown>;
    readonly token?: string;
  } = {},
): Promise<Workspace> {
  await resetDatabase();
  const workspace = await createWorkspace('Slacky');
  await addSlack(workspace, {
    externalId: input.externalId ?? 'default',
    config: input.config ?? { scopes: ['chat:write'], slackTeamId: 'T0123' },
    token: input.token ?? 'xoxb-test',
  });
  return workspace;
}

beforeEach(() => {
  unfurled.length = 0;
});

let restoreWarning: () => void = () => undefined;

function silenceWarnings() {
  const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
  restoreWarning = () => warning.mockRestore();
  return warning;
}

afterEach(() => {
  restoreWarning();
  restoreWarning = () => undefined;
});

describe('slack webhook', () => {
  it('resolves the workspace through config.slackTeamId', async () => {
    await seedSlack();
    const res = await POST(linkShared('T0123'));
    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(1);
    expect(unfurled[0]).toMatchObject({ channel: 'C123', token: 'xoxb-test' });
  });

  it('falls back to the legacy externalId for pre-#323 workspaces', async () => {
    await seedSlack({ config: { scopes: [] }, externalId: 'T0456', token: 'xoxb-legacy' });
    const res = await POST(linkShared('T0456'));
    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(1);
    expect(unfurled[0]?.token).toBe('xoxb-legacy');
  });

  it('does not use a stale externalId after config.slackTeamId becomes authoritative', async () => {
    await seedSlack({
      config: { scopes: ['chat:write'], slackTeamId: 'T0123' },
      externalId: 'T0456',
    });
    const warning = silenceWarnings();

    const res = await POST(linkShared('T0456'));

    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith(
      '[orbit] slack webhook team routing failed',
      expect.objectContaining({ slackTeamId: 'T0456', reason: 'unknown' }),
    );
  });

  it('uses credentials from the integration row that matched the configured team', async () => {
    const workspace = await seedSlack({ token: 'xoxb-current' });
    await addSlack(workspace, {
      externalId: 'T-legacy-other',
      config: { scopes: [] },
      token: 'xoxb-other',
    });

    const res = await POST(linkShared('T0123'));

    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(1);
    expect(unfurled[0]?.token).toBe('xoxb-current');
  });

  it('fails closed when a Slack team is connected to more than one workspace', async () => {
    await resetDatabase();
    const first = await createWorkspace('First');
    const second = await createWorkspace('Second');
    await addSlack(first, {
      externalId: 'default',
      config: { scopes: [], slackTeamId: 'T0123' },
      token: 'xoxb-first',
    });
    await addSlack(second, {
      externalId: 'default',
      config: { scopes: [], slackTeamId: 'T0123' },
      token: 'xoxb-second',
    });
    const warning = silenceWarnings();

    const res = await POST(linkShared('T0123'));

    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith(
      '[orbit] slack webhook team routing failed',
      expect.objectContaining({ slackTeamId: 'T0123', reason: 'ambiguous' }),
    );
  });

  it('does not unfurl for an unknown team', async () => {
    await seedSlack();
    const warning = silenceWarnings();
    const res = await POST(linkShared('T9999'));
    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith(
      '[orbit] slack webhook team routing failed',
      expect.objectContaining({ slackTeamId: 'T9999', reason: 'unknown' }),
    );
  });

  it('requires a legacy default integration without a team id to reconnect', async () => {
    await seedSlack({ config: { scopes: [] } });
    const warning = silenceWarnings();

    const res = await POST(linkShared('T0123'));

    expect(res.status).toBe(200);
    expect(unfurled).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith(
      '[orbit] slack webhook team routing failed',
      expect.objectContaining({ slackTeamId: 'T0123', reason: 'unknown' }),
    );
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
