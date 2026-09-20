import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import {
  agentLifecycle,
  manageAgentIdentity,
  preparePersonalAgentConsent,
} from '../../src/auth/agent-identity-service.ts';
import { newId } from '../../src/internal.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;
let clientId = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  clientId = `client-${newId()}`;
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    name: 'Orbit Agent',
    clientId,
    redirectUrls: 'http://127.0.0.1/callback',
    type: 'public',
    userId: workspace.adminUser.id,
  });
});

async function createIdentity(name: string) {
  return await db.transaction(async (tx) =>
    preparePersonalAgentConsent(tx, {
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      clientId,
      selection: { createAgent: { name, avatar: null } },
    }),
  );
}

describe('personal agent lifecycle', () => {
  it('enforces two active identities inside the membership-locked consent transaction', async () => {
    await createIdentity('First');
    await createIdentity('Second');
    await expect(createIdentity('Third')).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'agent_quota_exceeded' },
    });
  });

  it('keeps owner and admin locks independent', async () => {
    const { identity } = await createIdentity('Researcher');
    const admin = await addMember(workspace, 'admin', { name: 'Other Admin' });
    await manageAgentIdentity(workspace.admin, identity.id, { action: 'pause' });
    const [ownerLocked] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(ownerLocked === undefined ? null : agentLifecycle(ownerLocked)).toBe('disabled');

    await manageAgentIdentity(admin.principal, identity.id, { action: 'pause' });
    await manageAgentIdentity(workspace.admin, identity.id, { action: 'resume' });
    const [stillAdminLocked] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(stillAdminLocked === undefined ? null : agentLifecycle(stillAdminLocked)).toBe(
      'disabled',
    );
    await manageAgentIdentity(admin.principal, identity.id, { action: 'resume' });
    const [resumed] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(resumed === undefined ? null : agentLifecycle(resumed)).toBe('active');
  });

  it('records an irreversible delete operator and retains the tombstone', async () => {
    const { identity } = await createIdentity('Researcher');
    const deleted = await manageAgentIdentity(workspace.admin, identity.id, {
      action: 'delete',
      reason: 'owner_request',
    });
    expect(agentLifecycle(deleted)).toBe('deleted');
    expect(deleted.deletedByUserId).toBe(workspace.adminUser.id);
    await expect(
      manageAgentIdentity(workspace.admin, identity.id, { action: 'resume' }),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
