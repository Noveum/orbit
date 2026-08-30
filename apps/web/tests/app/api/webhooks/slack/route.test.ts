import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { Workspace } from '@orbit/core/test-support';
import { z } from 'zod';

const SIGNING_SECRET = 'slack-link-shared-route-secret';
const ISSUE_URL = 'https://orbit.local/issue/ORB-42';
const existingAuthSecret = process.env['BETTER_AUTH_SECRET'];
const existingSlackOrganizationId = process.env['SLACK_ENABLED_ORGANIZATION_ID'];
const existingSigningSecret = process.env['SLACK_SIGNING_SECRET'];
process.env['BETTER_AUTH_SECRET'] ??= 'slack-webhook-route-test-secret';
process.env['SLACK_SIGNING_SECRET'] = SIGNING_SECRET;

const { createWorkspace, resetDatabase } = await import('@orbit/core/test-support');
const { and, db, eq, schema } = await import('@orbit/db');
const { connectSlackChannel, ensureSlackIntegration } = await import('@orbit/services');
const { randomUUIDv7 } = await import('@orbit/shared/utils');
const warningSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
const scheduledTasks: (() => Promise<void>)[] = [];
mock.module('@/lib/integrations/slack-event-scheduler.ts', () => ({
  scheduleSlackEventProcessing: (task: () => Promise<void>) => {
    scheduledTasks.push(task);
  },
}));
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
  mapping: 'team' | 'workspace' | 'none' = 'team',
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
  const integrationId = await ensureSlackIntegration(db, {
    organizationId: seeded.organizationId,
    connectedById: seeded.adminUser.id,
    botToken,
    externalId: slackTeamId,
    scopes: ['chat:write', 'links:read', 'links:write'],
  });
  if (mapping !== 'none') {
    await connectSlackChannel(db, {
      organizationId: seeded.organizationId,
      integrationId,
      channelId: 'C-LINKS',
      channelName: 'links',
      teamId: mapping === 'team' ? seeded.teamId : null,
    });
  }
  return seeded;
}

function signedLinkShared(
  teamId: string,
  eventId = 'Ev-OAUTH-1',
  url = ISSUE_URL,
  channel = 'C-LINKS',
): Request {
  const raw = JSON.stringify({
    type: 'event_callback',
    event_id: eventId,
    team_id: teamId,
    event: {
      type: 'link_shared',
      channel,
      message_ts: '1712345678.000100',
      links: [{ domain: 'orbit.local', url }],
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

async function createIssueInAnotherTeam(
  target: Workspace,
  identifier: string,
  title: string,
): Promise<{ readonly teamId: string; readonly url: string }> {
  const suffix = randomUUIDv7();
  const teamId = `team_scope_${suffix}`;
  const stateId = `state_scope_${suffix}`;
  await db.insert(schema.team).values({
    id: teamId,
    organizationId: target.organizationId,
    name: `Scoped ${suffix}`,
    key: identifier.split('-')[0] ?? 'SCP',
  });
  await db.insert(schema.workflowState).values({
    id: stateId,
    organizationId: target.organizationId,
    teamId,
    name: 'Scoped backlog',
    category: 'unstarted',
    color: '#888888',
    position: 0,
  });
  await db.insert(schema.issue).values({
    id: `issue_scope_${suffix}`,
    organizationId: target.organizationId,
    teamId,
    number: Number.parseInt(identifier.split('-')[1] ?? '1', 10),
    identifier,
    title,
    stateId,
    creatorId: target.adminUser.id,
  });
  return { teamId, url: `https://orbit.local/issue/${identifier}` };
}

beforeEach(async () => {
  await resetDatabase();
  providerRequests.length = 0;
  providerErrorCode = null;
  providerResponder = null;
  scheduledTasks.length = 0;
  warningSpy.mockClear();
  errorSpy.mockClear();
  globalThis.fetch = providerFetch;
  workspace = await seedWorkspace('PrimarySlack', 'T-OAUTH', 'xoxb-primary', 'Primary issue');
  process.env['SLACK_ENABLED_ORGANIZATION_ID'] = workspace.organizationId;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  warningSpy.mockRestore();
  errorSpy.mockRestore();
  if (existingAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = existingAuthSecret;
  if (existingSigningSecret === undefined) delete process.env['SLACK_SIGNING_SECRET'];
  else process.env['SLACK_SIGNING_SECRET'] = existingSigningSecret;
  if (existingSlackOrganizationId === undefined)
    delete process.env['SLACK_ENABLED_ORGANIZATION_ID'];
  else process.env['SLACK_ENABLED_ORGANIZATION_ID'] = existingSlackOrganizationId;
});

describe('POST /api/webhooks/slack', () => {
  it('acknowledges a claimed event before deferred provider work', async () => {
    const response = await POST(signedLinkShared('T-OAUTH'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(scheduledTasks).toHaveLength(1);
    expect(providerRequests).toEqual([]);

    await scheduledTasks[0]?.();

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
    expect(JSON.stringify(request.body)).not.toContain('action_id');
  });

  it('does not read or unfurl an issue from an unmapped channel', async () => {
    await db.delete(schema.slackChannelSync);

    const response = await POST(signedLinkShared('T-OAUTH', 'Ev-UNMAPPED'));
    expect(response.status).toBe(200);
    expect(scheduledTasks).toHaveLength(1);

    await scheduledTasks[0]?.();

    expect(providerRequests).toEqual([]);
  });

  it('does not unfurl through a disabled channel mapping', async () => {
    await db.update(schema.slackChannelSync).set({ enabled: false });

    const response = await POST(signedLinkShared('T-OAUTH', 'Ev-DISABLED'));
    expect(response.status).toBe(200);
    expect(scheduledTasks).toHaveLength(1);

    await scheduledTasks[0]?.();

    expect(providerRequests).toEqual([]);
  });

  it('limits a mapped channel to its exact Orbit team', async () => {
    const otherIssue = await createIssueInAnotherTeam(workspace, 'DES-43', 'Other team issue');

    const response = await POST(signedLinkShared('T-OAUTH', 'Ev-TEAM-SCOPE', otherIssue.url));
    expect(response.status).toBe(200);
    await scheduledTasks[0]?.();

    expect(providerRequests).toEqual([]);
  });

  it('uses a null channel mapping as workspace-wide scope for the same organization', async () => {
    const otherIssue = await createIssueInAnotherTeam(workspace, 'DES-44', 'Workspace issue');
    await db.update(schema.slackChannelSync).set({ teamId: null });

    const response = await POST(signedLinkShared('T-OAUTH', 'Ev-WORKSPACE-SCOPE', otherIssue.url));
    expect(response.status).toBe(200);
    await scheduledTasks[0]?.();

    expect(providerRequests).toHaveLength(1);
    expect(JSON.stringify(providerRequests[0]?.body)).toContain('Workspace issue');
  });

  it('does not broaden a workspace mapping into another organization', async () => {
    const otherWorkspace = await seedWorkspace(
      'OtherSlack',
      'T-OTHER',
      'xoxb-other',
      'Other issue',
    );
    const otherIssue = await createIssueInAnotherTeam(otherWorkspace, 'SEC-77', 'Secret issue');
    await db
      .update(schema.slackChannelSync)
      .set({ teamId: null })
      .where(eq(schema.slackChannelSync.organizationId, workspace.organizationId));

    const response = await POST(signedLinkShared('T-OAUTH', 'Ev-ORG-SCOPE', otherIssue.url));
    expect(response.status).toBe(200);
    await scheduledTasks[0]?.();

    expect(providerRequests).toEqual([]);
  });

  it('uses the configured team id instead of a stale legacy external id', async () => {
    await db
      .update(schema.integration)
      .set({
        externalId: 'T-STALE',
        config: {
          scopes: ['chat:write', 'links:read', 'links:write'],
          slackTeamId: 'T-OAUTH',
        },
      })
      .where(eq(schema.integration.organizationId, workspace.organizationId));

    const staleResponse = await POST(signedLinkShared('T-STALE', 'Ev-STALE-TEAM'));
    expect(staleResponse.status).toBe(200);
    await scheduledTasks[0]?.();
    expect(providerRequests).toEqual([]);

    const currentResponse = await POST(signedLinkShared('T-OAUTH', 'Ev-CURRENT-TEAM'));
    expect(currentResponse.status).toBe(200);
    await scheduledTasks[1]?.();
    expect(providerRequests).toHaveLength(1);
  });

  it('acknowledges duplicate processing and processed deliveries without rescheduling', async () => {
    const first = await POST(signedLinkShared('T-OAUTH', 'Ev-REPLAY'));
    const processingReplay = await POST(signedLinkShared('T-OAUTH', 'Ev-REPLAY'));

    expect(first.status).toBe(200);
    expect(processingReplay.status).toBe(200);
    expect(await processingReplay.json()).toEqual({ ok: true });
    expect(scheduledTasks).toHaveLength(1);
    expect(providerRequests).toEqual([]);

    await scheduledTasks[0]?.();
    const processedReplay = await POST(signedLinkShared('T-OAUTH', 'Ev-REPLAY'));

    expect(processedReplay.status).toBe(200);
    expect(scheduledTasks).toHaveLength(1);
    expect(providerRequests).toHaveLength(1);
  });

  it('reclaims a failed Slack event and keeps failure logs fixed and safe', async () => {
    providerErrorCode = 'internal_error';
    const first = await POST(signedLinkShared('T-OAUTH', 'Ev-FAILED'));
    expect(first.status).toBe(200);
    await scheduledTasks[0]?.();
    const [failed] = await db
      .select({ status: schema.webhookDelivery.status })
      .from(schema.webhookDelivery);
    expect(failed).toEqual({ status: 'failed' });
    expect(errorSpy).toHaveBeenCalledWith('[orbit] slack unfurl processing failed');

    providerErrorCode = null;
    const replay = await POST(signedLinkShared('T-OAUTH', 'Ev-FAILED'));
    expect(replay.status).toBe(200);
    expect(scheduledTasks).toHaveLength(2);
    await scheduledTasks[1]?.();

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
    expect(scheduledTasks).toHaveLength(1);
    expect(providerRequests).toEqual([]);
  });

  it('prevents a late stale worker from overwriting a replacement claim', async () => {
    const first = await POST(signedLinkShared('T-OAUTH', 'Ev-CLAIM-RACE'));
    expect(first.status).toBe(200);
    await db
      .update(schema.webhookDelivery)
      .set({ claimedAt: new Date(Date.now() - 5 * 60_000) })
      .where(
        and(
          eq(schema.webhookDelivery.provider, 'slack'),
          eq(schema.webhookDelivery.deliveryId, 'Ev-CLAIM-RACE'),
        ),
      );

    const replacement = await POST(signedLinkShared('T-OAUTH', 'Ev-CLAIM-RACE'));
    expect(replacement.status).toBe(200);
    expect(scheduledTasks).toHaveLength(2);

    await scheduledTasks[1]?.();
    providerErrorCode = 'internal_error';
    await scheduledTasks[0]?.();

    const [delivery] = await db
      .select({ status: schema.webhookDelivery.status })
      .from(schema.webhookDelivery);
    expect(delivery).toEqual({ status: 'processed' });
    expect(providerRequests).toHaveLength(2);
  });
});
