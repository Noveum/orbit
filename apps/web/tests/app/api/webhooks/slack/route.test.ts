import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { Workspace } from '@orbit/core/test-support';
import { z } from 'zod';

const SIGNING_SECRET = 'slack-link-shared-route-secret';
const ISSUE_URL = 'https://orbit.local/issue/ORB-42';
const existingAuthSecret = process.env['BETTER_AUTH_SECRET'];
const existingSigningSecret = process.env['SLACK_SIGNING_SECRET'];
process.env['BETTER_AUTH_SECRET'] ??= 'slack-webhook-route-test-secret';
process.env['SLACK_SIGNING_SECRET'] = SIGNING_SECRET;

const { createWorkspace, resetDatabase } = await import('@orbit/core/test-support');
const { db, schema } = await import('@orbit/db');
const { ensureSlackIntegration } = await import('@orbit/services');
const { randomUUIDv7 } = await import('@orbit/shared/utils');
const slackCapability = await import('@/lib/integrations/slack-capability.ts');
const slackCapabilitySpy = spyOn(slackCapability, 'slackIntegrationEnabled').mockReturnValue(true);
const { POST } = await import('@/app/api/webhooks/slack/route.ts');

interface ProviderRequest {
  readonly url: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

const unfurlBodySchema = z.object({
  channel: z.string(),
  ts: z.string(),
  unfurls: z.record(z.string(), z.object({ blocks: z.array(z.record(z.string(), z.unknown())) })),
});

const realFetch = globalThis.fetch;
const providerRequests: ProviderRequest[] = [];
let providerErrorCode: string | null = null;
let providerResponder: (() => Promise<Response>) | null = null;
const providerFetch = Object.assign(
  async (...args: Parameters<typeof globalThis.fetch>) => {
    const request = new Request(...args);
    providerRequests.push({
      url: request.url,
      authorization: request.headers.get('authorization'),
      body: await request.json(),
    });
    if (providerResponder !== null) return await providerResponder();
    return Response.json(
      providerErrorCode === null ? { ok: true } : { ok: false, error: providerErrorCode },
    );
  },
  { preconnect: realFetch.preconnect },
) satisfies typeof globalThis.fetch;

let workspace: Workspace;

async function seedWorkspace(
  name: string,
  slackTeamId: string,
  botToken: string,
  issueTitle: string,
): Promise<Workspace> {
  const seeded = await createWorkspace(name);
  const state = seeded.states.find((candidate) => candidate.category === 'unstarted');
  if (state === undefined) throw new Error('The Slack webhook fixture needs an unstarted state.');
  await db.insert(schema.issue).values({
    id: `iss_${randomUUIDv7()}`,
    organizationId: seeded.organizationId,
    teamId: seeded.teamId,
    number: 42,
    identifier: 'ORB-42',
    title: issueTitle,
    stateId: state.id,
    creatorId: seeded.adminUser.id,
  });
  await ensureSlackIntegration(db, {
    organizationId: seeded.organizationId,
    connectedById: seeded.adminUser.id,
    botToken,
    externalId: slackTeamId,
    scopes: ['chat:write', 'links:read', 'links:write'],
  });
  return seeded;
}

function signedLinkShared(teamId: string, eventId = 'Ev-OAUTH-1'): Request {
  const raw = JSON.stringify({
    type: 'event_callback',
    event_id: eventId,
    team_id: teamId,
    event: {
      type: 'link_shared',
      channel: 'C-LINKS',
      message_ts: '1712345678.000100',
      links: [{ domain: 'orbit.local', url: ISSUE_URL }],
    },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `v0=${createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${timestamp}:${raw}`)
    .digest('hex')}`;
  return new Request('http://localhost:3000/api/webhooks/slack', {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  providerRequests.length = 0;
  providerErrorCode = null;
  providerResponder = null;
  globalThis.fetch = providerFetch;
  workspace = await seedWorkspace('PrimarySlack', 'T-OAUTH', 'xoxb-primary', 'Primary issue');
});

afterAll(() => {
  globalThis.fetch = realFetch;
  slackCapabilitySpy.mockRestore();
  if (existingAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = existingAuthSecret;
  if (existingSigningSecret === undefined) delete process.env['SLACK_SIGNING_SECRET'];
  else process.env['SLACK_SIGNING_SECRET'] = existingSigningSecret;
});

describe('POST /api/webhooks/slack', () => {
  it('unfurls a signed link for an OAuth-created integration found by config team id', async () => {
    await seedWorkspace('OtherSlack', 'T-OTHER', 'xoxb-other', 'Other issue');

    const response = await POST(signedLinkShared('T-OAUTH'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(providerRequests).toHaveLength(1);
    const request = providerRequests[0];
    if (request === undefined) throw new Error('Slack did not receive an unfurl request.');
    expect(request.url).toBe('https://slack.com/api/chat.unfurl');
    expect(request.authorization).toBe('Bearer xoxb-primary');
    expect(unfurlBodySchema.parse(request.body)).toEqual({
      channel: 'C-LINKS',
      ts: '1712345678.000100',
      unfurls: {
        [ISSUE_URL]: {
          blocks: expect.arrayContaining([expect.objectContaining({ type: 'section' })]),
        },
      },
    });
    expect(JSON.stringify(request.body)).toContain('Primary issue');
    expect(JSON.stringify(request.body)).not.toContain('Other issue');
  });

  it('uses the configured team id instead of a stale legacy external id', async () => {
    await db.update(schema.integration).set({
      externalId: 'T-STALE',
      config: {
        scopes: ['chat:write', 'links:read', 'links:write'],
        slackTeamId: 'T-OAUTH',
      },
    });

    const staleResponse = await POST(signedLinkShared('T-STALE', 'Ev-STALE-TEAM'));

    expect(staleResponse.status).toBe(200);
    expect(providerRequests).toEqual([]);

    const currentResponse = await POST(signedLinkShared('T-OAUTH', 'Ev-CURRENT-TEAM'));

    expect(currentResponse.status).toBe(200);
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]?.authorization).toBe('Bearer xoxb-primary');
  });

  it('does nothing for an unknown Slack team', async () => {
    const response = await POST(signedLinkShared('T-UNKNOWN'));

    expect(response.status).toBe(200);
    expect(providerRequests).toEqual([]);
  });

  it('fails closed when two Orbit workspaces use the same Slack team id', async () => {
    const duplicate = await seedWorkspace(
      'DuplicateSlack',
      'T-OAUTH',
      'xoxb-duplicate',
      'Duplicate issue',
    );
    expect(duplicate.organizationId).not.toBe(workspace.organizationId);

    const response = await POST(signedLinkShared('T-OAUTH'));

    expect(response.status).toBe(200);
    expect(providerRequests).toEqual([]);
  });

  it('deduplicates a replayed Slack event id before another unfurl', async () => {
    const first = await POST(signedLinkShared('T-OAUTH', 'Ev-REPLAY'));

    expect(first.status).toBe(200);
    expect(providerRequests).toHaveLength(1);

    const replay = await POST(signedLinkShared('T-OAUTH', 'Ev-REPLAY'));

    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true });
    expect(providerRequests).toHaveLength(1);
    const [delivery] = await db
      .select({ status: schema.webhookDelivery.status })
      .from(schema.webhookDelivery);
    expect(delivery).toEqual({ status: 'processed' });
  });

  it('reclaims a failed Slack event when Slack replays it', async () => {
    providerErrorCode = 'internal_error';
    const first = await POST(signedLinkShared('T-OAUTH', 'Ev-FAILED'));
    expect(first.status).toBe(500);
    const [failed] = await db
      .select({ status: schema.webhookDelivery.status })
      .from(schema.webhookDelivery);
    expect(failed).toEqual({ status: 'failed' });

    providerErrorCode = null;
    const replay = await POST(signedLinkShared('T-OAUTH', 'Ev-FAILED'));

    expect(replay.status).toBe(200);
    expect(providerRequests).toHaveLength(2);
    const [processed] = await db
      .select({ status: schema.webhookDelivery.status })
      .from(schema.webhookDelivery);
    expect(processed).toEqual({ status: 'processed' });
  });

  it('reclaims a stale Slack event whose processing attempt never completed', async () => {
    await db.insert(schema.webhookDelivery).values({
      id: randomUUIDv7(),
      provider: 'slack',
      deliveryId: 'Ev-STALE',
      event: 'link_shared',
      status: 'processing',
      claimedAt: new Date(Date.now() - 5 * 60_000),
    });

    const replay = await POST(signedLinkShared('T-OAUTH', 'Ev-STALE'));

    expect(replay.status).toBe(200);
    expect(providerRequests).toHaveLength(1);
  });

  it('returns a retryable response while another attempt owns a fresh claim', async () => {
    await db.insert(schema.webhookDelivery).values({
      id: randomUUIDv7(),
      provider: 'slack',
      deliveryId: 'Ev-IN-PROGRESS',
      event: 'link_shared',
      status: 'processing',
      claimedAt: new Date(),
    });

    const response = await POST(signedLinkShared('T-OAUTH', 'Ev-IN-PROGRESS'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'in_progress' });
    expect(providerRequests).toEqual([]);
  });

  it('prevents a late stale worker from overwriting a replacement claim', async () => {
    let releaseFirst: ((response: Response) => void) | undefined;
    let signalFirstStarted: (() => void) | undefined;
    const firstProviderResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const firstProviderStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    let providerCalls = 0;
    providerResponder = async () => {
      providerCalls += 1;
      if (providerCalls !== 1) return Response.json({ ok: true });
      signalFirstStarted?.();
      return await firstProviderResponse;
    };

    const staleAttempt = POST(signedLinkShared('T-OAUTH', 'Ev-CLAIM-RACE'));
    await firstProviderStarted;
    await db.update(schema.webhookDelivery).set({ claimedAt: new Date(Date.now() - 5 * 60_000) });

    const replacement = await POST(signedLinkShared('T-OAUTH', 'Ev-CLAIM-RACE'));

    expect(replacement.status).toBe(200);
    releaseFirst?.(Response.json({ ok: false, error: 'internal_error' }));
    expect((await staleAttempt).status).toBe(500);
    const [delivery] = await db
      .select({ status: schema.webhookDelivery.status })
      .from(schema.webhookDelivery);
    expect(delivery).toEqual({ status: 'processed' });
    expect(providerRequests).toHaveLength(2);
  });
});
