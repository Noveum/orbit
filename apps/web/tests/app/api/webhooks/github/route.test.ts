import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';

const SECRET = 'a-github-webhook-secret';
process.env['GITHUB_WEBHOOK_SECRET'] = SECRET;

const published: SyncAction[][] = [];
const core = await import('@orbit/core');
mock.module('@orbit/core', () => ({
  ...core,
  publishDeltas: (actions: readonly SyncAction[]) => {
    published.push([...actions]);
    return Promise.resolve(undefined);
  },
}));

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

const { POST } = await import('../../../../../src/app/api/webhooks/github/route.ts');

afterAll(() => {
  mock.module('@orbit/core', () => core);
});

const bodySchema = z.union([
  z.object({ ok: z.literal(true), actions: z.number() }),
  z.object({ status: z.literal('duplicate') }),
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
  await db.insert(schema.githubRepositorySync).values({
    id: `repo_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    integrationId,
    teamId: workspace.teamId,
    repositoryId: '99',
    repositoryName: 'acme/web',
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

function pullRequestBody(headRef: string): string {
  return JSON.stringify({
    action: 'opened',
    pull_request: {
      number: 7,
      title: 'Rework dashboard',
      html_url: 'https://github.com/acme/web/pull/7',
      draft: false,
      merged: false,
      state: 'open',
      head: { ref: headRef },
      base: { ref: 'main' },
      user: { login: 'octocat', id: 500 },
    },
    repository: { id: 99, full_name: 'acme/web' },
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
  published.length = 0;
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
});
