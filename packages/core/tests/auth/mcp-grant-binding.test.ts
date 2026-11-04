import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, db, eq, schema } from '@orbit/db';
import { canUseMcpTool } from '@orbit/shared/policy';
import {
  bindAgentMcpCredential,
  bindMcpCredential,
  revokeMcpGrant,
  unbindAgentMcpCredential,
  unbindMcpCredential,
  verifyMcpAccessToken,
} from '../../src/auth/mcp-token.ts';
import { removeMember } from '../../src/org/member-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

const SECRET = 'mcp-agent-binding-test-secret-0123456789abcdef';
const originalGate = process.env['ORBIT_AGENT_MCP'];
const originalSecret = process.env['BETTER_AUTH_SECRET'];
let workspace: Workspace;

async function connection(
  target = workspace,
  userId = target.adminUser.id,
  kind: 'agent' | 'legacy' = 'agent',
) {
  const clientId = randomUUID();
  const identityId = randomUUID();
  const grantId = randomUUID();
  const tokenId = randomUUID();
  const rawToken = randomUUID();
  const [member] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, target.organizationId),
        eq(schema.member.userId, userId),
      ),
    )
    .limit(1);
  if (member === undefined) throw new Error('The test owner has no membership.');
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'Shared client name',
    redirectUrls: 'https://example.com/callback',
    type: 'public',
  });
  if (kind === 'agent') {
    await db.insert(schema.agentIdentity).values({
      id: identityId,
      organizationId: target.organizationId,
      ownerUserId: userId,
      clientId,
      name: 'Personal agent',
      ownerNameSnapshot: 'Owner',
      clientNameSnapshot: 'Client',
    });
  }
  const scopes = kind === 'agent' ? 'orbit.read offline_access' : 'orbit.read orbit.write';
  await db.insert(schema.mcpGrant).values({
    id: grantId,
    clientId,
    userId,
    organizationId: target.organizationId,
    scopes,
    identityKind: kind,
    agentIdentityId: kind === 'agent' ? identityId : null,
    ownerMemberId: kind === 'agent' ? member.id : null,
  });
  await db.insert(schema.oauthAccessToken).values({
    id: tokenId,
    accessToken: rawToken,
    refreshToken: randomUUID(),
    clientId,
    userId,
    scopes,
    mcpGrantId: kind === 'agent' ? grantId : null,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
  });
  const token =
    kind === 'agent'
      ? bindAgentMcpCredential(rawToken, grantId, SECRET)
      : bindMcpCredential(rawToken, grantId, SECRET);
  return { clientId, identityId, grantId, tokenId, memberId: member.id, rawToken, token, userId };
}

beforeEach(async () => {
  process.env['BETTER_AUTH_SECRET'] = SECRET;
  process.env['ORBIT_AGENT_MCP'] = 'true';
  await resetDatabase();
  workspace = await createWorkspace('Binding');
});

afterEach(() => {
  if (originalGate === undefined) delete process.env['ORBIT_AGENT_MCP'];
  else process.env['ORBIT_AGENT_MCP'] = originalGate;
  if (originalSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = originalSecret;
});

describe('persistent MCP identity binding', () => {
  it('rejects agent credentials in the previous parser and authenticates the exact identity', async () => {
    const bound = await connection();
    expect(unbindMcpCredential(bound.token, SECRET)).toBeNull();
    expect(unbindAgentMcpCredential(bound.token, SECRET)).toEqual({
      credential: bound.rawToken,
      grantId: bound.grantId,
    });
    expect(unbindAgentMcpCredential(bound.token, `${SECRET}-wrong`)).toBeNull();
    expect((await verifyMcpAccessToken(bound.token)).identity).toEqual({
      kind: 'agent',
      id: bound.identityId,
      name: 'Personal agent',
    });
    await expect(
      verifyMcpAccessToken(bindMcpCredential(bound.rawToken, bound.grantId, SECRET)),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('keeps legacy write scopes usable with the agent gate disabled', async () => {
    const bound = await connection();
    const legacy = await connection(workspace, workspace.adminUser.id, 'legacy');
    process.env['ORBIT_AGENT_MCP'] = 'false';
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
    const context = await verifyMcpAccessToken(legacy.token);
    expect(context.identity).toEqual({ kind: 'legacy' });
    expect(context.scopes).toBe('orbit.read orbit.write');
    expect(
      canUseMcpTool(
        { identity: context.identity, reads: true, writes: context.scopes.includes('orbit.write') },
        { readOnly: false },
      ),
    ).toBe(true);
  });

  for (const field of ['ownerUserId', 'clientId'] as const) {
    it(`rejects a historical identity with nullable ${field}`, async () => {
      const bound = await connection();
      await db
        .update(schema.agentIdentity)
        .set({ [field]: null })
        .where(eq(schema.agentIdentity.id, bound.identityId ?? ''));
      await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({
        code: 'unauthorized',
      });
    });
  }

  it('rejects identities from another workspace or client', async () => {
    const bound = await connection();
    const other = await createWorkspace('Other');
    await db
      .update(schema.agentIdentity)
      .set({ organizationId: other.organizationId })
      .where(eq(schema.agentIdentity.id, bound.identityId ?? ''));
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
    const otherConnection = await connection(other);
    await db
      .update(schema.agentIdentity)
      .set({ organizationId: workspace.organizationId, clientId: otherConnection.clientId })
      .where(eq(schema.agentIdentity.id, bound.identityId ?? ''));
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects another owner and a source token belonging to another exact grant', async () => {
    const bound = await connection();
    const other = await connection();
    await expect(
      verifyMcpAccessToken(bindAgentMcpCredential(bound.rawToken, other.grantId, SECRET)),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    const member = await addMember(workspace, 'member');
    await db
      .update(schema.agentIdentity)
      .set({ ownerUserId: member.user.id })
      .where(eq(schema.agentIdentity.id, bound.identityId ?? ''));
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('allows missing token binding only for legacy credentials', async () => {
    const bound = await connection();
    await db
      .update(schema.oauthAccessToken)
      .set({ mcpGrantId: null })
      .where(eq(schema.oauthAccessToken.id, bound.tokenId));
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
    const legacy = await connection(workspace, workspace.adminUser.id, 'legacy');
    expect((await verifyMcpAccessToken(legacy.token)).identity.kind).toBe('legacy');
    await expect(
      verifyMcpAccessToken(bindAgentMcpCredential(legacy.rawToken, legacy.grantId, SECRET)),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects expanded token scopes and bound grants containing write permission', async () => {
    const bound = await connection();
    await db
      .update(schema.oauthAccessToken)
      .set({ scopes: 'orbit.read orbit.write' })
      .where(eq(schema.oauthAccessToken.id, bound.tokenId));
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
    await db
      .update(schema.mcpGrant)
      .set({ scopes: 'orbit.read orbit.write' })
      .where(eq(schema.mcpGrant.id, bound.grantId));
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('requires the original membership even after the same owner rejoins', async () => {
    const bound = await connection();
    await db.delete(schema.member).where(eq(schema.member.id, bound.memberId));
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
    await db.insert(schema.member).values({
      id: randomUUID(),
      userId: bound.userId,
      organizationId: workspace.organizationId,
      role: 'admin',
    });
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('revokes only the chosen connection and preserves identity history', async () => {
    const bound = await connection();
    const other = await connection();
    const otherWorkspace = await createWorkspace('Elsewhere');
    await db.insert(schema.member).values({
      id: randomUUID(),
      userId: bound.userId,
      organizationId: otherWorkspace.organizationId,
      role: 'member',
    });
    const elsewhere = await connection(otherWorkspace, bound.userId);
    await revokeMcpGrant(bound.grantId, bound.userId);
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
    expect((await verifyMcpAccessToken(other.token)).identity).toMatchObject({
      kind: 'agent',
      id: other.identityId,
    });
    expect((await verifyMcpAccessToken(elsewhere.token)).organizationId).toBe(
      otherWorkspace.organizationId,
    );
    const [history] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, bound.identityId ?? ''));
    expect(history).toMatchObject({
      name: 'Personal agent',
      ownerNameSnapshot: 'Owner',
      deletedAt: null,
    });
    await expect(revokeMcpGrant(other.grantId, otherWorkspace.adminUser.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('invalidates a departing member without deleting snapshots or reviving on rejoin', async () => {
    const member = await addMember(workspace, 'member');
    const bound = await connection(workspace, member.user.id);
    await removeMember(workspace.admin, bound.memberId);
    const [grant] = await db
      .select()
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.id, bound.grantId));
    expect(grant?.revokedAt).toBeInstanceOf(Date);
    const [history] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, bound.identityId ?? ''));
    expect(history).toMatchObject({
      deletedAt: null,
      ownerNameSnapshot: 'Owner',
      clientNameSnapshot: 'Client',
    });
    await db.insert(schema.member).values({
      id: randomUUID(),
      userId: member.user.id,
      organizationId: workspace.organizationId,
      role: 'member',
    });
    await expect(verifyMcpAccessToken(bound.token)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
