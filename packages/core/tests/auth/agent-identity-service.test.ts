import { beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, db, eq, isNull, schema, sql } from '@orbit/db';
import { type AgentConsentSelection, mcpAuthorizationCodeSchema } from '@orbit/shared/validators';
import { listAgentIdentitiesForConsent } from '../../src/auth/agent-identity-service.ts';
import {
  bindAgentMcpCredential,
  bindMcpCredential,
  type FinalizeMcpConsentInput,
  finalizeMcpConsent,
  lockMcpOwner,
  recordMcpGrant,
  revokeMcpGrant,
  verifyMcpAccessToken,
} from '../../src/auth/mcp-token.ts';
import { createOrganization } from '../../src/org/organization-service.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';

const SECRET = 'agent-consent-binding-test-secret';
const SCOPES = 'openid profile offline_access orbit.read orbit.write';
let workspace: Workspace;
let clientId: string;

beforeEach(async () => {
  process.env['ORBIT_AGENT_MCP'] = 'true';
  process.env['BETTER_AUTH_SECRET'] = SECRET;
  await resetDatabase();
  workspace = await createWorkspace();
  clientId = randomUUID();
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'Registered client',
    redirectUrls: 'https://example.com/callback',
    type: 'public',
  });
});

async function request(scopes = SCOPES, client = clientId): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.verification).values({
    id,
    identifier: id,
    expiresAt: new Date(Date.now() + 60_000),
    value: JSON.stringify({
      clientId: client,
      userId: workspace.adminUser.id,
      redirectURI: 'https://example.com/callback',
      requireConsent: true,
      scope: scopes.split(' '),
      state: 'trusted-state',
      codeChallenge: 'a'.repeat(43),
      codeChallengeMethod: 's256',
    }),
  });
  return id;
}

async function approve(agent: AgentConsentSelection, organizationId = workspace.organizationId) {
  const result = await finalizeMcpConsent({
    userId: workspace.adminUser.id,
    consentCode: await request(),
    organizationId,
    accept: true,
    agent,
  });
  const code = new URL(result.redirectUri).searchParams.get('code');
  const [row] = await db
    .select()
    .from(schema.verification)
    .where(eq(schema.verification.identifier, code ?? ''));
  const context = mcpAuthorizationCodeSchema.parse(JSON.parse(row?.value ?? '{}'));
  const [grant] = await db
    .select()
    .from(schema.mcpGrant)
    .where(eq(schema.mcpGrant.id, context.mcpGrantId));
  if (grant === undefined || grant.agentIdentityId === null)
    throw new Error('Missing bound grant.');
  return { grant, identityId: grant.agentIdentityId, context };
}

async function credential(grant: typeof schema.mcpGrant.$inferSelect): Promise<string> {
  const token = randomUUID();
  await db.insert(schema.oauthAccessToken).values({
    id: randomUUID(),
    accessToken: token,
    refreshToken: randomUUID(),
    accessTokenExpiresAt: new Date(Date.now() + 60_000),
    refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    clientId: grant.clientId,
    userId: grant.userId,
    scopes: grant.scopes,
    mcpGrantId: grant.id,
  });
  return (grant.identityKind === 'agent' ? bindAgentMcpCredential : bindMcpCredential)(
    token,
    grant.id,
    SECRET,
  );
}

async function consentRace(remote: FinalizeMcpConsentInput, local: FinalizeMcpConsentInput) {
  return await db.transaction(async (tx) => {
    await lockMcpOwner(tx, workspace.adminUser.id);
    const code = `import { finalizeMcpConsent } from './src/auth/mcp-token.ts'; import { db, pool, sql } from '@orbit/db'; const [row] = await db.execute(sql\`select pg_backend_pid() as pid\`); process.stdout.write(String(row.pid) + '\\n'); try { await finalizeMcpConsent(${JSON.stringify(remote)}); process.stdout.write('accepted'); } catch { process.stdout.write('rejected'); } finally { await pool.end(); }`;
    const child = Bun.spawn(['bun', '-e', code], {
      cwd: import.meta.dir.replace(/[\\/]tests[\\/]auth$/, ''),
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const reader = child.stdout.getReader();
    const first = await reader.read();
    const pid = Number(new TextDecoder().decode(first.value).trim());
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
      const [row] = await tx.execute<{ waiting: boolean }>(
        sql`select exists(select 1 from pg_locks where pid = ${pid} and locktype = 'advisory' and not granted) as waiting`,
      );
      waiting = row?.waiting === true;
      if (!waiting) await Bun.sleep(20);
    }
    expect(waiting).toBe(true);
    return {
      child,
      local: Promise.allSettled([finalizeMcpConsent(local)]),
      output: remainingOutput(reader),
    };
  });
}

async function remainingOutput(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let output = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return output;
    output += new TextDecoder().decode(chunk.value);
  }
}

describe('explicit identity consent', () => {
  it('keeps legacy writes while binding multiple read-only identities and exact revocation', async () => {
    const legacyId = await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    const [legacy] = await db
      .select()
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.id, legacyId));
    if (legacy === undefined) throw new Error('Missing legacy grant.');
    const legacyToken = await credential(legacy);
    const one = await approve({ name: 'Build reader' });
    const two = await approve({ name: 'Release reader' });
    const oneToken = await credential(one.grant);
    const twoToken = await credential(two.grant);
    expect(one.context.scope).toEqual(['openid', 'profile', 'offline_access', 'orbit.read']);
    expect(one.context.codeChallengeMethod).toBe('s256');
    expect(one.context.state).toBe('trusted-state');
    expect((await verifyMcpAccessToken(oneToken)).identity).toMatchObject({
      kind: 'agent',
      id: one.identityId,
    });
    expect((await verifyMcpAccessToken(legacyToken)).scopes).toContain('orbit.write');
    await revokeMcpGrant(one.grant.id, workspace.adminUser.id);
    await expect(verifyMcpAccessToken(oneToken)).rejects.toMatchObject({ code: 'unauthorized' });
    expect((await verifyMcpAccessToken(twoToken)).identity).toMatchObject({ id: two.identityId });
    expect((await verifyMcpAccessToken(legacyToken)).identity.kind).toBe('legacy');
    const rotated = await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: SCOPES,
    });
    expect(rotated).not.toBe(legacyId);
    expect((await verifyMcpAccessToken(twoToken)).identity).toMatchObject({ id: two.identityId });
  });

  it('reauthorizes only the selected identity and retains its history and snapshots', async () => {
    const one = await approve({ name: 'My explicit name' });
    const token = await credential(one.grant);
    const other = await approve({ name: 'Other identity' });
    const otherToken = await credential(other.grant);
    const replacement = await approve({ identityId: one.identityId });
    expect(replacement.identityId).toBe(one.identityId);
    expect(replacement.grant.id).not.toBe(one.grant.id);
    await expect(verifyMcpAccessToken(token)).rejects.toMatchObject({ code: 'unauthorized' });
    expect((await verifyMcpAccessToken(otherToken)).identity).toMatchObject({
      id: other.identityId,
    });
    const [history] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, one.identityId));
    expect(history).toMatchObject({
      name: 'My explicit name',
      ownerNameSnapshot: workspace.adminUser.name,
      clientNameSnapshot: 'Registered client',
      deletedAt: null,
    });
    expect(
      await db
        .select()
        .from(schema.mcpGrant)
        .where(eq(schema.mcpGrant.agentIdentityId, one.identityId)),
    ).toHaveLength(2);
  });

  it('rejects client takeover, wrong workspace, wrong owner and missing references', async () => {
    const selected = await approve({ name: 'Protected identity' });
    const other = await createOrganization(workspace.adminUser.id, {
      name: 'Other',
      slug: `other-${randomUUID()}`,
    });
    await expect(
      approve({ identityId: selected.identityId }, other.organization.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const otherClient = randomUUID();
    await db.insert(schema.oauthApplication).values({
      id: randomUUID(),
      clientId: otherClient,
      name: 'Other client',
      redirectUrls: 'https://example.com/callback',
      type: 'public',
    });
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode: await request(SCOPES, otherClient),
        organizationId: workspace.organizationId,
        accept: true,
        agent: { identityId: selected.identityId },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const change of [{ ownerUserId: null }, { clientId: null }]) {
      await db
        .update(schema.agentIdentity)
        .set(change)
        .where(eq(schema.agentIdentity.id, selected.identityId));
      await expect(approve({ identityId: selected.identityId })).rejects.toMatchObject({
        code: 'forbidden',
      });
      await db
        .update(schema.agentIdentity)
        .set({ ownerUserId: workspace.adminUser.id, clientId })
        .where(eq(schema.agentIdentity.id, selected.identityId));
    }
    const stranger = await createWorkspace('Stranger');
    await db
      .update(schema.agentIdentity)
      .set({ ownerUserId: stranger.adminUser.id })
      .where(eq(schema.agentIdentity.id, selected.identityId));
    await expect(approve({ identityId: selected.identityId })).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await listAgentIdentitiesForConsent(workspace.adminUser.id, clientId)).toHaveLength(0);
  });

  it('keeps new consent closed with the gate off, without affecting legacy consent', async () => {
    process.env['ORBIT_AGENT_MCP'] = 'false';
    await expect(approve({ name: 'Denied identity' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await db.select().from(schema.agentIdentity)).toHaveLength(0);
    await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode: await request(),
      organizationId: workspace.organizationId,
      accept: true,
    });
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant?.identityKind).toBe('legacy');
    expect(grant?.scopes).toContain('orbit.write');
  });

  it('isolates workspaces and does not enforce an identity quota', async () => {
    const other = await createOrganization(workspace.adminUser.id, {
      name: 'Other',
      slug: `other-${randomUUID()}`,
    });
    const first = await approve({ name: 'First' });
    const second = await approve({ name: 'Second' });
    const third = await approve({ name: 'Third' });
    const elsewhere = await approve({ name: 'Elsewhere' }, other.organization.id);
    expect(await listAgentIdentitiesForConsent(workspace.adminUser.id, clientId)).toHaveLength(4);
    expect((await verifyMcpAccessToken(await credential(elsewhere.grant))).organizationId).toBe(
      other.organization.id,
    );
    for (const result of [first, second, third])
      expect(result.grant.organizationId).toBe(workspace.organizationId);
  });

  it('consumes a duplicate consent once and serializes reauthorization across separate connections', async () => {
    const one = await approve({ name: 'Concurrent identity' });
    const consentCode = await request();
    const input = {
      userId: workspace.adminUser.id,
      consentCode,
      organizationId: workspace.organizationId,
      accept: true,
      agent: { identityId: one.identityId },
    } as const;
    const race = await consentRace(input, input);
    const local = await race.local;
    const output = await race.output;
    expect(await race.child.exited).toBe(0);
    expect(Number(local[0]?.status === 'fulfilled') + Number(output === 'accepted')).toBe(1);
    const active = await db
      .select()
      .from(schema.mcpGrant)
      .where(
        and(eq(schema.mcpGrant.agentIdentityId, one.identityId), isNull(schema.mcpGrant.revokedAt)),
      );
    expect(active).toHaveLength(1);
    const reauthorization = await consentRace(
      { ...input, consentCode: await request() },
      { ...input, consentCode: await request() },
    );
    expect((await reauthorization.local)[0]?.status).toBe('fulfilled');
    expect(await reauthorization.output).toBe('accepted');
    expect(await reauthorization.child.exited).toBe(0);
    expect(
      await db
        .select()
        .from(schema.mcpGrant)
        .where(
          and(
            eq(schema.mcpGrant.agentIdentityId, one.identityId),
            isNull(schema.mcpGrant.revokedAt),
          ),
        ),
    ).toHaveLength(1);
  });
});
