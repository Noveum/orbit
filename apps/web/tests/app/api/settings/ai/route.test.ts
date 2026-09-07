import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { Workspace } from '@orbit/core/test-support';

process.env['BETTER_AUTH_SECRET'] ??= 'ai-settings-route-test-secret';

const { addMember, createWorkspace, resetDatabase } = await import('@orbit/core/test-support');
const { mockSession } = await import('../../../../../tests-support.ts');

interface Session {
  readonly user: { id: string; name: string; email: string };
  readonly session: { activeOrganizationId: string };
}

let session: Session | null = null;
let workspace: Workspace;
let memberUser: Workspace['adminUser'];

mockSession(() => session);

const { DELETE, GET, POST } = await import('../../../../../src/app/api/settings/ai/route.ts');

function signIn(user: Workspace['adminUser']): void {
  session = { user, session: { activeOrganizationId: workspace.organizationId } };
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('AiSettings');
  const added = await addMember(workspace, 'member');
  memberUser = added.user;
});

beforeEach(() => {
  signIn(workspace.adminUser);
});

describe('AI provider settings API', () => {
  it('returns unconfigured default state initially', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      configured: boolean;
      enabled: boolean;
      hasApiKey: boolean;
      usage: { totalCalls: number };
    };
    expect(body.configured).toBe(false);
    expect(body.enabled).toBe(false);
    expect(body.hasApiKey).toBe(false);
    expect(body.usage.totalCalls).toBe(0);
  });

  it('rejects access for non-admin members', async () => {
    signIn(memberUser);

    const getResponse = await GET();
    expect(getResponse.status).toBe(403);

    const postResponse = await POST(
      new Request('https://orbit.local/api/settings/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-secret-test-key',
          enabled: true,
        }),
      }),
    );
    expect(postResponse.status).toBe(403);
  });

  it('saves provider configuration with encrypted key and without returning plaintext key', async () => {
    const response = await POST(
      new Request('https://orbit.local/api/settings/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-super-secret-must-not-leak',
          enabled: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).not.toContain('sk-super-secret-must-not-leak');

    const body = JSON.parse(bodyText) as {
      configured: boolean;
      enabled: boolean;
      hasApiKey: boolean;
      kind: string;
      model: string;
    };
    expect(body.configured).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.hasApiKey).toBe(true);
    expect(body.kind).toBe('openai-compatible');
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('allows updating model without re-supplying the key', async () => {
    const response = await POST(
      new Request('https://orbit.local/api/settings/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          enabled: false,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      configured: boolean;
      enabled: boolean;
      hasApiKey: boolean;
      model: string;
    };
    expect(body.configured).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.hasApiKey).toBe(true);
    expect(body.model).toBe('gpt-4o');
  });

  it('disconnects and removes provider configuration', async () => {
    const deleteResponse = await DELETE();
    expect(deleteResponse.status).toBe(200);

    const getResponse = await GET();
    const body = (await getResponse.json()) as { configured: boolean; hasApiKey: boolean };
    expect(body.configured).toBe(false);
    expect(body.hasApiKey).toBe(false);
  });
});
