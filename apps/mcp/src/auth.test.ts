import { createApiKey, verifyApiKey } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import { DomainError } from '@orbit/shared/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HEALTH_PATH, MCP_PATH, type McpHttpServer } from './server.ts';
import { createWorkspace, resetDatabase, startServer, type TestWorkspace } from './test-helpers.ts';

let workspace: TestWorkspace;
let server: McpHttpServer;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  server = await startServer();
});

afterAll(async () => {
  await server.close();
});

function newKey(name: string) {
  return createApiKey({
    organizationId: workspace.organizationId,
    userId: workspace.adminUser.id,
    name,
  });
}

function post(headers: Record<string, string>): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}${MCP_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
}

describe('api key verification', () => {
  it('accepts a valid key and resolves the owner principal', async () => {
    const created = await newKey('valid');
    expect(created.key.startsWith('orb_')).toBe(true);
    expect(created.apiKey.hashedKey).not.toContain(created.key);

    const identity = await verifyApiKey(created.key);
    expect(identity.principal.userId).toBe(workspace.adminUser.id);
    expect(identity.principal.organizationId).toBe(workspace.organizationId);
    expect(identity.principal.role).toBe('admin');
  });

  it('touches lastUsedAt on a successful verification', async () => {
    const created = await newKey('touched');
    expect(created.apiKey.lastUsedAt).toBeNull();
    await verifyApiKey(created.key);
    const [row] = await db
      .select()
      .from(schema.apiKey)
      .where(eq(schema.apiKey.id, created.apiKey.id));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('rejects a revoked key', async () => {
    const created = await newKey('revoked');
    await db
      .update(schema.apiKey)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiKey.id, created.apiKey.id));
    await expect(verifyApiKey(created.key)).rejects.toBeInstanceOf(DomainError);
    await expect(verifyApiKey(created.key)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects an expired key', async () => {
    const created = await newKey('expired');
    await db
      .update(schema.apiKey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.apiKey.id, created.apiKey.id));
    await expect(verifyApiKey(created.key)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a tampered key', async () => {
    const created = await newKey('tampered');
    const tampered = `${created.key.slice(0, -1)}${created.key.endsWith('a') ? 'b' : 'a'}`;
    expect(tampered).not.toBe(created.key);
    await expect(verifyApiKey(tampered)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a key that does not carry the orbit prefix', async () => {
    await expect(verifyApiKey('sk_live_nope')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('http transport', () => {
  it('serves a health check without a key', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}${HEALTH_PATH}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', service: 'mcp' });
  });

  it('rejects an unauthenticated request', async () => {
    const response = await post({});
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('API key');
  });

  it('rejects a request with an unknown key', async () => {
    const response = await post({ authorization: 'Bearer orb_notarealkeyatall' });
    expect(response.status).toBe(401);
  });

  it('rejects a GET on the mcp endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}${MCP_PATH}`);
    expect(response.status).toBe(405);
  });
});
