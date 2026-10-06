import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { mockSession } from '../../../../../../tests-support.ts';

let workspace: Workspace;
const originalGate = process.env['ORBIT_AGENT_MCP'];
const originalWriteGate = process.env['ORBIT_AGENT_ISSUE_WRITE'];
const clientId = 'consent-client';
const callback = 'http://127.0.0.1:9000/callback';
const verifier = 'consent-decision-verifier-0123456789abcdefghijklmnopqrstuvwxyz';

mockSession(() => ({ user: workspace.adminUser, session: { createdAt: new Date() } }));

const { POST } = await import('../../../../../../src/app/(auth)/oauth/authorize/decision/route.ts');

beforeEach(async () => {
  process.env['ORBIT_AGENT_MCP'] = 'true';
  process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'false';
  await resetDatabase();
  workspace = await createWorkspace('Decision');
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'Trusted client',
    redirectUrls: callback,
    type: 'public',
  });
});

afterEach(() => {
  if (originalGate === undefined) delete process.env['ORBIT_AGENT_MCP'];
  else process.env['ORBIT_AGENT_MCP'] = originalGate;
  if (originalWriteGate === undefined) delete process.env['ORBIT_AGENT_ISSUE_WRITE'];
  else process.env['ORBIT_AGENT_ISSUE_WRITE'] = originalWriteGate;
});

async function consentCode(
  scopes = ['openid', 'offline_access', 'orbit.read', 'orbit.write'],
): Promise<string> {
  const code = randomUUID();
  await db.insert(schema.verification).values({
    id: randomUUID(),
    identifier: code,
    value: JSON.stringify({
      clientId,
      redirectURI: callback,
      userId: workspace.adminUser.id,
      scope: scopes,
      requireConsent: true,
      state: 'trusted-state',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 's256',
    }),
    expiresAt: new Date(Date.now() + 600_000),
  });
  return code;
}

function request(code: string, fields: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/oauth/authorize/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({
      decision: 'allow',
      consentCode: code,
      organizationId: workspace.organizationId,
      ...fields,
    }),
  });
}

describe('Agent consent decision boundary', () => {
  it('grants explicitly selected writes only from the trusted requested scope', async () => {
    process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
    const response = await POST(
      request(await consentCode(), { agent: { name: 'Issue writer', write: true } }),
    );
    expect(response.status).toBe(200);
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant).toMatchObject({
      identityKind: 'agent',
      scopes: 'openid offline_access orbit.read orbit.write',
    });
    const body = (await response.json()) as { redirectUri: string };
    const [record] = await db
      .select()
      .from(schema.verification)
      .where(
        eq(
          schema.verification.identifier,
          new URL(body.redirectUri).searchParams.get('code') ?? '',
        ),
      );
    expect(JSON.parse(record?.value ?? '{}')).toMatchObject({
      scope: ['openid', 'offline_access', 'orbit.read', 'orbit.write'],
      mcpGrantId: grant?.id,
    });
  });

  it('rejects disabled writes, forged requested scopes and nonboolean opt-ins', async () => {
    expect(
      (await POST(request(await consentCode(), { agent: { name: 'Writer', write: true } }))).status,
    ).toBe(403);
    process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
    expect(
      (
        await POST(
          request(await consentCode(['orbit.read']), {
            agent: { name: 'Writer', write: true },
            scope: 'orbit.read orbit.write',
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (await POST(request(await consentCode(), { agent: { name: 'Writer', write: 'true' } })))
        .status,
    ).toBe(400);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
    expect(await db.select().from(schema.agentIdentity)).toHaveLength(0);
  });

  it('binds an explicit Identity using the trusted client, user and read-only scopes', async () => {
    const response = await POST(
      request(await consentCode(), {
        agent: { name: 'Review reader' },
        clientId: 'forged-client',
        scope: 'orbit.write',
        userId: 'forged-user',
      }),
    );
    expect(response.status).toBe(200);
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant).toMatchObject({
      identityKind: 'agent',
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: 'openid offline_access orbit.read',
    });
    const [identity] = await db.select().from(schema.agentIdentity);
    expect(identity).toMatchObject({
      id: grant?.agentIdentityId,
      name: 'Review reader',
      ownerUserId: workspace.adminUser.id,
      clientId,
      organizationId: workspace.organizationId,
    });
    const body = (await response.json()) as { redirectUri: string };
    const redirect = new URL(body.redirectUri);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(callback);
    expect(redirect.searchParams.get('state')).toBe('trusted-state');
    const [record] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, redirect.searchParams.get('code') ?? ''));
    expect(JSON.parse(record?.value ?? '{}')).toMatchObject({
      scope: ['openid', 'offline_access', 'orbit.read'],
      mcpGrantId: grant?.id,
      codeChallengeMethod: 's256',
      requireConsent: false,
    });
  });

  it('rejects a forged Agent request when the feature is disabled without creating a legacy grant', async () => {
    const code = await consentCode();
    process.env['ORBIT_AGENT_MCP'] = 'false';
    const response = await POST(request(code, { agent: { name: 'Reader' } }));
    expect(response.status).toBe(403);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
    expect(await db.select().from(schema.agentIdentity)).toHaveLength(0);
    const [record] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, code));
    expect(JSON.parse(record?.value ?? '{}')['requireConsent']).toBe(true);
  });

  it('rejects an Identity outside the authorizing Owner and workspace', async () => {
    const other = await createWorkspace('OtherDecision');
    const identityId = randomUUID();
    await db.insert(schema.agentIdentity).values({
      id: identityId,
      name: 'Other reader',
      organizationId: other.organizationId,
      ownerUserId: other.adminUser.id,
      clientId,
      ownerNameSnapshot: 'Other owner',
      clientNameSnapshot: 'Client',
    });
    const response = await POST(request(await consentCode(), { agent: { identityId } }));
    expect(response.status).toBe(403);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
    const [identity] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identityId));
    expect(identity?.ownerUserId).toBe(other.adminUser.id);
  });
});
