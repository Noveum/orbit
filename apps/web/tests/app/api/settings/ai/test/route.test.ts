import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { Workspace } from '@orbit/core/test-support';

process.env['BETTER_AUTH_SECRET'] ??= 'ai-test-route-test-secret';

const { addMember, createWorkspace, resetDatabase } = await import('@orbit/core/test-support');
const { mockSession } = await import('../../../../../../tests-support.ts');

interface Session {
  readonly user: { id: string; name: string; email: string };
  readonly session: { activeOrganizationId: string };
}

let session: Session | null = null;
let workspace: Workspace;
let memberUser: Workspace['adminUser'];

mockSession(() => session);

const { POST } = await import('../../../../../../src/app/api/settings/ai/test/route.ts');

function signIn(user: Workspace['adminUser']): void {
  session = { user, session: { activeOrganizationId: workspace.organizationId } };
}

const originalFetch = globalThis.fetch;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('AiTestRoute');
  const added = await addMember(workspace, 'member');
  memberUser = added.user;
});

beforeEach(() => {
  signIn(workspace.adminUser);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('AI test connection API', () => {
  it('rejects access for non-admin members', async () => {
    signIn(memberUser);

    const response = await POST(
      new Request('https://orbit.local/api/settings/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-test',
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('tests connection successfully and returns model ping response', async () => {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'pong' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    const response = await POST(
      new Request('https://orbit.local/api/settings/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-test-valid',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; message: string; latencyMs: number };
    expect(body.ok).toBe(true);
    expect(body.message).toBe('pong');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('handles connection failure without leaking the API key', async () => {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response('Unauthorized: bad credentials sk-secret-must-not-leak', { status: 401 }),
      );
    }) as unknown as typeof fetch;

    const response = await POST(
      new Request('https://orbit.local/api/settings/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-secret-must-not-leak',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('sk-secret-must-not-leak');
  });
});
