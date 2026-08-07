import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';

const SIGNING_SECRET = 'a-slack-signing-secret';
process.env['SLACK_SIGNING_SECRET'] = SIGNING_SECRET;

interface UnfurlInput {
  readonly channel: string;
  readonly ts: string;
  readonly unfurls: Record<string, unknown>;
}

interface UnfurlCall extends UnfurlInput {
  readonly token: string;
}

const unfurlCalls: UnfurlCall[] = [];
const services = await import('@orbit/services');

class RecordingSlackClient {
  constructor(readonly options: { token: string }) {}

  unfurl(input: UnfurlInput): Promise<void> {
    unfurlCalls.push({ ...input, token: this.options.token });
    return Promise.resolve();
  }
}

mock.module('@orbit/services', () => ({ ...services, SlackClient: RecordingSlackClient }));

const { POST } = await import('../../../../../src/app/api/webhooks/slack/route.ts');

afterAll(() => {
  mock.module('@orbit/services', () => services);
});

const SLACK_TEAM = 'T-orbit-first';
const OTHER_SLACK_TEAM = 'T-orbit-second';
const SECOND_SLACK_TEAM_OF_FIRST = 'T-orbit-first-annex';

function botTokenFor(slackTeamId: string): string {
  return `xoxb-${slackTeamId}`;
}

async function addSlackIntegration(workspace: Workspace, slackTeamId: string): Promise<void> {
  await db.insert(schema.integration).values({
    id: `int_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    provider: 'slack',
    externalId: slackTeamId,
    connectedById: workspace.adminUser.id,
    credentials: { botToken: botTokenFor(slackTeamId) },
  });
}

async function connect(name: string, slackTeamId: string, title: string): Promise<Workspace> {
  const workspace = await createWorkspace(name);
  await addSlackIntegration(workspace, slackTeamId);
  await db.update(schema.team).set({ key: 'ORB' }).where(eq(schema.team.id, workspace.teamId));
  const todo = workspace.states.find((state) => state.category === 'unstarted');
  if (todo === undefined) throw new Error('the seeded team has no unstarted state');
  await db.insert(schema.issue).values({
    id: `iss_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    teamId: workspace.teamId,
    number: 5,
    identifier: 'ORB-5',
    title,
    stateId: todo.id,
    creatorId: workspace.adminUser.id,
  });
  return workspace;
}

async function seed(): Promise<void> {
  await resetDatabase();
  const first = await connect('Slackedone', SLACK_TEAM, 'Owned by the first workspace');
  await addSlackIntegration(first, SECOND_SLACK_TEAM_OF_FIRST);
  await connect('Slackedtwo', OTHER_SLACK_TEAM, 'Owned by the second workspace');
}

function request(raw: string, headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/webhooks/slack', {
    method: 'POST',
    body: raw,
    headers: new Headers(headers),
  });
}

function signed(payload: unknown): Request {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${timestamp}:${raw}`)
    .digest('hex');
  return request(raw, {
    'x-slack-signature': `v0=${digest}`,
    'x-slack-request-timestamp': timestamp,
  });
}

function linkShared(teamId: string, url: string) {
  return {
    type: 'event_callback',
    team_id: teamId,
    event: {
      type: 'link_shared',
      channel: 'C123',
      message_ts: '1700000000.000100',
      links: [{ url, domain: 'orbit.local' }],
    },
  };
}

const bodySchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ challenge: z.string() }),
  z.object({ error: z.string() }),
]);

beforeEach(async () => {
  unfurlCalls.length = 0;
  await seed();
});

describe('POST /api/webhooks/slack', () => {
  it('rejects a payload whose signature does not match the signing secret', async () => {
    const raw = JSON.stringify(linkShared(SLACK_TEAM, 'https://orbit.local/issue/ORB-5'));
    const response = await POST(
      request(raw, {
        'x-slack-signature': 'v0=deadbeef',
        'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      }),
    );

    expect(response.status).toBe(401);
    expect(bodySchema.parse(await response.json())).toEqual({ error: 'invalid signature' });
    expect(unfurlCalls).toHaveLength(0);
  });

  it('rejects a correctly signed payload whose timestamp is outside the replay window', async () => {
    const raw = JSON.stringify(linkShared(SLACK_TEAM, 'https://orbit.local/issue/ORB-5'));
    const stale = String(Math.floor(Date.now() / 1000) - 3_600);
    const digest = createHmac('sha256', SIGNING_SECRET).update(`v0:${stale}:${raw}`).digest('hex');

    const response = await POST(
      request(raw, {
        'x-slack-signature': `v0=${digest}`,
        'x-slack-request-timestamp': stale,
      }),
    );

    expect(response.status).toBe(401);
    expect(unfurlCalls).toHaveLength(0);
  });

  it('echoes the challenge of a url verification handshake', async () => {
    const response = await POST(
      signed({ type: 'url_verification', challenge: 'the-challenge-value' }),
    );

    expect(response.status).toBe(200);
    expect(bodySchema.parse(await response.json())).toEqual({ challenge: 'the-challenge-value' });
    expect(unfurlCalls).toHaveLength(0);
  });

  it('unfurls a shared issue link through the slack client exactly once', async () => {
    const response = await POST(signed(linkShared(SLACK_TEAM, 'https://orbit.local/issue/ORB-5')));

    expect(response.status).toBe(200);
    expect(bodySchema.parse(await response.json())).toEqual({ ok: true });
    expect(unfurlCalls).toHaveLength(1);
    expect(unfurlCalls[0]?.channel).toBe('C123');
    expect(unfurlCalls[0]?.ts).toBe('1700000000.000100');
    expect(Object.keys(unfurlCalls[0]?.unfurls ?? {})).toEqual(['https://orbit.local/issue/ORB-5']);
    expect(JSON.stringify(unfurlCalls[0]?.unfurls)).toContain('Owned by the first workspace');
  });

  it('answers with the bot token of the slack workspace the event came from', async () => {
    await POST(signed(linkShared(SLACK_TEAM, 'https://orbit.local/issue/ORB-5')));
    await POST(signed(linkShared(SECOND_SLACK_TEAM_OF_FIRST, 'https://orbit.local/issue/ORB-5')));

    expect(unfurlCalls.map((call) => call.token)).toEqual([
      botTokenFor(SLACK_TEAM),
      botTokenFor(SECOND_SLACK_TEAM_OF_FIRST),
    ]);
  });

  it('signs a second slack workspace unfurl with that other workspace token', async () => {
    await POST(signed(linkShared(OTHER_SLACK_TEAM, 'https://orbit.local/issue/ORB-5')));
    await POST(signed(linkShared(SLACK_TEAM, 'https://orbit.local/issue/ORB-5')));

    expect(unfurlCalls.map((call) => call.token)).toEqual([
      botTokenFor(OTHER_SLACK_TEAM),
      botTokenFor(SLACK_TEAM),
    ]);
  });

  it('answers each slack workspace with the issue of the workspace bound to it', async () => {
    await POST(signed(linkShared(SLACK_TEAM, 'https://orbit.local/issue/ORB-5')));
    await POST(signed(linkShared(OTHER_SLACK_TEAM, 'https://orbit.local/issue/ORB-5')));

    expect(unfurlCalls).toHaveLength(2);
    expect(JSON.stringify(unfurlCalls[0]?.unfurls)).toContain('Owned by the first workspace');
    expect(JSON.stringify(unfurlCalls[1]?.unfurls)).toContain('Owned by the second workspace');
  });

  it('does nothing for a slack workspace that is not connected here', async () => {
    const response = await POST(
      signed(linkShared('T-somebody-else', 'https://orbit.local/issue/ORB-5')),
    );

    expect(response.status).toBe(200);
    expect(bodySchema.parse(await response.json())).toEqual({ ok: true });
    expect(unfurlCalls).toHaveLength(0);
  });

  it('does nothing when the shared link resolves to no issue in this workspace', async () => {
    const response = await POST(
      signed(linkShared(SLACK_TEAM, 'https://orbit.local/issue/ORB-404')),
    );

    expect(response.status).toBe(200);
    expect(unfurlCalls).toHaveLength(0);
  });

  it('answers ok without unfurling for an event shape it does not handle', async () => {
    const response = await POST(
      signed({
        type: 'event_callback',
        team_id: SLACK_TEAM,
        event: { type: 'message', channel: 'C123', text: 'hello' },
      }),
    );

    expect(response.status).toBe(200);
    expect(bodySchema.parse(await response.json())).toEqual({ ok: true });
    expect(unfurlCalls).toHaveLength(0);
  });

  it('answers 400 for a signed body that is not json', async () => {
    const raw = '}{';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = createHmac('sha256', SIGNING_SECRET)
      .update(`v0:${timestamp}:${raw}`)
      .digest('hex');

    const response = await POST(
      request(raw, {
        'x-slack-signature': `v0=${digest}`,
        'x-slack-request-timestamp': timestamp,
      }),
    );

    expect(response.status).toBe(400);
    expect(bodySchema.parse(await response.json())).toEqual({ error: 'invalid json' });
  });
});
