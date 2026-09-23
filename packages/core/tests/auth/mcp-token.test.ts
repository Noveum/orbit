import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHmac, randomUUID } from 'node:crypto';
import { and, db, desc, eq, isNull, schema } from '@orbit/db';
import postgres from 'postgres';
import {
  bindMcpCredential,
  type FinalizeMcpConsentInput,
  finalizeMcpConsent,
  getMcpClient,
  listMcpGrants,
  passkeyVerifiedWithin,
  recordMcpGrant as persistMcpGrant,
  revokeMcpGrant,
  unbindMcpCredential,
  userHasPasskey,
  verifyMcpAccessToken,
} from '../../src/auth/mcp-token.ts';
import { removeMember } from '../../src/org/member-service.ts';
import { createOrganization } from '../../src/org/organization-service.ts';
import {
  addMember,
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

async function recordMcpGrant(input: {
  clientId: string;
  userId: string;
  organizationId: string;
  scopes: string;
}): Promise<string> {
  const [owner] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, input.userId))
    .limit(1);
  const [client] = await db
    .select({ name: schema.oauthApplication.name })
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, input.clientId))
    .limit(1);
  if (owner === undefined || client === undefined) throw new Error('missing identity fixture data');
  const [identity] = await db
    .select({ id: schema.agentIdentity.id })
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.organizationId, input.organizationId),
        eq(schema.agentIdentity.ownerUserId, input.userId),
        eq(schema.agentIdentity.clientId, input.clientId),
      ),
    )
    .limit(1);
  const agentIdentityId = identity?.id ?? randomUUID();
  if (identity === undefined) {
    await db.insert(schema.agentIdentity).values({
      id: agentIdentityId,
      organizationId: input.organizationId,
      ownerUserId: input.userId,
      ownerNameSnapshot: owner.name,
      clientId: input.clientId,
      clientNameSnapshot: client.name,
      name: 'Researcher',
      avatar: null,
    });
  }
  return await persistMcpGrant({ ...input, agentIdentityId });
}

async function issueToken(
  clientId: string,
  userId: string,
  expiresAt: Date,
  scopes = SCOPES,
): Promise<string> {
  const accessToken = `at_${randomUUID().replace(/-/g, '')}`;
  const [grant] = await db
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.clientId, clientId), isNull(schema.mcpGrant.revokedAt)))
    .orderBy(desc(schema.mcpGrant.createdAt), desc(schema.mcpGrant.id))
    .limit(1);
  if (grant === undefined) throw new Error('the test client has no MCP grant');
  await db.insert(schema.oauthAccessToken).values({
    id: randomUUID(),
    accessToken,
    refreshToken: `rt_${randomUUID().replace(/-/g, '')}`,
    accessTokenExpiresAt: expiresAt,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    clientId,
    userId,
    mcpGrantId: grant.id,
    scopes,
  });
  return bindMcpCredential(accessToken, grant.id, MCP_SECRET);
}

function rawTokenOf(token: string): string {
  const binding = unbindMcpCredential(token, MCP_SECRET);
  if (binding === null) throw new Error('the test token has no MCP grant binding');
  return binding.credential;
}

beforeEach(async () => {
  process.env['BETTER_AUTH_SECRET'] = MCP_SECRET;
  process.env['ORBIT_AGENT_IDENTITY_READ'] = 'false';
  process.env['ORBIT_AGENT_CONSENT'] = 'false';
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

afterEach(() => {
  delete process.env['ORBIT_AGENT_CONSENT'];
  delete process.env['ORBIT_AGENT_IDENTITY_READ'];
});

describe('recordMcpGrant', () => {
  it('rejects a mismatched identity without rotating its existing grant', async () => {
    const clientId = await createClient();
    const grantId = await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const [grant] = await db
      .select({ identityId: schema.mcpGrant.agentIdentityId })
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.id, grantId));
    if (grant?.identityId === null || grant === undefined) throw new Error('missing grant fixture');
    const otherOrganizationId = await createOrganizationFor(workspace.adminUser.id);

    await expect(
      persistMcpGrant({
        agentIdentityId: grant.identityId,
        clientId,
        userId: workspace.adminUser.id,
        organizationId: otherOrganizationId,
        scopes: SCOPES,
      }),
    ).rejects.toThrow();

    const [unchanged] = await db
      .select({ revokedAt: schema.mcpGrant.revokedAt })
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.id, grantId));
    expect(unchanged?.revokedAt).toBeNull();
  });

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

  it('keeps another workspace identity connected when the same client re-consents', async () => {
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
    expect(grants).toHaveLength(2);
    expect(grants.map((grant) => grant.organizationId)).toEqual(
      expect.arrayContaining([workspace.organizationId, other]),
    );
    expect(secondGrantId).not.toBe(firstGrantId);
    expect(grants.map((grant) => grant.id)).toContain(secondGrantId);
  });

  it('does not invalidate another workspace identity token when re-consenting', async () => {
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

    expect((await verifyMcpAccessToken(token)).organizationId).toBe(workspace.organizationId);
    const remaining = await db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, rawTokenOf(token)));
    expect(remaining).toHaveLength(1);
  });
});

describe('verifyMcpAccessToken with a grant', () => {
  it('returns the identity-required reason for frozen legacy credentials', async () => {
    const clientId = await createClient();
    const legacyGrantId = randomUUID();
    await db.insert(schema.mcpGrant).values({
      id: legacyGrantId,
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
      revokedAt: new Date(),
      revokeReason: 'agent_identity_required',
      principalNameSnapshot: workspace.adminUser.name,
    });

    await expect(verifyMcpAccessToken('legacy-unwrapped-token')).rejects.toMatchObject({
      code: 'unauthorized',
      details: { reason: 'agent_identity_required' },
    });
    await expect(
      verifyMcpAccessToken(bindMcpCredential('legacy-token', legacyGrantId, MCP_SECRET)),
    ).rejects.toMatchObject({
      code: 'unauthorized',
      details: { reason: 'agent_identity_required' },
    });
  });

  it('serializes verification with a concurrent member removal', async () => {
    const owner = await addMember(workspace, 'member');
    const clientId = await createClient();
    await recordMcpGrant({
      clientId,
      userId: owner.user.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const token = await issueToken(clientId, owner.user.id, new Date(Date.now() + 3_600_000));
    const [grant] = await db
      .select({ identityId: schema.mcpGrant.agentIdentityId })
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.clientId, clientId));
    const [member] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspace.organizationId),
          eq(schema.member.userId, owner.user.id),
        ),
      );
    if (grant?.identityId === null || grant === undefined || member === undefined) {
      throw new Error('missing member removal fixture');
    }
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) throw new Error('missing database fixture');
    const locker = postgres(databaseUrl, { max: 1, prepare: false });
    const observer = postgres(databaseUrl, { max: 1, prepare: false });
    let releaseIdentity = (): void => undefined;
    const identityRelease = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    let signalLocked = (): void => undefined;
    const identityLocked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const identityHold = locker.begin(async (tx) => {
      await tx.unsafe('select id from agent_identity where id = $1 for update', [grant.identityId]);
      signalLocked();
      await identityRelease;
    });
    await identityLocked;
    const verification = verifyMcpAccessToken(token);
    let waitingOnIdentity = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [waiting] = await observer.unsafe(
        "select count(*)::int as total from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%agent_identity%' and query like '%for update%'",
      );
      if (Number(waiting?.['total'] ?? 0) > 0) {
        waitingOnIdentity = true;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    expect(waitingOnIdentity).toBe(true);
    const removal = removeMember(workspace.admin, member.id);
    releaseIdentity();
    await identityHold;
    expect((await verification).userId).toBe(owner.user.id);
    await removal;
    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'forbidden' });
    await locker.end();
    await observer.end();
  });

  it('rechecks lifecycle state after a concurrent pause commits', async () => {
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
    const [grant] = await db
      .select({ id: schema.mcpGrant.id, identityId: schema.mcpGrant.agentIdentityId })
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.clientId, clientId));
    if (grant?.identityId === null || grant === undefined) throw new Error('missing grant fixture');
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) throw new Error('missing database fixture');
    const locker = postgres(databaseUrl, { max: 1, prepare: false });
    let continueLifecycle = (): void => undefined;
    const lockAcquired = new Promise<void>((resolve) => {
      continueLifecycle = resolve;
    });
    let signalLockAcquired = (): void => undefined;
    const lockReady = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });
    const lifecycle = locker.begin(async (tx) => {
      await tx.unsafe('select id from agent_identity where id = $1 for update', [grant.identityId]);
      await tx.unsafe('select id from mcp_grant where id = $1 for update', [grant.id]);
      signalLockAcquired();
      await lockAcquired;
      await tx.unsafe(
        'update agent_identity set owner_disabled_at = now(), owner_disabled_by_user_id = $1 where id = $2',
        [workspace.adminUser.id, grant.identityId],
      );
      await tx.unsafe(
        "update mcp_grant set revoked_at = now(), revoke_reason = 'connection_revoked' where id = $1",
        [grant.id],
      );
      await tx.unsafe('delete from oauth_access_token where mcp_grant_id = $1', [grant.id]);
    });
    await lockReady;
    const verification = verifyMcpAccessToken(token);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    continueLifecycle();
    await lifecycle;
    await expect(verification).rejects.toMatchObject({ code: 'unauthorized' });
    await locker.end();
  });

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
    await revokeMcpGrant(grant?.id ?? '', workspace.admin);

    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
    const remaining = await db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, rawTokenOf(token)));
    expect(remaining).toHaveLength(0);
    const [identity] = await db
      .select({
        revokedAt: schema.agentIdentity.connectionRevokedAt,
        revokedBy: schema.agentIdentity.connectionRevokedByUserId,
      })
      .from(schema.agentIdentity)
      .where(
        and(
          eq(schema.agentIdentity.clientId, clientId),
          eq(schema.agentIdentity.ownerUserId, workspace.adminUser.id),
        ),
      );
    expect(identity?.revokedAt).toBeInstanceOf(Date);
    expect(identity?.revokedBy).toBe(workspace.adminUser.id);
  });

  it('does not let a stale grant id revoke a rotated connection', async () => {
    const clientId = await createClient();
    const oldGrantId = await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    await revokeMcpGrant(oldGrantId, workspace.admin);
    const currentGrantId = await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const currentToken = await issueToken(
      clientId,
      workspace.adminUser.id,
      new Date(Date.now() + 3_600_000),
    );

    await expect(revokeMcpGrant(oldGrantId, workspace.admin)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await verifyMcpAccessToken(currentToken)).grantId).toBe(currentGrantId);
  });

  it('lets a workspace admin revoke another owner connection and records the admin', async () => {
    const clientId = await createClient();
    const admin = await addMember(workspace, 'admin', { name: 'Workspace Admin' });
    const grantId = await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    await revokeMcpGrant(grantId, admin.principal);
    const [identity] = await db
      .select({ revokedBy: schema.agentIdentity.connectionRevokedByUserId })
      .from(schema.agentIdentity)
      .where(
        and(
          eq(schema.agentIdentity.ownerUserId, workspace.adminUser.id),
          eq(schema.agentIdentity.clientId, clientId),
        ),
      );
    expect(identity?.revokedBy).toBe(admin.user.id);
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
  it('keeps consent closed by default before creating identities, grants or authorization codes', async () => {
    const consentCode = await createConsentCode(workspace.adminUser.id);
    const before = await db.select().from(schema.agentIdentity);
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode,
        accept: true,
        organizationId: workspace.organizationId,
        identitySelection: { createAgent: { name: 'Researcher', avatar: null } },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await db.select().from(schema.agentIdentity)).toEqual(before);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.verification)
        .where(eq(schema.verification.identifier, consentCode)),
    ).toHaveLength(1);
  });
  it('preserves PKCE and the consent request while the gate is closed', async () => {
    const consentCode = await createConsentCode(workspace.adminUser.id);
    const before = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, consentCode));
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode,
        accept: true,
        organizationId: workspace.organizationId,
        identitySelection: { createAgent: { name: 'Researcher', avatar: null } },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      await db
        .select()
        .from(schema.verification)
        .where(eq(schema.verification.identifier, consentCode)),
    ).toEqual(before);
    expect(JSON.parse(before[0]?.value ?? '{}').codeChallenge).toBe('challenge');
    expect(await db.select().from(schema.oauthConsent)).toHaveLength(0);
  });

  it('mints a code, records consent, and preserves PKCE when the gate is enabled', async () => {
    process.env['ORBIT_AGENT_IDENTITY_READ'] = 'true';
    process.env['ORBIT_AGENT_CONSENT'] = 'true';
    const consentCode = await createConsentCode(workspace.adminUser.id);
    const { redirectUri } = await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode,
      accept: true,
      organizationId: workspace.organizationId,
      identitySelection: { createAgent: { name: 'Researcher', avatar: null } },
    });

    const url = new URL(redirectUri);
    const code = url.searchParams.get('code');
    expect(code).not.toBeNull();
    expect(url.searchParams.get('state')).toBe('xyz');
    const [minted] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, code ?? ''));
    const value = JSON.parse(minted?.value ?? '{}') as Record<string, unknown>;
    expect(value['requireConsent']).toBe(false);
    expect(value['codeChallenge']).toBe('challenge');
    expect(await db.select().from(schema.agentIdentity)).toHaveLength(1);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(1);
    expect(await db.select().from(schema.oauthConsent)).toHaveLength(1);
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
      code: 'forbidden',
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
        identitySelection: { createAgent: { name: 'Researcher', avatar: null } },
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
        identitySelection: { createAgent: { name: 'Researcher', avatar: null } },
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
        identitySelection: { createAgent: { name: 'Researcher', avatar: null } },
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
