import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { mockSession } from '../../../../../../tests-support.ts';

let workspace: Workspace;
const originalGate = process.env['ORBIT_AGENT_MCP'];
const clientId = 'legacy-decision-client';
const callback = 'http://127.0.0.1:9000/callback';

mockSession(() => ({ user: workspace.adminUser, session: { createdAt: new Date() } }));
const { POST } = await import('../../../../../../src/app/(auth)/oauth/authorize/decision/route.ts');

beforeEach(async () => {
  process.env['ORBIT_AGENT_MCP'] = 'false';
  await resetDatabase();
  workspace = await createWorkspace('LegacyDecision');
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'Legacy client',
    redirectUrls: callback,
    type: 'public',
  });
});

afterEach(() => {
  if (originalGate === undefined) delete process.env['ORBIT_AGENT_MCP'];
  else process.env['ORBIT_AGENT_MCP'] = originalGate;
});

async function consentCode(): Promise<string> {
  const code = randomUUID();
  await db.insert(schema.verification).values({
    id: randomUUID(),
    identifier: code,
    value: JSON.stringify({
      clientId,
      redirectURI: callback,
      userId: workspace.adminUser.id,
      scope: ['openid', 'offline_access', 'orbit.read', 'orbit.write'],
      requireConsent: true,
      state: 'legacy-state',
      codeChallenge: createHash('sha256').update('legacy-verifier').digest('base64url'),
      codeChallengeMethod: 's256',
    }),
    expiresAt: new Date(Date.now() + 600_000),
  });
  return code;
}

function request(code: string, fields: Record<string, unknown> = {}): Request {
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

describe('legacy Consent compatibility', () => {
  it('continues to accept legacy approval and denial with the Agent feature disabled', async () => {
    const allowed = await POST(request(await consentCode(), { extraLegacyField: 'ignored' }));
    expect(allowed.status).toBe(200);
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant).toMatchObject({
      identityKind: 'legacy',
      agentIdentityId: null,
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: 'openid offline_access orbit.read orbit.write',
    });
    const denied = await POST(request(await consentCode(), { decision: 'deny' }));
    expect(denied.status).toBe(200);
    const body = (await denied.json()) as { redirectUri: string };
    expect(new URL(body.redirectUri).searchParams.get('error')).toBe('access_denied');
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(1);
    expect(await db.select().from(schema.agentIdentity)).toHaveLength(0);
  });

  it('rejects explicit Agent requests without creating a legacy grant or consuming Consent', async () => {
    const code = await consentCode();
    for (const agent of [null, { name: 'Reader' }, { identityId: 'identity_1' }, false, 'agent']) {
      const response = await POST(request(code, { agent }));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
      expect(await db.select().from(schema.agentIdentity)).toHaveLength(0);
      const [record] = await db
        .select()
        .from(schema.verification)
        .where(eq(schema.verification.identifier, code));
      expect(JSON.parse(record?.value ?? '{}')['requireConsent']).toBe(true);
    }
  });
});
