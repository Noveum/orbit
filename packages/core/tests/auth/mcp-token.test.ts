import { beforeEach, describe, expect, it } from 'bun:test';
import { createHmac, randomUUID } from 'node:crypto';
import { db, eq, schema } from '@orbit/db';
import {
  bindMcpCredential,
  type FinalizeMcpConsentInput,
  finalizeMcpConsent,
  getMcpClient,
  listMcpGrants,
  passkeyVerifiedWithin,
  recordMcpGrant,
  revokeMcpGrant,
  unbindMcpCredential,
  userHasPasskey,
  verifyMcpAccessToken,
} from '../../src/auth/mcp-token.ts';
import { createOrganization } from '../../src/org/organization-service.ts';
import {
  createUser,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

const SCOPES = 'openid profile email orbit.read orbit.write';
const MCP_SECRET = 'mcp-binding-test-secret-0123456789abcdef';

let workspace: Workspace;

describe('MCP credential binding', () => {
  it('round trips an opaque credential and rejects a changed binding', () => {
    const bound = bindMcpCredential('opaque-token', 'grant-one', MCP_SECRET);
    expect(unbindMcpCredential(bound, MCP_SECRET)).toEqual({
      credential: 'opaque-token',
      grantId: 'grant-one',
    });
    const replacement = bound.endsWith('A') ? 'B' : 'A';
    expect(unbindMcpCredential(`${bound.slice(0, -1)}${replacement}`, MCP_SECRET)).toBeNull();
    expect(unbindMcpCredential(bound, `${MCP_SECRET}-wrong`)).toBeNull();
    expect(unbindMcpCredential('opaque-token', MCP_SECRET)).toBeNull();
    expect(unbindMcpCredential(`${bound}.extra`, MCP_SECRET)).toBeNull();
    expect(unbindMcpCredential(`${bound}${'a'.repeat(4096)}`, MCP_SECRET)).toBeNull();

    const nonCanonicalPayload = 'orbit-mcp-v1.Z3JhbnQtb25l=.b3BhcXVlLXRva2Vu';
    const nonCanonicalSignature = createHmac('sha256', MCP_SECRET)
      .update(nonCanonicalPayload)
      .digest('base64url');
    expect(
      unbindMcpCredential(`${nonCanonicalPayload}.${nonCanonicalSignature}`, MCP_SECRET),
    ).toBeNull();
  });
});

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

async function issueToken(
  clientId: string,
  userId: string,
  expiresAt: Date,
  scopes = SCOPES,
): Promise<string> {
  const accessToken = `at_${randomUUID().replace(/-/g, '')}`;
  await db.insert(schema.oauthAccessToken).values({
    id: randomUUID(),
    accessToken,
    refreshToken: `rt_${randomUUID().replace(/-/g, '')}`,
    accessTokenExpiresAt: expiresAt,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    clientId,
    userId,
    scopes,
  });
  const [grant] = await db
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(eq(schema.mcpGrant.clientId, clientId))
    .limit(1);
  if (grant === undefined) throw new Error('the test client has no MCP grant');
  return bindMcpCredential(accessToken, grant.id, MCP_SECRET);
}

function rawTokenOf(token: string): string {
  const binding = unbindMcpCredential(token, MCP_SECRET);
  if (binding === null) throw new Error('the test token has no MCP grant binding');
  return binding.credential;
}

beforeEach(async () => {
  process.env['BETTER_AUTH_SECRET'] = MCP_SECRET;
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
    const firstGrantId = await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const secondGrantId = await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: other,
      scopes: SCOPES,
    });

    const grants = await listMcpGrants(workspace.adminUser.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.organizationId).toBe(other);
    expect(secondGrantId).not.toBe(firstGrantId);
    expect(grants[0]?.id).toBe(secondGrantId);
  });

  it('invalidates a token issued for the workspace bound before re-consent', async () => {
    const clientId = await createClient();
    const other = await createOrganizationFor(workspace.adminUser.id);
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const token = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
    );

    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: other,
      scopes: SCOPES,
    });

    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
    const remaining = await db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, rawTokenOf(token)));
    expect(remaining).toHaveLength(0);
  });
});

describe('verifyMcpAccessToken with a grant', () => {
  it('accepts only the immutable grant version carried by a late-issued token', async () => {
    const clientId = await createClient();
    const other = await createOrganizationFor(workspace.adminUser.id);
    const firstGrantId = await recordMcpGrant({
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
    const currentToken = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
    );

    const current = await verifyMcpAccessToken(currentToken);
    expect(current.organizationId).toBe(other);
    await expect(
      verifyMcpAccessToken(bindMcpCredential(rawTokenOf(currentToken), firstGrantId, MCP_SECRET)),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('resolves the workspace bound at consent time', async () => {
    const clientId = await createClient();
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const token = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
    );

    const context = await verifyMcpAccessToken(token);
    expect(context.organizationId).toBe(workspace.organizationId);
    expect(context.principal.role).toBe('admin');
  });

  it('rejects once the grant is revoked', async () => {
    const clientId = await createClient();
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const token = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
    );
    const [grant] = await listMcpGrants(workspace.adminUser.id);
    await revokeMcpGrant(grant?.id ?? '', workspace.adminUser.id);

    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
    const remaining = await db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, rawTokenOf(token)));
    expect(remaining).toHaveLength(0);
  });

  it('rejects token scopes beyond the active grant without touching the grant', async () => {
    const clientId = await createClient();
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: 'openid orbit.read',
    });
    const token = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
      'openid orbit.read orbit.write',
    );

    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
    const [grant] = await db
      .select({ lastUsedAt: schema.mcpGrant.lastUsedAt })
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.clientId, clientId));
    expect(grant?.lastUsedAt).toBeNull();
  });

  it('invalidates an existing token when re-consent expands the active grant', async () => {
    const clientId = await createClient();
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: 'openid orbit.read',
    });
    const token = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
      'openid orbit.read',
    );

    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: 'openid orbit.read orbit.write',
    });

    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
    const remaining = await db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, rawTokenOf(token)));
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

async function createConsentCode(
  userId: string,
  overrides: Partial<{
    requireConsent: boolean;
    expiresAt: Date;
    redirectURI: string;
    state: string;
  }> = {},
): Promise<string> {
  const consentCode = randomUUID().replace(/-/g, '');
  const clientId = await createClient();
  await db.insert(schema.verification).values({
    id: randomUUID(),
    identifier: consentCode,
    value: JSON.stringify({
      clientId,
      redirectURI: overrides.redirectURI ?? 'http://127.0.0.1:9876/callback',
      scope: ['openid', 'orbit.read', 'orbit.write'],
      userId,
      requireConsent: overrides.requireConsent ?? true,
      state: overrides.state ?? 'xyz',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    }),
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 600_000),
  });
  return consentCode;
}

describe('finalizeMcpConsent', () => {
  it('mints a code, records consent, and preserves PKCE on accept', async () => {
    const consentCode = await createConsentCode(workspace.adminUser.id);
    const { redirectUri } = await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode,
      accept: true,
      organizationId: workspace.organizationId,
    });

    const url = new URL(redirectUri);
    const code = url.searchParams.get('code');
    expect(code).not.toBeNull();
    expect(url.searchParams.get('state')).toBe('xyz');

    const [old] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, consentCode));
    expect(old).toBeUndefined();

    const [minted] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, code ?? ''));
    const value = JSON.parse(minted?.value ?? '{}');
    expect(value.requireConsent).toBe(false);
    expect(value.codeChallenge).toBe('challenge');

    const [grant] = await db.select({ id: schema.mcpGrant.id }).from(schema.mcpGrant);
    expect(value.mcpGrantId).toBe(grant?.id);

    const [consent] = await db.select().from(schema.oauthConsent);
    expect(consent?.consentGiven).toBe(true);
  });

  it('returns an access_denied redirect and clears the code on deny', async () => {
    const consentCode = await createConsentCode(workspace.adminUser.id);
    const { redirectUri } = await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode,
      accept: false,
    });
    expect(new URL(redirectUri).searchParams.get('error')).toBe('access_denied');
    const rows = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, consentCode));
    expect(rows).toHaveLength(0);
  });

  it('rejects acceptance without a workspace before minting a code', async () => {
    const consentCode = await createConsentCode(workspace.adminUser.id);
    const malformedInput = {
      userId: workspace.adminUser.id,
      consentCode,
      accept: true,
    } as unknown as FinalizeMcpConsentInput;

    await expect(finalizeMcpConsent(malformedInput)).rejects.toMatchObject({
      code: 'validation_failed',
    });

    const [request] = await db
      .select({ identifier: schema.verification.identifier })
      .from(schema.verification)
      .where(eq(schema.verification.identifier, consentCode));
    expect(request?.identifier).toBe(consentCode);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
    expect(await db.select().from(schema.oauthConsent)).toHaveLength(0);
  });

  it('rejects an expired request', async () => {
    const consentCode = await createConsentCode(workspace.adminUser.id, {
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode,
        accept: true,
        organizationId: workspace.organizationId,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('refuses a request that belongs to another account', async () => {
    const consentCode = await createConsentCode(workspace.adminUser.id);
    const stranger = await createUser('Stranger');
    await expect(
      finalizeMcpConsent({
        userId: stranger.id,
        consentCode,
        accept: true,
        organizationId: workspace.organizationId,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects an unknown consent code', async () => {
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode: 'nope',
        accept: true,
        organizationId: workspace.organizationId,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
