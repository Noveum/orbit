import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema, sql } from '@orbit/db';
import { syncActionSchema } from '@orbit/shared/events';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  agentLifecycle,
  manageAgentIdentity,
  preparePersonalAgentConsent,
} from '../../src/auth/agent-identity-service.ts';
import { recordMcpGrant } from '../../src/auth/mcp-token.ts';
import { newId } from '../../src/internal.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

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
  it('stages assignment cleanup in the same transaction as a pause', async () => {
    const { identity } = await createIdentity('Researcher');
    await recordMcpGrant({
      clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: 'orbit.read orbit.write',
      agentIdentityId: identity.id,
    });
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Assigned',
      assigneeAgentId: identity.id,
    });
    await manageAgentIdentity(workspace.admin, identity.id, { action: 'pause' });
    const [issue] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, created.issue.id));
    expect(issue?.assigneeAgentId).toBeNull();
    const events = await db
      .select()
      .from(schema.issueOutbox)
      .where(eq(schema.issueOutbox.aggregateId, created.issue.id));
    const event = events.find((row) => syncActionSchema.parse(row.payload).action === 'update');
    if (event === undefined) throw new Error('The assignment cleanup was not staged.');
    expect(event.payload).toMatchObject({
      eventId: event.id,
      model: 'issue',
      action: 'update',
    });
    const [managementEvent] = await db
      .select()
      .from(schema.issueOutbox)
      .where(eq(schema.issueOutbox.aggregateId, identity.id));
    if (managementEvent === undefined) throw new Error('The management event was not staged.');
    expect(managementEvent.payload).toMatchObject({
      eventId: managementEvent.id,
      model: 'agent_identity',
      data: { id: identity.id, lifecycle: 'disabled' },
      attribution: {
        actor: { type: 'user', id: workspace.adminUser.id },
        principal: { type: 'user', id: workspace.adminUser.id },
      },
    });
    expect(JSON.stringify(managementEvent.payload)).not.toContain('ownerLocked');
    expect(JSON.stringify(managementEvent.payload)).not.toContain('grantId');
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, identity.id));
    expect(audit).toMatchObject({
      action: 'agent.pause',
      actorType: 'user',
      actorId: workspace.adminUser.id,
      after: { lifecycle: 'disabled', connection: 'disconnected' },
    });
  });
  it('rechecks administrator authority against the locked current membership', async () => {
    const { identity } = await createIdentity('Researcher');
    const admin = await addMember(workspace, 'admin');
    await db
      .update(schema.member)
      .set({ role: 'member' })
      .where(eq(schema.member.userId, admin.user.id));
    await expect(
      manageAgentIdentity(admin.principal, identity.id, { action: 'pause' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const [unchanged] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(unchanged?.adminDisabledAt).toBeNull();
  });

  it('accepts only the owners recorded Orbit avatar for creation and profile updates', async () => {
    const avatar = `/api/avatars/${encodeURIComponent(workspace.adminUser.id)}?v=1`;
    await expect(
      db.transaction(async (tx) =>
        preparePersonalAgentConsent(tx, {
          userId: workspace.adminUser.id,
          organizationId: workspace.organizationId,
          clientId,
          selection: { createAgent: { name: 'Researcher', avatar } },
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await db
      .update(schema.user)
      .set({ image: avatar })
      .where(eq(schema.user.id, workspace.adminUser.id));
    const { identity } = await db.transaction(async (tx) =>
      preparePersonalAgentConsent(tx, {
        userId: workspace.adminUser.id,
        organizationId: workspace.organizationId,
        clientId,
        selection: { createAgent: { name: 'Researcher', avatar } },
      }),
    );
    expect(identity.avatar).toBe(avatar);
    await expect(
      manageAgentIdentity(workspace.admin, identity.id, {
        action: 'update_profile',
        profile: { name: 'Researcher', avatar: `${avatar}0` },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('enforces two active identities across concurrent PostgreSQL connections', async () => {
    await createIdentity('First');
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) throw new Error('missing database fixture');
    const firstConnection = postgres(databaseUrl, { max: 1, prepare: false });
    const secondConnection = postgres(databaseUrl, { max: 1, prepare: false });
    const firstDatabase = drizzle({ client: firstConnection, schema, casing: 'snake_case' });
    const secondDatabase = drizzle({ client: secondConnection, schema, casing: 'snake_case' });
    let release = (): void => undefined;
    const start = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready = 0;
    const backendIds: number[] = [];
    const contender = async (database: typeof firstDatabase, name: string) =>
      await database.transaction(async (tx) => {
        const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        if (backend === undefined) throw new Error('missing PostgreSQL backend');
        backendIds.push(backend.pid);
        ready += 1;
        if (ready === 2) release();
        await start;
        return await preparePersonalAgentConsent(tx, {
          userId: workspace.adminUser.id,
          organizationId: workspace.organizationId,
          clientId,
          selection: { createAgent: { name, avatar: null } },
        });
      });
    try {
      const results = await Promise.allSettled([
        contender(firstDatabase, 'Second'),
        contender(secondDatabase, 'Third'),
      ]);
      expect(new Set(backendIds).size).toBe(2);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: {
          code: 'conflict',
          details: { reason: 'agent_quota_exceeded' },
        },
      });
      const identities = await db
        .select({ id: schema.agentIdentity.id })
        .from(schema.agentIdentity)
        .where(eq(schema.agentIdentity.ownerUserId, workspace.adminUser.id));
      expect(identities).toHaveLength(2);
    } finally {
      await Promise.all([
        firstConnection.end({ timeout: 10 }),
        secondConnection.end({ timeout: 10 }),
      ]);
    }
  });

  it('keeps owner and admin locks independent', async () => {
    const { identity } = await createIdentity('Researcher');
    const admin = await addMember(workspace, 'admin', { name: 'Other Admin' });
    const secondAdmin = await addMember(workspace, 'admin', { name: 'Second Admin' });
    await manageAgentIdentity(workspace.admin, identity.id, { action: 'pause' });
    const [ownerLocked] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(ownerLocked === undefined ? null : agentLifecycle(ownerLocked)).toBe('disabled');
    expect(ownerLocked?.ownerDisabledByUserId).toBe(workspace.adminUser.id);

    await manageAgentIdentity(admin.principal, identity.id, { action: 'pause' });
    await manageAgentIdentity(secondAdmin.principal, identity.id, { action: 'pause' });
    const [adminLocked] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(adminLocked?.adminDisabledByUserId).toBe(admin.user.id);
    await manageAgentIdentity(workspace.admin, identity.id, { action: 'resume' });
    const [stillAdminLocked] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(stillAdminLocked === undefined ? null : agentLifecycle(stillAdminLocked)).toBe(
      'disabled',
    );
    await expect(
      manageAgentIdentity(secondAdmin.principal, identity.id, { action: 'resume' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await manageAgentIdentity(admin.principal, identity.id, { action: 'resume' });
    const [resumed] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(resumed === undefined ? null : agentLifecycle(resumed)).toBe('active');
    expect(resumed?.ownerDisabledByUserId).toBe(workspace.adminUser.id);
    expect(resumed?.ownerDisabledActorIdSnapshot).toBe(workspace.adminUser.id);
    expect(resumed?.ownerResumedByUserId).toBe(workspace.adminUser.id);
    expect(resumed?.ownerResumedActorIdSnapshot).toBe(workspace.adminUser.id);
    expect(resumed?.adminDisabledByUserId).toBe(admin.user.id);
    expect(resumed?.adminDisabledActorIdSnapshot).toBe(admin.user.id);
    expect(resumed?.adminResumedByUserId).toBe(admin.user.id);
    expect(resumed?.adminResumedActorIdSnapshot).toBe(admin.user.id);
  });

  it('records the operator for an explicit connection revoke', async () => {
    const { identity } = await createIdentity('Researcher');
    await manageAgentIdentity(workspace.admin, identity.id, { action: 'revoke_connection' });
    const [revoked] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(revoked?.connectionRevokedByUserId).toBe(workspace.adminUser.id);
    expect(revoked?.connectionRevokedActorIdSnapshot).toBe(workspace.adminUser.id);
    expect(revoked?.connectionRevokedAt).toBeInstanceOf(Date);
  });

  it('records an irreversible delete operator and retains the tombstone', async () => {
    const { identity } = await createIdentity('Researcher');
    const deleted = await manageAgentIdentity(workspace.admin, identity.id, {
      action: 'delete',
      reason: 'owner_request',
    });
    expect(agentLifecycle(deleted)).toBe('deleted');
    expect(deleted.deletedByUserId).toBe(workspace.adminUser.id);
    expect(deleted.deletedActorIdSnapshot).toBe(workspace.adminUser.id);
    await expect(
      db
        .update(schema.agentIdentity)
        .set({ deletedReason: 'changed' })
        .where(eq(schema.agentIdentity.id, identity.id))
        .execute(),
    ).rejects.toThrow();
    await db
      .update(schema.agentIdentity)
      .set({ deletedByUserId: null })
      .where(eq(schema.agentIdentity.id, identity.id));
    const [tombstone] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, identity.id));
    expect(tombstone?.deletedActorIdSnapshot).toBe(workspace.adminUser.id);
    await expect(
      manageAgentIdentity(workspace.admin, identity.id, { action: 'resume' }),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
