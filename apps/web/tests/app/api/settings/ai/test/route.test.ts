import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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
const { POST: SAVE_POST } = await import('../../../../../../src/app/api/settings/ai/route.ts');

function signIn(user: Workspace['adminUser']): void {
  session = { user, session: { activeOrganizationId: workspace.organizationId } };
}

const originalAllowPrivate = process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];
let baseUrl = '';
let capturedAuth = '';
let requests = 0;
let providerStatus = 200;
let providerBody = JSON.stringify({ choices: [{ message: { content: 'pong' } }] });
const provider = http.createServer((request, response) => {
  requests += 1;
  capturedAuth = String(request.headers.authorization);
  request.resume();
  response.writeHead(providerStatus, { 'content-type': 'application/json' });
  response.end(providerBody);
});

beforeAll(async () => {
  process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
  await resetDatabase();
  workspace = await createWorkspace('AiTestRoute');
  const added = await addMember(workspace, 'member');
  memberUser = added.user;
});

beforeEach(() => {
  signIn(workspace.adminUser);
  capturedAuth = '';
  requests = 0;
  providerStatus = 200;
  providerBody = JSON.stringify({ choices: [{ message: { content: 'pong' } }] });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    provider.close((error) => (error ? reject(error) : resolve()));
  });
  if (originalAllowPrivate === undefined) delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];
  else process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = originalAllowPrivate;
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
          baseUrl,
          model: 'gpt-4o-mini',
          apiKey: 'sk-test',
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('tests connection successfully and returns model ping response with explicit key', async () => {
    const response = await POST(
      new Request('https://orbit.local/api/settings/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl,
          model: 'gpt-4o-mini',
          apiKey: 'sk-test-valid',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; message: string; latencyMs: number };
    expect(body.ok).toBe(true);
    expect(body.message).toBe('pong');
    expect(capturedAuth).toBe('Bearer sk-test-valid');
  });

  it('tests connection using stored credentials when no key is supplied', async () => {
    await SAVE_POST(
      new Request('https://orbit.local/api/settings/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl,
          model: 'gpt-4o-mini',
          apiKey: 'sk-saved-stored-key',
          enabled: true,
        }),
      }),
    );

    const response = await POST(
      new Request('https://orbit.local/api/settings/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl,
          model: 'gpt-4o-mini',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toBe('pong');
    expect(capturedAuth).toBe('Bearer sk-saved-stored-key');
  });

  it('handles connection failure without leaking the API key and asserts ok is false', async () => {
    providerStatus = 401;
    providerBody = 'Unauthorized: bad credentials sk-secret-must-not-leak';

    const response = await POST(
      new Request('https://orbit.local/api/settings/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'openai-compatible',
          baseUrl,
          model: 'gpt-4o-mini',
          apiKey: 'sk-secret-must-not-leak',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Failed to connect to the AI provider endpoint.');
    expect(JSON.stringify(body)).not.toContain('sk-secret-must-not-leak');

    expect(requests).toBe(1);
    expect(capturedAuth).toBe('Bearer sk-secret-must-not-leak');
  });

  it('refuses test without a key when base URL or kind has changed and makes no outbound fetch call', async () => {
    const response = await POST(
      new Request('https://orbit.local/api/settings/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-5',
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(requests).toBe(0);
  });
});
