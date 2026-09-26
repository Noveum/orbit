import { beforeEach, expect, it } from 'bun:test';
import { db, schema } from '@orbit/db';
import { listAgentSettings } from '../../src/auth/agent-settings.ts';
import { recordMcpGrant } from '../../src/auth/mcp-token.ts';
import { newId } from '../../src/internal.ts';
import { addMember, createWorkspace, resetDatabase } from '../../src/test-support.ts';

beforeEach(resetDatabase);

it('P1-WEB-1 limits member settings to owned agents and exposes separate lifecycle, connection, scopes and quota', async () => {
  const workspace = await createWorkspace('Settings');
  const owner = await addMember(workspace, 'member');
  const other = await addMember(workspace, 'member');
  const clientId = newId();
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    clientId,
    name: 'Client',
    redirectUrls: 'https://example.com',
    type: 'public',
  });
  const identityId = newId();
  await db.insert(schema.agentIdentity).values({
    id: identityId,
    organizationId: workspace.organizationId,
    ownerUserId: owner.user.id,
    ownerNameSnapshot: owner.user.name,
    clientId,
    clientNameSnapshot: 'Client',
    name: 'Researcher',
  });
  const grantId = await recordMcpGrant({
    clientId,
    userId: owner.user.id,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read',
    agentIdentityId: identityId,
  });
  const own = await listAgentSettings(owner.principal);
  expect(own.activeQuotaUsed).toBe(1);
  expect(own.workspaceAgents).toHaveLength(0);
  expect(own.yourAgents[0]).toMatchObject({
    id: identityId,
    lifecycle: 'active',
    connection: 'connected',
    ownerLocked: false,
    adminLocked: false,
    grant: { id: grantId, scopes: ['orbit.read'] },
    effectivePermissions: ['issue:read'],
  });
  expect(JSON.stringify(own)).not.toContain('accessToken');
  expect((await listAgentSettings(other.principal)).yourAgents).toHaveLength(0);
  const adminIdentityId = newId();
  await db.insert(schema.agentIdentity).values({
    id: adminIdentityId,
    organizationId: workspace.organizationId,
    ownerUserId: workspace.admin.userId,
    ownerNameSnapshot: workspace.adminUser.name,
    clientId,
    clientNameSnapshot: 'Client',
    name: 'Admin researcher',
  });
  await recordMcpGrant({
    clientId,
    userId: workspace.admin.userId,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read',
    agentIdentityId: adminIdentityId,
  });
  const admin = await listAgentSettings(workspace.admin);
  expect(admin.yourAgents.map((agent) => agent.id)).toEqual([adminIdentityId]);
  expect(admin.workspaceAgents.map((agent) => agent.id)).toEqual([identityId]);
});
