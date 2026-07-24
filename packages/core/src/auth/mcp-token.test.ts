import { beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db, eq, schema } from '@orbit/db';
import { createOrganization } from '../org/organization-service.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  getMcpClient,
  listMcpGrants,
  passkeyVerifiedWithin,
  recordMcpGrant,
  revokeMcpGrant,
  userHasPasskey,
  verifyMcpAccessToken,
} from './mcp-token.ts';

const SCOPES = 'openid profile email orbit.read orbit.write';

let workspace: Workspace;

async function createClient(name = 'Claude'): Promise<string> {
  const clientId = `client_${randomUUID().replace(/-/g, '')}`;
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    name,
    clientId,
    redirectUrls: 'http://127.0.0.1:9000/callback',
    type: 'public',
    userId: workspace.adminUser.id,
  });
  return clientId;
}

async function issueToken(clientId: string, userId: string, expiresAt: Date): Promise<string> {
  const accessToken = `at_${randomUUID().replace(/-/g, '')}`;
  await db.insert(schema.oauthAccessToken).values({
    id: randomUUID(),
    accessToken,
    refreshToken: `rt_${randomUUID().replace(/-/g, '')}`,
    accessTokenExpiresAt: expiresAt,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    clientId,
    userId,
    scopes: SCOPES,
  });
  return accessToken;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('recordMcpGrant', () => {
  it('binds a client and user to a workspace and lists it', async () => {
    const clientId = await createClient();
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });

    const grants = await listMcpGrants(workspace.adminUser.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.clientName).toBe('Claude');
    expect(grants[0]?.organizationId).toBe(workspace.organizationId);
  });

  it('upserts the workspace when the same client re-consents', async () => {
    const clientId = await createClient();
    const other = await createOrganizationFor(workspace.adminUser.id);
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: other,
      scopes: SCOPES,
    });

    const grants = await listMcpGrants(workspace.adminUser.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.organizationId).toBe(other);
  });
});

describe('verifyMcpAccessToken with a grant', () => {
  it('resolves the workspace bound at consent time', async () => {
    const clientId = await createClient();
    const token = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
    );
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });

    const context = await verifyMcpAccessToken(token);
    expect(context.organizationId).toBe(workspace.organizationId);
    expect(context.principal.role).toBe('admin');
  });

  it('rejects once the grant is revoked', async () => {
    const clientId = await createClient();
    const token = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
    );
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const [grant] = await listMcpGrants(workspace.adminUser.id);
    await revokeMcpGrant(grant?.id ?? '', workspace.adminUser.id);

    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
    const remaining = await db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, token));
    expect(remaining).toHaveLength(0);
  });
});

describe('getMcpClient', () => {
  it('returns the registered client name', async () => {
    const clientId = await createClient('Cursor');
    const client = await getMcpClient(clientId);
    expect(client?.name).toBe('Cursor');
  });

  it('returns null for an unknown client', async () => {
    expect(await getMcpClient('nope')).toBeNull();
  });
});

describe('passkey step-up helpers', () => {
  it('reports whether the user has a passkey', async () => {
    expect(await userHasPasskey(workspace.adminUser.id)).toBe(false);
    await addPasskey(workspace.adminUser.id, new Date());
    expect(await userHasPasskey(workspace.adminUser.id)).toBe(true);
  });

  it('only counts a passkey used inside the window', async () => {
    await addPasskey(workspace.adminUser.id, new Date(Date.now() - 10_000));
    expect(await passkeyVerifiedWithin(workspace.adminUser.id, 120_000)).toBe(true);
    expect(await passkeyVerifiedWithin(workspace.adminUser.id, 1_000)).toBe(false);
  });
});

async function addPasskey(userId: string, lastUsedAt: Date): Promise<void> {
  await db.insert(schema.passkey).values({
    id: randomUUID(),
    userId,
    publicKey: 'test-key',
    credentialID: randomUUID(),
    deviceType: 'singleDevice',
    lastUsedAt,
  });
}

async function createOrganizationFor(userId: string): Promise<string> {
  const bootstrap = await createOrganization(userId, {
    name: 'Second',
    slug: `second-${randomUUID().slice(0, 8)}`,
  });
  return bootstrap.organization.id;
}
