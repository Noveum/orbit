import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema, sql } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import type { AgentIdentityAction } from '@orbit/shared/validators';
import { listActivity } from '../../src/activity/activity-service.ts';
import {
  manageAgentIdentity,
  preparePersonalAgentConsent,
} from '../../src/auth/agent-identity-service.ts';
import { recordMcpGrant } from '../../src/auth/mcp-token.ts';
import { newId } from '../../src/internal.ts';
import { removeMember } from '../../src/org/member-service.ts';
import { updateProfile } from '../../src/org/profile-service.ts';
import { removeTeamMember } from '../../src/org/team-service.ts';
import { drainIssueOutbox } from '../../src/realtime/issue-outbox.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createAgentIssue, createIssue, updateIssue } from '../../src/work/issue-service.ts';

const OWNER_AVATAR = '/api/avatars/owner.png?v=1';
const GATES = [
  'ORBIT_AGENT_IDENTITY_READ',
  'ORBIT_AGENT_CONSENT',
  'ORBIT_AGENT_ISSUE_WRITE',
  'ORBIT_ISSUE_OUTBOX_DISPATCH',
] as const;
const originalGates = new Map(GATES.map((gate) => [gate, process.env[gate]]));

beforeEach(async () => {
  for (const gate of GATES) process.env[gate] = 'true';
  await resetDatabase();
});

afterEach(() => {
  for (const gate of GATES) {
    const original = originalGates.get(gate);
    if (original === undefined) delete process.env[gate];
    else process.env[gate] = original;
  }
});

async function fixture() {
  const workspace = await createWorkspace('Attribution');
  const owner = await addMember(workspace, 'member', { name: 'Owner Person' });
  await db
    .update(schema.user)
    .set({ image: OWNER_AVATAR })
    .where(eq(schema.user.id, owner.user.id));
  const clientId = newId();
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    clientId,
    name: 'Attribution client',
    redirectUrls: 'https://example.com/callback',
    type: 'public',
  });
  const { identity } = await db.transaction((tx) =>
    preparePersonalAgentConsent(tx, {
      userId: owner.user.id,
      organizationId: workspace.organizationId,
      clientId,
      selection: { createAgent: { name: 'Researcher', avatar: OWNER_AVATAR } },
    }),
  );
  const grantId = await recordMcpGrant({
    clientId,
    userId: owner.user.id,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read orbit.write',
    agentIdentityId: identity.id,
  });
  return {
    workspace,
    owner,
    identity,
    grantId,
    binding: {
      principal: owner.principal,
      clientId,
      agentIdentityId: identity.id,
      grantId,
      scopes: 'orbit.read orbit.write',
    },
  };
}

async function activitiesFor(issueId: string) {
  return await db
    .select()
    .from(schema.issueActivity)
    .where(eq(schema.issueActivity.issueId, issueId));
}

async function activityWithField(issueId: string, field: string) {
  return await db
    .select()
    .from(schema.issueActivity)
    .where(and(eq(schema.issueActivity.issueId, issueId), eq(schema.issueActivity.field, field)));
}

async function memberRow(workspace: Workspace, userId: string) {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspace.organizationId),
        eq(schema.member.userId, userId),
      ),
    );
  if (row === undefined) throw new Error('missing membership');
  return row;
}

describe('Agent activity attribution', () => {
  it('P0-ATTR-1 stamps the agent, the owner and the connection and keeps the snapshot after renames', async () => {
    const { workspace, owner, identity, grantId, binding } = await fixture();
    const first = await createAgentIssue(binding, { teamId: workspace.teamId, title: 'First' });
    const [created] = await activitiesFor(first.issue.id);
    expect(created).toMatchObject({
      actorType: 'agent',
      actorId: identity.id,
      actorName: 'Researcher',
      actorAvatar: OWNER_AVATAR,
      principalUserId: owner.user.id,
      principalName: 'Owner Person',
      principalAvatar: OWNER_AVATAR,
      grantId,
      cause: null,
      causeActorId: null,
    });

    await manageAgentIdentity(owner.principal, identity.id, {
      action: 'update_profile',
      profile: { name: 'Renamed', avatar: null },
    });
    const second = await createAgentIssue(binding, { teamId: workspace.teamId, title: 'Second' });
    const [secondCreated] = await activitiesFor(second.issue.id);
    expect(secondCreated).toMatchObject({
      actorName: 'Renamed',
      actorAvatar: null,
      principalName: 'Owner Person',
      principalAvatar: OWNER_AVATAR,
    });

    await updateProfile(owner.user.id, { name: 'Renamed Owner' });
    const third = await createAgentIssue(binding, { teamId: workspace.teamId, title: 'Third' });
    const [thirdCreated] = await activitiesFor(third.issue.id);
    expect(thirdCreated).toMatchObject({ actorName: 'Renamed', principalName: 'Renamed Owner' });

    const [reread] = await activitiesFor(first.issue.id);
    expect(reread).toMatchObject({
      actorName: 'Researcher',
      actorAvatar: OWNER_AVATAR,
      principalName: 'Owner Person',
      principalAvatar: OWNER_AVATAR,
    });
    const page = await listActivity(db, workspace.admin, first.issue.id);
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({
      actorName: 'Researcher',
      actorAvatar: OWNER_AVATAR,
      principalName: 'Owner Person',
    });
  });

  it('P0-ATTR-1 keeps human rows on the human and leaves the connection empty', async () => {
    const workspace = await createWorkspace('Attribution');
    const member = await addMember(workspace, 'member', { name: 'Human Doer' });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Plain',
    });
    await updateIssue(workspace.admin, issue.id, { assigneeId: member.user.id });
    const rows = await activitiesFor(issue.id);
    expect(rows.map((row) => row.field).sort()).toEqual(['assignee', 'created', 'ownerUserId']);
    for (const row of rows) {
      expect(row).toMatchObject({
        actorType: 'user',
        actorId: workspace.adminUser.id,
        actorName: workspace.adminUser.name,
        actorAvatar: null,
        principalUserId: workspace.adminUser.id,
        principalName: workspace.adminUser.name,
        principalAvatar: null,
        grantId: null,
        cause: null,
        causeActorId: null,
      });
    }
  });
});

describe('Agent lifecycle attribution', () => {
  const lifecycle: { readonly action: AgentIdentityAction; readonly cause: string }[] = [
    { action: { action: 'pause' }, cause: 'agent_paused' },
    { action: { action: 'revoke_connection' }, cause: 'connection_revoked' },
    { action: { action: 'delete', reason: 'owner_request' }, cause: 'agent_deleted' },
  ];

  for (const entry of lifecycle) {
    it(`P0-ATTR-1 records ${entry.cause} on the tombstone with the person who caused it`, async () => {
      const { workspace, owner, identity, binding } = await fixture();
      const created = await createAgentIssue(binding, {
        teamId: workspace.teamId,
        title: 'Assigned',
        assigneeAgentId: identity.id,
      });
      await manageAgentIdentity(owner.principal, identity.id, entry.action);

      const rows = await activityWithField(created.issue.id, 'assignee');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorType: 'user',
        actorId: owner.user.id,
        actorName: 'Owner Person',
        principalUserId: owner.user.id,
        principalName: 'Owner Person',
        grantId: null,
        cause: entry.cause,
        causeActorId: owner.user.id,
        fromValue: { type: 'agent', id: identity.id },
        toValue: null,
      });

      const [identityRow] = await db
        .select()
        .from(schema.agentIdentity)
        .where(eq(schema.agentIdentity.id, identity.id));
      expect(identityRow).toBeDefined();
      expect(await activitiesFor(created.issue.id)).toHaveLength(2);
      if (entry.action.action === 'delete') expect(identityRow?.deletedAt).not.toBeNull();
    });
  }

  it('P0-ATTR-1 attributes a system actor when a member leaves the workspace', async () => {
    const { workspace, owner, identity, binding } = await fixture();
    const created = await createAgentIssue(binding, {
      teamId: workspace.teamId,
      title: 'Assigned',
      assigneeAgentId: identity.id,
    });
    const member = await memberRow(workspace, owner.user.id);
    await removeMember(workspace.admin, member.id);

    const rows = await activityWithField(created.issue.id, 'assignee');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'system',
      actorId: 'system',
      actorName: 'System',
      actorAvatar: null,
      principalUserId: null,
      principalName: null,
      principalAvatar: null,
      grantId: null,
      cause: 'membership_removed',
      causeActorId: workspace.adminUser.id,
    });
  });

  it('P0-ATTR-1 attributes a system actor when team access is lost', async () => {
    const workspace = await createWorkspace('Attribution');
    const member = await addMember(workspace, 'member', { name: 'Leaver' });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Owned',
      assigneeId: member.user.id,
    });
    await removeTeamMember(workspace.admin, workspace.teamId, member.user.id);

    const rows = await activityWithField(issue.id, 'assignee');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'system',
      actorId: 'system',
      principalUserId: null,
      principalName: null,
      grantId: null,
      cause: 'team_access_lost',
      causeActorId: workspace.adminUser.id,
      toValue: null,
    });
  });
});

describe('Public attribution surface', () => {
  it('P0-ATTR-1 keeps the grant on the server copy and publishes a redacted attribution', async () => {
    const { workspace, owner, identity, binding, grantId } = await fixture();
    const created = await createAgentIssue(binding, {
      teamId: workspace.teamId,
      title: 'Published',
      assigneeAgentId: identity.id,
    });
    const staged = await db.select().from(schema.issueOutbox);
    expect(staged).toHaveLength(created.actions.length);
    const stored = JSON.stringify(staged.map((row) => row.payload));
    expect(stored).toContain('grantId');
    expect(stored).toContain(grantId);

    const published: SyncAction[] = [];
    const drained = await drainIssueOutbox({
      publish: (actions) => {
        published.push(...actions);
        return Promise.resolve();
      },
    });
    expect(drained).toBe(staged.length);
    expect(published.length).toBeGreaterThan(0);
    const publicPayload = JSON.stringify(published);
    expect(publicPayload).not.toContain('grantId');
    expect(publicPayload).not.toContain('grant_id');
    expect(publicPayload).toContain(owner.user.id);
    expect(published[0]?.eventId).toBeString();
    expect(published[0]?.attribution?.actor).toMatchObject({
      type: 'agent',
      id: identity.id,
      name: 'Researcher',
      avatar: OWNER_AVATAR,
    });
    expect(published[0]?.attribution?.principal).toMatchObject({
      type: 'user',
      id: owner.user.id,
      name: 'Owner Person',
      avatar: OWNER_AVATAR,
    });
    for (const row of await db.select().from(schema.issueOutbox)) {
      expect(row.deliveredAt).not.toBeNull();
    }
  });

  it('P0-ATTR-1 refuses to delete a grant that attribution history still references', async () => {
    const { workspace, binding, grantId } = await fixture();
    await createAgentIssue(binding, {
      teamId: workspace.teamId,
      title: 'History',
      assigneeAgentId: binding.agentIdentityId,
    });
    let blocked = false;
    try {
      await db.execute(sql`delete from mcp_grant where id = ${grantId}`);
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    const remaining = await db
      .select()
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.id, grantId));
    expect(remaining).toHaveLength(1);
    const referenced = await db
      .select()
      .from(schema.issueActivity)
      .where(eq(schema.issueActivity.grantId, grantId));
    expect(referenced.length).toBeGreaterThan(0);
  });

  it('P0-ATTR-1 nulls the principal reference and restricts the grant reference', async () => {
    const rows = await db.execute<{ conname: string; deltype: string }>(sql`
      select conname, confdeltype::text as deltype
      from pg_constraint
      where conname in (
        'issue_activity_principal_user_id_user_id_fk',
        'issue_activity_grant_id_mcp_grant_id_fk',
        'notification_principal_user_id_user_id_fk',
        'notification_grant_id_mcp_grant_id_fk',
        'audit_log_principal_user_id_user_id_fk',
        'audit_log_grant_id_mcp_grant_id_fk'
      )
    `);
    const byName = new Map(rows.map((row) => [row.conname, row.deltype]));
    expect(byName.size).toBe(6);
    expect(byName.get('issue_activity_principal_user_id_user_id_fk')).toBe('n');
    expect(byName.get('notification_principal_user_id_user_id_fk')).toBe('n');
    expect(byName.get('audit_log_principal_user_id_user_id_fk')).toBe('n');
    expect(byName.get('issue_activity_grant_id_mcp_grant_id_fk')).toBe('r');
    expect(byName.get('notification_grant_id_mcp_grant_id_fk')).toBe('r');
    expect(byName.get('audit_log_grant_id_mcp_grant_id_fk')).toBe('r');
  });
});
