import { beforeAll, describe, expect, it } from 'bun:test';
import { verifyMcpAccessToken } from '@orbit/core';
import { and, db, eq, schema } from '@orbit/db';
import { DomainError } from '@orbit/shared/errors';
import { MCP_PATH } from '../src/server.ts';
import {
  callMcp,
  connect,
  createWorkspace,
  MCP_TEST_ORIGIN,
  mintToken,
  resetDatabase,
  type TestClient,
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

  it('rejects a token while workspace deletion is pending', async () => {
    const token = await mintToken(workspace.organizationId, workspace.adminUser.id);
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, workspace.organizationId));
    try {
      await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'forbidden' });
    } finally {
      await db
        .update(schema.organization)
        .set({ deletionRequestedAt: null })
        .where(eq(schema.organization.id, workspace.organizationId));
    }
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

describe('the granted oauth scopes decide which tools exist', () => {
  async function clientWith(scopes: string): Promise<TestClient> {
    return await connect(
      await mintToken(
        workspace.organizationId,
        workspace.adminUser.id,
        `Client for ${scopes}`,
        scopes,
      ),
    );
  }

  async function toolNames(client: TestClient): Promise<string[]> {
    const { tools } = await client.client.listTools();
    return tools.map((tool) => tool.name);
  }

  async function readOnlyNames(client: TestClient): Promise<string[]> {
    const { tools } = await client.client.listTools();
    return tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name);
  }

  it('turns an openid only token away instead of letting it read the workspace', async () => {
    const token = await mintToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'Openid only client',
      'openid profile email',
    );

    const response = await post({ authorization: `Bearer ${token}` });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('orbit.read');
  });

  it('offers a read scoped token exactly the read tools and refuses a write call', async () => {
    const full = await clientWith('openid orbit.read orbit.write');
    const reader = await clientWith('openid orbit.read');
    try {
      const everything = await toolNames(full);
      const reads = await readOnlyNames(full);
      const writes = everything.filter((name) => !reads.includes(name));
      expect(reads.length).toBeGreaterThan(0);
      expect(writes.length).toBeGreaterThan(0);

      const offered = await toolNames(reader);
      expect([...offered].sort()).toEqual([...reads].sort());
      for (const name of writes) {
        expect(offered).not.toContain(name);
      }

      expect((await reader.result('get_me'))['role']).toBe('admin');
      const denied = await reader.call('create_team', { name: 'Smuggled', key: 'SMUG' });
      expect(denied.isError).toBe(true);
      const teams = (await full.result('list_teams'))['teams'] as { name: string }[];
      expect(teams.map((team) => team.name)).not.toContain('Smuggled');
    } finally {
      await full.close();
      await reader.close();
    }
  });

  it('offers a write scoped token no read tool and refuses a read call', async () => {
    const full = await clientWith('openid orbit.read orbit.write');
    const writer = await clientWith('openid orbit.write');
    try {
      const reads = await readOnlyNames(full);
      const offered = await toolNames(writer);

      expect(offered.length).toBeGreaterThan(0);
      expect(reads.length).toBeGreaterThan(0);
      for (const name of reads) {
        expect(offered).not.toContain(name);
      }
      expect((await writer.call('get_me')).isError).toBe(true);
      expect((await writer.call('search_issues', { query: 'anything' })).isError).toBe(true);
    } finally {
      await full.close();
      await writer.close();
    }
  });
});
