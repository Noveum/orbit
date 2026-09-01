import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import {
  bindGithubInstallation,
  listGithubCatalogue,
  listGithubInstallations,
  replaceGithubRepositories,
} from '@orbit/services';
import type { SyncAction } from '@orbit/shared/events';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';

const SECRET = 'a-github-webhook-secret';
const existingWebhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];
const existingAuthSecret = process.env['BETTER_AUTH_SECRET'];
const existingSlackEnabled = process.env['SLACK_ENABLED'];
process.env['GITHUB_WEBHOOK_SECRET'] = SECRET;

const published: SyncAction[][] = [];
const core = await import('@orbit/core');
const services = await import('@orbit/services');
const notifications = await import('@orbit/services/notifications');
const slackCapability = await import('@/lib/integrations/slack-capability.ts');
const nextHeaders = await import('next/headers');
const realApplyGithubInstallationEvent = services.applyGithubInstallationEvent;
const realNotifyMany = notifications.notifyMany;
const dispatchSlackMessage = mock(
  (
    _database: Parameters<typeof services.dispatchSlackMessage>[0],
    _input: Parameters<typeof services.dispatchSlackMessage>[1],
  ) => Promise.resolve(0),
);
const deliverPendingSlackDms = mock(() => Promise.resolve(0));
const applyGithubInstallationEvent = mock(services.applyGithubInstallationEvent);
const notifyMany = mock(notifications.notifyMany);
let slackEnabledForTest = false;
const slackCapabilitySpy = spyOn(
  slackCapability,
  'slackIntegrationEnabledForOrganization',
).mockImplementation(() => slackEnabledForTest);
const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
notifyMany.mockImplementation(realNotifyMany);
mock.module('@orbit/core', () => ({
  ...core,
  deliverPendingSlackDms,
  publishDeltas: (actions: readonly SyncAction[]) => {
    published.push([...actions]);
    return Promise.resolve(undefined);
  },
}));
mock.module('@orbit/services', () => ({
  ...services,
  applyGithubInstallationEvent,
  dispatchSlackMessage,
}));
mock.module('@orbit/services/notifications', () => ({ ...notifications, notifyMany }));
mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

const { POST, claimDelivery, finalizeDelivery } = await import(
  '../../../../../src/app/api/webhooks/github/route.ts'
);

async function claimForTest(deliveryId: string) {
  const claim = await claimDelivery(deliveryId, 'pull_request');
  if (claim instanceof Response) throw new Error(`could not claim ${deliveryId}`);
  return claim;
}

async function reclaimDeliveryForTest(deliveryId: string) {
  await db
    .update(schema.webhookDelivery)
    .set({ claimedAt: new Date(Date.now() - 2 * 60 * 1000) })
    .where(
      and(
        eq(schema.webhookDelivery.provider, 'github'),
        eq(schema.webhookDelivery.deliveryId, deliveryId),
      ),
    );
  return await claimForTest(deliveryId);
}

function restoreSlackEnvironment(): void {
  if (existingAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = existingAuthSecret;
  if (existingSlackEnabled === undefined) delete process.env['SLACK_ENABLED'];
  else process.env['SLACK_ENABLED'] = existingSlackEnabled;
}

afterAll(() => {
  mock.module('@orbit/core', () => core);
  mock.module('@orbit/services', () => services);
  mock.module('@orbit/services/notifications', () => notifications);
  mock.module('next/headers', () => nextHeaders);
  slackCapabilitySpy.mockRestore();
  consoleErrorSpy.mockRestore();
  if (existingWebhookSecret === undefined) delete process.env['GITHUB_WEBHOOK_SECRET'];
  else process.env['GITHUB_WEBHOOK_SECRET'] = existingWebhookSecret;
  restoreSlackEnvironment();
});

const bodySchema = z.union([
  z.object({ ok: z.literal(true), actions: z.number(), ignored: z.string() }),
  z.object({ ok: z.literal(true), actions: z.number() }),
  z.object({ ok: z.literal(true), handled: z.boolean() }),
  z.object({ status: z.literal('duplicate') }),
  z.object({ status: z.literal('in_progress') }),
  z.object({ status: z.literal('unhandled'), event: z.string() }),
  z.object({ error: z.string() }),
]);

let workspace: Workspace;
let issueId: string;

async function seed(): Promise<void> {
  await resetDatabase();
  workspace = await createWorkspace('Hooked');
  const integrationId = `int_${randomUUIDv7()}`;
  await db.insert(schema.integration).values({
    id: integrationId,
    organizationId: workspace.organizationId,
    provider: 'github',
    externalId: 'install-42',
    connectedById: workspace.adminUser.id,
  });
  await db.insert(schema.githubInstallation).values({
    id: `ghi_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    installationId: 'install-42',
    integrationId,
    accountLogin: 'acme',
    accountId: '42',
    accountType: 'Organization',
    repositorySelection: 'all',
    status: 'active',
    connectedById: workspace.adminUser.id,
  });
  await db.insert(schema.githubRepositorySync).values({
    id: `repo_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    integrationId,
    teamId: workspace.teamId,
    repositoryId: '99',
    repositoryName: 'acme/web',
    installationId: 'install-42',
  });
  const todo = workspace.states.find((state) => state.category === 'unstarted');
  if (todo === undefined) throw new Error('the seeded team has no unstarted state');
  await db.update(schema.team).set({ key: 'ORB' }).where(eq(schema.team.id, workspace.teamId));
  issueId = `iss_${randomUUIDv7()}`;
  await db.insert(schema.issue).values({
    id: issueId,
    organizationId: workspace.organizationId,
    teamId: workspace.teamId,
    number: 3,
    identifier: 'ORB-3',
    title: 'Dashboard',
    stateId: todo.id,
    creatorId: workspace.adminUser.id,
  });
}

function pullRequestBody(
  headRef: string,
  state: 'open' | 'closed' = 'open',
  title = 'Rework dashboard',
  merged = false,
): string {
  return JSON.stringify({
    action: state === 'open' ? 'opened' : 'closed',
    pull_request: {
      number: 7,
      title,
      html_url: 'https://github.com/acme/web/pull/7',
      draft: false,
      merged,
      state,
      head: { ref: headRef },
      base: { ref: 'main' },
      user: { login: 'octocat', id: 500 },
    },
    repository: { id: 99, full_name: 'acme/web' },
    installation: { id: 'install-42' },
    sender: { login: 'octocat', id: 500 },
  });
}

function sign(raw: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

function request(raw: string, headers: Record<string, string | undefined>): Request {
  const built = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) built.set(key, value);
  }
  return new Request('http://localhost:3000/api/webhooks/github', {
    method: 'POST',
    body: raw,
    headers: built,
  });
}

function signed(raw: string, deliveryId: string, event = 'pull_request'): Request {
  return request(raw, {
    'x-hub-signature-256': sign(raw),
    'x-github-event': event,
    'x-github-delivery': deliveryId,
  });
}

async function deliveryRow(deliveryId: string) {
  const [row] = await db
    .select()
    .from(schema.webhookDelivery)
    .where(
      and(
        eq(schema.webhookDelivery.provider, 'github'),
        eq(schema.webhookDelivery.deliveryId, deliveryId),
      ),
    )
    .limit(1);
  return row;
}

async function linkCount(): Promise<number> {
  const rows = await db.select().from(schema.gitLink).where(eq(schema.gitLink.issueId, issueId));
  return rows.length;
}

beforeEach(async () => {
  restoreSlackEnvironment();
  published.length = 0;
  dispatchSlackMessage.mockClear();
  deliverPendingSlackDms.mockClear();
  applyGithubInstallationEvent.mockClear();
  applyGithubInstallationEvent.mockImplementation(realApplyGithubInstallationEvent);
  notifyMany.mockClear();
  notifyMany.mockImplementation(realNotifyMany);
  slackEnabledForTest = false;
  await seed();
});

describe('POST /api/webhooks/github', () => {
  it('rejects a payload whose signature does not match the secret', async () => {
    const raw = pullRequestBody('eng-3-dashboard');
    const response = await POST(
      request(raw, {
        'x-hub-signature-256': sign(raw, 'the-wrong-secret'),
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-bad-signature',
      }),
    );

    expect(response.status).toBe(401);
    expect(bodySchema.parse(await response.json())).toEqual({ error: 'invalid signature' });
    expect(await deliveryRow('delivery-bad-signature')).toBeUndefined();
    expect(await linkCount()).toBe(0);
  });

  it('rejects a payload with no signature header at all', async () => {
    const raw = pullRequestBody('eng-3-dashboard');
    const response = await POST(
      request(raw, { 'x-github-event': 'pull_request', 'x-github-delivery': 'delivery-none' }),
    );

    expect(response.status).toBe(401);
  });

  it('rejects a signed payload that carries no delivery id', async () => {
    const raw = pullRequestBody('eng-3-dashboard');
    const response = await POST(
      request(raw, { 'x-hub-signature-256': sign(raw), 'x-github-event': 'pull_request' }),
    );

    expect(response.status).toBe(400);
    expect(bodySchema.parse(await response.json())).toEqual({ error: 'missing delivery id' });
    expect(await linkCount()).toBe(0);
  });

  it('applies a first delivery, publishes its actions and marks the row processed', async () => {
    const raw = pullRequestBody('orb-3-dashboard');

    const response = await POST(signed(raw, 'delivery-first'));
    const payload = bodySchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, actions: expect.any(Number) });
    expect((await deliveryRow('delivery-first'))?.status).toBe('processed');
    expect(await linkCount()).toBe(1);
    expect(published.flat().some((action) => action.model === 'git_link')).toBe(true);
  });

  it('does not dispatch disabled Slack effects from a GitHub delivery', async () => {
    const raw = pullRequestBody('orb-3-dashboard', 'closed');

    const response = await POST(signed(raw, 'delivery-with-disabled-slack'));

    expect(response.status).toBe(200);
    expect(dispatchSlackMessage).not.toHaveBeenCalled();
  });

  it('persists enabled routing without synchronously contacting Slack', async () => {
    slackEnabledForTest = true;
    notifyMany.mockImplementationOnce(async () => ({
      actions: [],
      deduped: 0,
      email: [],
      notifications: [],
      slack: [],
      slackDm: [{ userId: 'user-1', notificationId: 'notification-1', sendAt: new Date() }],
    }));

    const personal = await POST(signed(pullRequestBody('orb-3-dashboard'), 'delivery-personal'));
    expect(personal.status).toBe(200);
    expect(dispatchSlackMessage).not.toHaveBeenCalled();
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();

    notifyMany.mockImplementationOnce(async () => ({
      actions: [],
      deduped: 0,
      email: [],
      notifications: [],
      slack: [{ userId: 'user-1', notificationId: 'notification-2' }],
      slackDm: [],
    }));
    const broadcast = await POST(
      signed(pullRequestBody('orb-3-dashboard', 'closed'), 'delivery-broadcast'),
    );
    expect(broadcast.status).toBe(200);
    expect(dispatchSlackMessage).not.toHaveBeenCalled();
  });

  it('persists shared Slack channel work without synchronous delivery', async () => {
    slackEnabledForTest = true;
    process.env['SLACK_ENABLED'] = 'true';
    const recipient = await addMember(workspace, 'member', { teamIds: [workspace.teamId] });
    await db
      .update(schema.issue)
      .set({ assigneeId: recipient.principal.userId })
      .where(eq(schema.issue.id, issueId));
    const integrationId = await services.ensureSlackIntegration(db, {
      organizationId: workspace.organizationId,
      connectedById: workspace.adminUser.id,
      botToken: 'xoxb-durable-channel',
      externalId: 'T-DURABLE-CHANNEL',
      scopes: ['chat:write'],
    });
    await services.connectSlackChannel(db, {
      organizationId: workspace.organizationId,
      integrationId,
      channelId: 'C-DURABLE-CHANNEL',
      channelName: 'durable-channel',
      teamId: workspace.teamId,
    });

    const response = await POST(
      signed(
        pullRequestBody('orb-3-dashboard', 'closed', 'Rework dashboard', true),
        'delivery-durable-channel',
      ),
    );
    const queued = await db
      .select({ id: schema.notificationDelivery.id })
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.channel, 'slack'));

    expect(response.status).toBe(200);
    expect(queued).toHaveLength(1);
    expect(dispatchSlackMessage).not.toHaveBeenCalled();
  });

  it('processes GitHub successfully when optional Slack credentials use an old key', async () => {
    slackEnabledForTest = true;
    process.env['SLACK_ENABLED'] = 'true';
    process.env['BETTER_AUTH_SECRET'] = 'github-slack-old-key';
    const integrationId = await services.ensureSlackIntegration(db, {
      organizationId: workspace.organizationId,
      connectedById: workspace.adminUser.id,
      botToken: 'xoxb-encrypted',
      externalId: 'T-OLD-KEY',
      scopes: ['chat:write'],
    });
    await services.connectSlackChannel(db, {
      organizationId: workspace.organizationId,
      integrationId,
      channelId: 'C-OLD-KEY',
      channelName: 'old-key',
      teamId: workspace.teamId,
    });
    process.env['BETTER_AUTH_SECRET'] = 'github-slack-rotated-key';

    const response = await POST(
      signed(pullRequestBody('orb-3-dashboard', 'closed'), 'delivery-old-slack-key'),
    );
    const queued = await db
      .select({ id: schema.notificationDelivery.id })
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.channel, 'slack'));

    expect(response.status).toBe(200);
    expect((await deliveryRow('delivery-old-slack-key'))?.status).toBe('processed');
    expect(queued).toHaveLength(1);
    expect(dispatchSlackMessage).not.toHaveBeenCalled();
  });

  it('answers a repeat of a processed delivery with duplicate and applies nothing twice', async () => {
    const raw = pullRequestBody('orb-3-dashboard');
    await POST(signed(raw, 'delivery-repeat'));
    expect(await linkCount()).toBe(1);
    expect(published.length).toBeGreaterThan(0);
    published.length = 0;

    const response = await POST(signed(raw, 'delivery-repeat'));

    expect(response.status).toBe(200);
    expect(bodySchema.parse(await response.json())).toEqual({ status: 'duplicate' });
    expect(await linkCount()).toBe(1);
    expect(published).toHaveLength(0);
  });

  it('lets only one request claim a delivery when the same webhook arrives concurrently', async () => {
    const raw = pullRequestBody('orb-3-dashboard');

    const responses = await Promise.all([
      POST(signed(raw, 'delivery-concurrent')),
      POST(signed(raw, 'delivery-concurrent')),
    ]);
    const payloads = await Promise.all(responses.map((response) => response.json()));

    expect(
      payloads.filter(
        (payload) => payload.status === 'duplicate' || payload.status === 'in_progress',
      ),
    ).toHaveLength(1);
    expect(payloads.filter((payload) => payload.ok === true)).toHaveLength(1);
    expect((await deliveryRow('delivery-concurrent'))?.status).toBe('processed');
    expect(await linkCount()).toBe(1);
  });

  it('reclaims a delivery left processing by a worker that stopped', async () => {
    const receivedAt = new Date(Date.now() - 10 * 60 * 1000);
    await db.insert(schema.webhookDelivery).values({
      id: randomUUIDv7(),
      provider: 'github',
      deliveryId: 'delivery-abandoned',
      event: 'pull_request',
      status: 'processing',
      claimedAt: new Date(Date.now() - 2 * 60 * 1000),
      createdAt: receivedAt,
    });

    const response = await POST(signed(pullRequestBody('orb-3-dashboard'), 'delivery-abandoned'));

    expect(response.status).toBe(200);
    expect(bodySchema.parse(await response.json())).not.toEqual({ status: 'duplicate' });
    const delivery = await deliveryRow('delivery-abandoned');
    expect(delivery?.status).toBe('processed');
    expect(delivery?.createdAt.getTime()).toBe(receivedAt.getTime());
    expect(await linkCount()).toBe(1);
  });

  it('answers an active claim with a retryable response', async () => {
    await db.insert(schema.webhookDelivery).values({
      id: randomUUIDv7(),
      provider: 'github',
      deliveryId: 'delivery-active',
      event: 'pull_request',
      status: 'processing',
      claimedAt: new Date(),
    });

    const response = await POST(signed(pullRequestBody('orb-3-dashboard'), 'delivery-active'));

    expect(response.status).toBe(409);
    expect(bodySchema.parse(await response.json())).toEqual({ status: 'in_progress' });
    expect(await linkCount()).toBe(0);
  });

  it('retries a delivery that previously failed instead of calling it a duplicate', async () => {
    const broken = '{ not json';
    const failed = await POST(signed(broken, 'delivery-retry'));
    expect(failed.status).toBe(400);
    expect((await deliveryRow('delivery-retry'))?.status).toBe('failed');

    const raw = pullRequestBody('orb-3-dashboard');

    const response = await POST(signed(raw, 'delivery-retry'));

    expect(response.status).toBe(200);
    expect(bodySchema.parse(await response.json())).not.toEqual({ status: 'duplicate' });
    expect((await deliveryRow('delivery-retry'))?.status).toBe('processed');
    expect(await linkCount()).toBe(1);
  });

  it('marks the row failed and answers 400 when the body is not json', async () => {
    const response = await POST(signed('}{', 'delivery-malformed'));

    expect(response.status).toBe(400);
    expect(bodySchema.parse(await response.json())).toEqual({ error: 'invalid json' });
    expect((await deliveryRow('delivery-malformed'))?.status).toBe('failed');
    expect(published).toHaveLength(0);
  });

  it('records the event name it was handed on the delivery row', async () => {
    const raw = pullRequestBody('orb-3-dashboard');
    await POST(signed(raw, 'delivery-named', 'pull_request_review'));

    expect((await deliveryRow('delivery-named'))?.event).toBe('pull_request_review');
  });

  it('rolls back ordinary effects after another worker reclaims its delivery', async () => {
    let currentClaimToken = '';
    notifyMany.mockImplementationOnce(async (database, input, options) => {
      currentClaimToken = (await reclaimDeliveryForTest('delivery-ordinary-claim-lost')).claimToken;
      return await realNotifyMany(database, input, options);
    });

    const response = await POST(
      signed(pullRequestBody('orb-3-dashboard', 'closed'), 'delivery-ordinary-claim-lost'),
    );

    const sources = await db.select().from(schema.notificationSourceEvent);
    const recipientEvents = await db.select().from(schema.notification);
    const providerWork = await db.select().from(schema.notificationDelivery);

    expect(response.status).toBe(500);
    expect(await linkCount()).toBe(0);
    expect(sources).toEqual([]);
    expect(recipientEvents).toEqual([]);
    expect(providerWork).toEqual([]);
    expect(published).toHaveLength(0);
    expect((await deliveryRow('delivery-ordinary-claim-lost'))?.status).toBe('processing');
    expect((await deliveryRow('delivery-ordinary-claim-lost'))?.claimToken).toBe(currentClaimToken);
  });
});

describe('GitHub webhook delivery ownership', () => {
  it('gives a fresh claimant a durable ownership token', async () => {
    const claim = await claimForTest('delivery-owner-fresh');

    expect(claim.id).toEqual(expect.any(String));
    expect(claim.claimToken).toEqual(expect.any(String));
    expect((await deliveryRow('delivery-owner-fresh'))?.claimToken).toBe(claim.claimToken);
  });

  it('rotates the ownership token when reclaiming an expired delivery', async () => {
    const firstClaim = await claimForTest('delivery-owner-reclaimed');
    await db
      .update(schema.webhookDelivery)
      .set({ claimedAt: new Date(Date.now() - 2 * 60 * 1000) })
      .where(eq(schema.webhookDelivery.id, firstClaim.id));

    const reclaimed = await claimForTest('delivery-owner-reclaimed');

    expect(reclaimed.id).toBe(firstClaim.id);
    expect(reclaimed.claimToken).not.toBe(firstClaim.claimToken);
    expect((await deliveryRow('delivery-owner-reclaimed'))?.claimToken).toBe(reclaimed.claimToken);
  });

  it('does not let a stale claimant finalize a reclaimed delivery', async () => {
    const staleClaim = await claimForTest('delivery-owner-stale');
    await db
      .update(schema.webhookDelivery)
      .set({ claimedAt: new Date(Date.now() - 2 * 60 * 1000) })
      .where(eq(schema.webhookDelivery.id, staleClaim.id));
    const currentClaim = await claimForTest('delivery-owner-stale');

    const finalized = await finalizeDelivery(staleClaim, {
      status: 'failed',
      error: null,
    });

    expect(finalized).toBe(false);
    expect((await deliveryRow('delivery-owner-stale'))?.status).toBe('processing');
    expect((await deliveryRow('delivery-owner-stale'))?.claimToken).toBe(currentClaim.claimToken);
  });

  it('lets the current claimant finalize a delivery only once', async () => {
    const claim = await claimForTest('delivery-owner-current');
    const first = await finalizeDelivery(claim, { status: 'processed', error: null });
    const second = await finalizeDelivery(claim, { status: 'processed', error: null });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect((await deliveryRow('delivery-owner-current'))?.status).toBe('processed');
  });
});

const CONNECTED_INSTALLATION = '151887625';

async function connectInstallation(): Promise<void> {
  const installation = await db.transaction(async (tx) =>
    bindGithubInstallation(tx, {
      organizationId: workspace.organizationId,
      connectedById: workspace.adminUser.id,
      account: {
        installationId: CONNECTED_INSTALLATION,
        accountLogin: 'Noveum',
        accountId: '192082188',
        accountType: 'Organization',
        repositorySelection: 'all',
        suspended: false,
      },
    }),
  );
  await db.transaction(async (tx) =>
    replaceGithubRepositories(tx, {
      installation,
      repositories: [
        {
          repositoryId: '884762793',
          repositoryName: 'Noveum/ai-gateway',
          name: 'ai-gateway',
          ownerLogin: 'Noveum',
          private: false,
          archived: false,
          defaultBranch: 'main',
          htmlUrl: 'https://github.com/Noveum/ai-gateway',
        },
      ],
    }),
  );
}

function installationEnvelope(action: string): string {
  return JSON.stringify({
    action,
    installation: {
      id: Number(CONNECTED_INSTALLATION),
      account: { login: 'Noveum', id: 192082188, type: 'Organization' },
      repository_selection: 'all',
    },
  });
}

describe('POST /api/webhooks/github, installation events', () => {
  it('rejects an unsigned installation delete before it can remove anything', async () => {
    await connectInstallation();
    const raw = installationEnvelope('deleted');

    const response = await POST(
      request(raw, {
        'x-hub-signature-256': sign(raw, 'the-wrong-secret'),
        'x-github-event': 'installation',
        'x-github-delivery': 'install-forged',
      }),
    );

    expect(response.status).toBe(401);
    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(2);
  });

  it('removes the installation and its repositories when GitHub says it was deleted', async () => {
    await connectInstallation();
    const raw = installationEnvelope('deleted');

    const response = await POST(signed(raw, 'install-deleted', 'installation'));

    expect(response.status).toBe(200);
    expect(bodySchema.parse(await response.json())).toEqual({ ok: true, handled: true });
    const installations = await listGithubInstallations(db, workspace.organizationId);
    expect(installations.map((row) => row.installationId)).toEqual(['install-42']);
    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(0);
    expect((await deliveryRow('install-deleted'))?.status).toBe('processed');
  });

  it('rolls back installation effects after another worker reclaims its delivery', async () => {
    await connectInstallation();
    let currentClaimToken = '';
    applyGithubInstallationEvent.mockImplementationOnce(async (database, input) => {
      const outcome = await realApplyGithubInstallationEvent(database, input);
      currentClaimToken = (await reclaimDeliveryForTest('install-claim-lost')).claimToken;
      return outcome;
    });

    const response = await POST(
      signed(installationEnvelope('deleted'), 'install-claim-lost', 'installation'),
    );

    expect(response.status).toBe(500);
    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(2);
    expect((await deliveryRow('install-claim-lost'))?.status).toBe('processing');
    expect((await deliveryRow('install-claim-lost'))?.claimToken).toBe(currentClaimToken);
  });

  it('treats a redelivered installation delete as a duplicate', async () => {
    await connectInstallation();
    const raw = installationEnvelope('deleted');
    await POST(signed(raw, 'install-repeat', 'installation'));

    const response = await POST(signed(raw, 'install-repeat', 'installation'));

    expect(bodySchema.parse(await response.json())).toEqual({ status: 'duplicate' });
  });

  it('suspends the installation without unbinding it', async () => {
    await connectInstallation();

    await POST(signed(installationEnvelope('suspend'), 'install-suspend', 'installation'));

    const rows = await listGithubInstallations(db, workspace.organizationId);
    expect(rows.find((row) => row.installationId === CONNECTED_INSTALLATION)?.status).toBe(
      'suspended',
    );
  });

  it('unsuspends it again', async () => {
    await connectInstallation();
    await POST(signed(installationEnvelope('suspend'), 'install-suspend-2', 'installation'));

    await POST(signed(installationEnvelope('unsuspend'), 'install-unsuspend', 'installation'));

    const rows = await listGithubInstallations(db, workspace.organizationId);
    expect(rows.find((row) => row.installationId === CONNECTED_INSTALLATION)?.status).toBe(
      'active',
    );
  });

  it('adds a repository granted on GitHub to the catalogue', async () => {
    await connectInstallation();
    const raw = JSON.stringify({
      action: 'added',
      installation: { id: Number(CONNECTED_INSTALLATION) },
      repository_selection: 'selected',
      repositories_added: [
        {
          id: 900712888,
          name: 'magic-experiments',
          full_name: 'Noveum/magic-experiments',
          private: true,
        },
      ],
      repositories_removed: [],
    });

    await POST(signed(raw, 'repos-added', 'installation_repositories'));

    const catalogue = await listGithubCatalogue(db, workspace.organizationId);
    expect(catalogue.map((entry) => entry.fullName).sort()).toEqual([
      'Noveum/ai-gateway',
      'Noveum/magic-experiments',
    ]);
    expect(catalogue.find((entry) => entry.fullName === 'Noveum/magic-experiments')?.private).toBe(
      true,
    );
  });

  it('removes a repository revoked on GitHub from the catalogue', async () => {
    await connectInstallation();
    const raw = JSON.stringify({
      action: 'removed',
      installation: { id: Number(CONNECTED_INSTALLATION) },
      repositories_added: [],
      repositories_removed: [
        { id: 884762793, name: 'ai-gateway', full_name: 'Noveum/ai-gateway', private: false },
      ],
    });

    await POST(signed(raw, 'repos-removed', 'installation_repositories'));

    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(0);
  });

  it('follows a repository rename', async () => {
    await connectInstallation();
    const installation = (await listGithubInstallations(db, workspace.organizationId)).find(
      (entry) => entry.installationId === CONNECTED_INSTALLATION,
    );
    if (installation === undefined) throw new Error('the connected installation is missing');
    const repositorySyncId = `repo_${randomUUIDv7()}`;
    const pullRequestId = `pull_${randomUUIDv7()}`;
    await db.insert(schema.githubRepositorySync).values({
      id: repositorySyncId,
      organizationId: workspace.organizationId,
      integrationId: installation.integrationId,
      teamId: workspace.teamId,
      repositoryId: '884762793',
      repositoryName: 'Noveum/ai-gateway',
      installationId: CONNECTED_INSTALLATION,
    });
    await db.insert(schema.githubPullRequest).values({
      id: pullRequestId,
      organizationId: workspace.organizationId,
      repositorySyncId,
      repositoryId: '884762793',
      repositoryName: 'Noveum/ai-gateway',
      number: 17,
      url: 'https://github.com/Noveum/ai-gateway/pull/17',
    });
    const raw = JSON.stringify({
      action: 'renamed',
      repository: {
        id: 884762793,
        name: 'gateway',
        full_name: 'Noveum/gateway',
        private: false,
        archived: false,
        default_branch: 'main',
        html_url: 'https://github.com/Noveum/gateway',
        owner: { login: 'Noveum' },
      },
      installation: { id: Number(CONNECTED_INSTALLATION) },
    });

    await POST(signed(raw, 'repo-renamed', 'repository'));

    const catalogue = await listGithubCatalogue(db, workspace.organizationId);
    expect(catalogue.map((entry) => entry.fullName)).toEqual(['Noveum/gateway']);
    const [pullRequest] = await db
      .select({ repositoryName: schema.githubPullRequest.repositoryName })
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.id, pullRequestId));
    expect(pullRequest?.repositoryName).toBe('Noveum/gateway');
  });

  it('publishes no realtime action for an installation event, so private names stay put', async () => {
    await connectInstallation();

    await POST(signed(installationEnvelope('suspend'), 'install-quiet', 'installation'));

    expect(published.flat()).toHaveLength(0);
  });
});

describe('telling a delivery that landed from one that was dropped', () => {
  it('records why a delivery for an unconnected repository changed nothing', async () => {
    const raw = JSON.stringify({
      action: 'opened',
      pull_request: {
        number: 7,
        title: 'Rework dashboard',
        html_url: 'https://github.com/nobody/repo/pull/7',
        draft: false,
        merged: false,
        state: 'open',
        head: { ref: 'orb-3-dashboard' },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 500 },
      },
      repository: { id: 424242, full_name: 'nobody/repo' },
      sender: { login: 'octocat', id: 500 },
    });

    const response = await POST(signed(raw, 'delivery-unconnected'));

    expect(response.status).toBe(200);
    const row = await deliveryRow('delivery-unconnected');
    expect(row?.status).toBe('ignored');
    expect(row?.error).toBe('repository_not_connected');
  });

  it('processes a branch that names no issue into the first-class mirror', async () => {
    const response = await POST(signed(pullRequestBody('chore/tidy-up'), 'delivery-nomatch'));

    expect(response.status).toBe(200);
    const row = await deliveryRow('delivery-nomatch');
    expect(row?.status).toBe('processed');
    expect(row?.error).toBeNull();
  });

  it('still marks a delivery that did the work as processed, with no reason', async () => {
    const response = await POST(signed(pullRequestBody('orb-3-dashboard'), 'delivery-landed'));

    expect(response.status).toBe(200);
    const row = await deliveryRow('delivery-landed');
    expect(row?.status).toBe('processed');
    expect(row?.error).toBeNull();
  });
});

describe('events that reach no handler', () => {
  const NEVER_HANDLED = [
    'workflow_job',
    'repository_dispatch',
    'issues',
    'push',
    'sub_issues',
    'create',
    'delete',
  ];

  it('accepts them without writing a delivery row', async () => {
    for (const [at, event] of NEVER_HANDLED.entries()) {
      const deliveryId = `delivery-unhandled-${at}`;
      const response = await POST(signed('{}', deliveryId, event));

      expect(response.status).toBe(200);
      expect(await deliveryRow(deliveryId)).toBeUndefined();
    }
  });

  it('still refuses one whose signature does not check out', async () => {
    const raw = '{}';
    const response = await POST(
      request(raw, {
        'x-hub-signature-256': sign(raw, 'the-wrong-secret'),
        'x-github-event': 'workflow_job',
        'x-github-delivery': 'delivery-unhandled-forged',
      }),
    );

    expect(response.status).toBe(401);
  });

  it('keeps recording every event that does reach a handler', async () => {
    for (const [at, event] of ['pull_request', 'pull_request_review', 'check_suite'].entries()) {
      const deliveryId = `delivery-handled-${at}`;
      await POST(signed(pullRequestBody('orb-3-dashboard'), deliveryId, event));

      expect(await deliveryRow(deliveryId)).toBeDefined();
    }
  });
});

describe('attributing a delivery to the workspace it belongs to', () => {
  async function bindInstallation(): Promise<void> {
    const [row] = await db
      .select({ id: schema.integration.id })
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId))
      .limit(1);
    await db.insert(schema.githubInstallation).values({
      id: `ghi_${randomUUIDv7()}`,
      organizationId: workspace.organizationId,
      installationId: 'inst-42',
      integrationId: row?.id ?? '',
      accountLogin: 'acme',
      accountId: '1',
      accountType: 'Organization',
      repositorySelection: 'all',
      status: 'active',
      connectedById: workspace.adminUser.id,
    });
  }

  it('stamps the workspace behind the installation, even when the repository is unknown', async () => {
    await bindInstallation();
    const raw = JSON.stringify({
      action: 'opened',
      pull_request: {
        number: 7,
        title: 'Rework dashboard',
        html_url: 'https://github.com/nobody/repo/pull/7',
        draft: false,
        merged: false,
        state: 'open',
        head: { ref: 'orb-3-dashboard' },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 500 },
      },
      repository: { id: 424242, full_name: 'nobody/repo' },
      installation: { id: 'inst-42' },
      sender: { login: 'octocat', id: 500 },
    });

    await POST(signed(raw, 'delivery-attributed'));

    const row = await deliveryRow('delivery-attributed');
    expect(row?.organizationId).toBe(workspace.organizationId);
    expect(row?.status).toBe('ignored');
    expect(row?.error).toBe('repository_not_connected');
  });

  it('does not route a known repository payload from an installation Orbit does not own', async () => {
    const payload = JSON.parse(pullRequestBody('orb-3-dashboard')) as Record<string, unknown>;
    payload['installation'] = { id: 'inst-belongs-elsewhere' };

    const response = await POST(signed(JSON.stringify(payload), 'delivery-wrong-installation'));

    expect(response.status).toBe(200);
    expect(await linkCount()).toBe(0);
    const row = await deliveryRow('delivery-wrong-installation');
    expect(row?.organizationId).toBeNull();
    expect(row?.error).toBe('repository_not_connected');
  });

  it('leaves a delivery unattributed when no installation here owns it', async () => {
    const raw = JSON.stringify({
      action: 'opened',
      pull_request: {
        number: 7,
        title: 'Rework dashboard',
        html_url: 'https://github.com/other/repo/pull/7',
        draft: false,
        merged: false,
        state: 'open',
        head: { ref: 'orb-3-dashboard' },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 500 },
      },
      repository: { id: 999999, full_name: 'other/repo' },
      installation: { id: 'inst-belongs-elsewhere' },
      sender: { login: 'octocat', id: 500 },
    });

    await POST(signed(raw, 'delivery-foreign'));

    expect((await deliveryRow('delivery-foreign'))?.organizationId).toBeNull();
  });
});

describe('the whole path from a delivery to the pulls page', () => {
  it('turns a branch naming an issue into a pull request the page can show', async () => {
    const { loadPullRequests } = await import('../../../../../src/features/pulls/data.ts');

    const before = await loadPullRequests(workspace.admin);
    expect(before).toHaveLength(0);

    const response = await POST(signed(pullRequestBody('orb-3-dashboard'), 'delivery-end-to-end'));
    expect(response.status).toBe(200);
    expect((await deliveryRow('delivery-end-to-end'))?.status).toBe('processed');

    const after = await loadPullRequests(workspace.admin);
    expect(after).toHaveLength(1);
    expect(after[0]?.linkedIssues[0]?.identifier).toBe('ORB-3');
    expect(after[0]?.state).toBe('open');
  });

  it('shows a merged pull request as merged, which is the state people look for', async () => {
    const { loadPullRequests } = await import('../../../../../src/features/pulls/data.ts');

    await POST(signed(pullRequestBody('orb-3-dashboard'), 'delivery-open'));
    const merged = JSON.stringify({
      action: 'closed',
      pull_request: {
        number: 7,
        title: 'Rework dashboard',
        html_url: 'https://github.com/acme/web/pull/7',
        draft: false,
        merged: true,
        state: 'closed',
        head: { ref: 'orb-3-dashboard' },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 500 },
      },
      repository: { id: 99, full_name: 'acme/web' },
      installation: { id: 'install-42' },
      sender: { login: 'octocat', id: 500 },
    });

    await POST(signed(merged, 'delivery-merged'));

    const rows = await loadPullRequests(workspace.admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('merged');
    expect(rows[0]?.merged).toBe(true);
  });

  it('shows a pull request that names no Orbit issue as unlinked', async () => {
    const { loadPullRequests } = await import('../../../../../src/features/pulls/data.ts');

    await POST(signed(pullRequestBody('chore/tidy-up'), 'delivery-unnamed'));

    const pulls = await loadPullRequests(workspace.admin);
    expect(pulls).toHaveLength(1);
    expect(pulls[0]?.linkedIssues).toHaveLength(0);
    const row = await deliveryRow('delivery-unnamed');
    expect(row?.status).toBe('processed');
    expect(row?.error).toBeNull();
  });
});
