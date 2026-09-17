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

    const deleteResponse = await DELETE();
    expect(deleteResponse.status).toBe(403);
  });

  it('refuses access for guest user on all endpoints and leaves database untouched', async () => {
    const addedGuest = await addMember(workspace, 'guest');
    signIn(addedGuest.user);

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
          apiKey: 'sk-secret-guest-attempt',
          enabled: true,
        }),
      }),
    );
    expect(postResponse.status).toBe(403);

    const deleteResponse = await DELETE();
    expect(deleteResponse.status).toBe(403);

    signIn(workspace.adminUser);
    const getAdminResponse = await GET();
    const status = (await getAdminResponse.json()) as { configured: boolean };
    expect(status.configured).toBe(false);
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

  it('rotates API key and updates configuration on an existing row via onConflictDoUpdate', async () => {
    const response = await POST(
      new Request('https://orbit.local/api/settings/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-5',
          apiKey: 'sk-ant-rotated-new-key',
          enabled: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      configured: boolean;
      enabled: boolean;
      kind: string;
      model: string;
      hasApiKey: boolean;
    };
    expect(body.configured).toBe(true);
    expect(body.kind).toBe('anthropic');
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.hasApiKey).toBe(true);
  });

  it('allows updating model without re-supplying the key', async () => {
    const response = await POST(
      new Request('https://orbit.local/api/settings/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-3-5-haiku-20241022',
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
    expect(body.model).toBe('claude-3-5-haiku-20241022');
  });

  it('rejects changing endpoint without re-supplying the key', async () => {
    const response = await POST(
      new Request('https://orbit.local/api/settings/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl: 'https://other-api.openai.com/v1',
          model: 'gpt-4o',
          enabled: true,
        }),
      }),
    );

    expect(response.status).toBe(422);
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
