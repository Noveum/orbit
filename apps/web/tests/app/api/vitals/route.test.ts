import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { z } from 'zod';
import { mockSession } from '../../../../tests-support.ts';

interface Caller {
  readonly userId: string;
  readonly organizationId: string;
}

let caller: Caller = { userId: '', organizationId: '' };

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

mockSession(() => ({
  user: { id: caller.userId, name: 'Somebody', email: 'somebody@orbit.test' },
  session: { activeOrganizationId: caller.organizationId },
}));

const { GET, POST } = await import('../../../../src/app/api/vitals/route.ts');

afterAll(() => {
  mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
});

const summarySchema = z.object({
  days: z.number(),
  rows: z.array(
    z.object({
      route: z.string(),
      metric: z.string(),
      interactionType: z.string().nullable(),
      samples: z.number(),
      p75: z.number(),
      worst: z.number(),
    }),
  ),
});

let workspace: Workspace;

function report(overrides: Record<string, unknown> = {}) {
  return {
    route: '/my-issues',
    metric: 'INP',
    value: 84,
    rating: 'good',
    navigationType: 'navigate',
    interactionType: 'keyboard',
    ...overrides,
  };
}

function post(vitals: readonly unknown[]): Request {
  return new Request('http://localhost:3000/api/vitals', {
    method: 'POST',
    body: JSON.stringify({ vitals }),
    headers: { 'content-type': 'application/json' },
  });
}

async function recorded() {
  return await db
    .select()
    .from(schema.webVital)
    .where(eq(schema.webVital.organizationId, workspace.organizationId));
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Measured');
  caller = {
    userId: workspace.admin.userId,
    organizationId: workspace.organizationId,
  };
});

describe('POST /api/vitals', () => {
  it('records a report against the person and workspace that sent it', async () => {
    const response = await POST(post([report()]));
    expect(response.status).toBe(200);

    const rows = await recorded();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      route: '/my-issues',
      metric: 'INP',
      rating: 'good',
      interactionType: 'keyboard',
      userId: workspace.admin.userId,
    });
  });

  it('takes a batch, because the reporter flushes several at once', async () => {
    const response = await POST(
      post([report(), report({ metric: 'LCP', value: 1200 }), report({ metric: 'CLS', value: 0 })]),
    );

    expect(response.status).toBe(200);
    expect(await recorded()).toHaveLength(3);
  });

  it('refuses a metric outside the four it tracks', async () => {
    const response = await POST(post([report({ metric: 'FID' })]));

    expect(response.status).toBe(422);
    expect(await recorded()).toHaveLength(0);
  });

  it('refuses a value that could not be a real measurement', async () => {
    const response = await POST(post([report({ value: -4 })]));

    expect(response.status).toBe(422);
    expect(await recorded()).toHaveLength(0);
  });

  it('refuses a batch large enough to be an attempt at flooding the table', async () => {
    const response = await POST(post(Array.from({ length: 40 }, () => report())));

    expect(response.status).toBe(422);
    expect(await recorded()).toHaveLength(0);
  });

  it('refuses a caller with no session', async () => {
    caller = { userId: '', organizationId: '' };
    const response = await POST(post([report()]));

    expect(response.status).toBe(401);
  });
});

describe('GET /api/vitals', () => {
  async function summarise(url = 'http://localhost:3000/api/vitals') {
    const response = await GET(new Request(url));
    return { status: response.status, body: await response.json() };
  }

  it('reports a p75 per route and metric', async () => {
    await POST(
      post([
        report({ value: 40 }),
        report({ value: 60 }),
        report({ value: 80 }),
        report({ value: 400 }),
      ]),
    );

    const { status, body } = await summarise();
    expect(status).toBe(200);

    const parsed = summarySchema.parse(body);
    const inp = parsed.rows.find((row) => row.metric === 'INP');
    expect(inp?.samples).toBe(4);
    expect(inp?.worst).toBe(400);
    expect(inp?.p75).toBeGreaterThanOrEqual(80);
  });

  it('keeps one workspace out of another workspace numbers', async () => {
    await POST(post([report()]));

    const other = await createWorkspace('Elsewhere');
    caller = { userId: other.admin.userId, organizationId: other.organizationId };

    const { body } = await summarise();
    expect(summarySchema.parse(body).rows).toHaveLength(0);
  });

  it('refuses somebody who does not run the workspace', async () => {
    const { principal } = await addMember(workspace, 'member');
    caller = { userId: principal.userId, organizationId: workspace.organizationId };

    const { status } = await summarise();
    expect(status).toBe(403);
  });
});
