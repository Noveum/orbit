import { beforeAll, describe, expect, it } from 'bun:test';
import { verifyMcpAccessToken } from '@orbit/core';
import { and, db, eq, schema } from '@orbit/db';
import { DomainError } from '@orbit/shared/errors';
import { MCP_PATH } from '../src/server.ts';
import {
  callMcp,
  createWorkspace,
  MCP_TEST_ORIGIN,
  mintToken,
  resetDatabase,
  type TestWorkspace,
} from '../src/test-helpers.ts';

let workspace: TestWorkspace;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function clientIdOf(token: string): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.accessToken, token));
  if (row === undefined) throw new Error('token not found');
  return row.clientId;
}

function post(headers: Record<string, string>): Promise<Response> {
  return callMcp(
    new Request(`${MCP_TEST_ORIGIN}${MCP_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
}

describe('access token verification', () => {
  it('resolves the owner principal for a valid token and workspace', async () => {
    const token = await mintToken(workspace.organizationId, workspace.adminUser.id);
    const identity = await verifyMcpAccessToken(token);
    expect(identity.principal.userId).toBe(workspace.adminUser.id);
    expect(identity.principal.organizationId).toBe(workspace.organizationId);
    expect(identity.principal.role).toBe('admin');
  });

  it('touches lastUsedAt on the grant', async () => {
    const token = await mintToken(workspace.organizationId, workspace.adminUser.id);
    const clientId = await clientIdOf(token);
    await verifyMcpAccessToken(token);
    const [grant] = await db
      .select()
      .from(schema.mcpGrant)
      .where(
        and(
          eq(schema.mcpGrant.clientId, clientId),
          eq(schema.mcpGrant.userId, workspace.adminUser.id),
        ),
      );
    expect(grant?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('rejects an expired token', async () => {
    const token = await mintToken(workspace.organizationId, workspace.adminUser.id);
    await db
      .update(schema.oauthAccessToken)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.oauthAccessToken.accessToken, token));
    await expect(verifyMcpAccessToken(token)).rejects.toBeInstanceOf(DomainError);
    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a token whose grant was revoked', async () => {
    const token = await mintToken(workspace.organizationId, workspace.adminUser.id);
    const clientId = await clientIdOf(token);
    await db
      .update(schema.mcpGrant)
      .set({ revokedAt: new Date() })
      .where(eq(schema.mcpGrant.clientId, clientId));
    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects an unknown token', async () => {
    await expect(verifyMcpAccessToken('at_notarealtoken')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('rejects an empty token', async () => {
    await expect(verifyMcpAccessToken('   ')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('http transport', () => {
  it('challenges an unauthenticated request with WWW-Authenticate', async () => {
    const response = await post({});
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('Bearer resource_metadata=');
    expect(challenge).toContain('/.well-known/oauth-protected-resource/mcp');
    await response.body?.cancel();
  });

  it('rejects a request with an unknown token', async () => {
    const response = await post({ authorization: 'Bearer at_notarealtoken' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    await response.body?.cancel();
  });

  it('rejects a GET on the mcp endpoint', async () => {
    const response = await callMcp(new Request(`${MCP_TEST_ORIGIN}${MCP_PATH}`));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    await response.body?.cancel();
  });
});
