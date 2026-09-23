import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema, sql } from '@orbit/db';
import { isOpenCategory } from '@orbit/shared/constants';
import type { AgentIdentityAction } from '@orbit/shared/validators';
import {
  manageAgentIdentity,
  preparePersonalAgentConsent,
} from '../../src/auth/agent-identity-service.ts';
import { recordMcpGrant, revokeMcpGrant } from '../../src/auth/mcp-token.ts';
import { newId } from '../../src/internal.ts';
import { removeMember } from '../../src/org/member-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

beforeEach(resetDatabase);

async function fixture() {
  const workspace = await createWorkspace();
  const owner = await addMember(workspace, 'member');
  const clientId = newId();
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    clientId,
    name: 'Client',
    redirectUrls: 'https://example.com/callback',
    type: 'public',
  });
  const { identity } = await db.transaction((tx) =>
    preparePersonalAgentConsent(tx, {
      userId: owner.user.id,
      organizationId: workspace.organizationId,
      clientId,
      selection: { createAgent: { name: 'Researcher', avatar: null } },
    }),
  );
  const grantId = await recordMcpGrant({
    clientId,
    userId: owner.user.id,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read',
    agentIdentityId: identity.id,
  });
  await db.insert(schema.oauthAccessToken).values({
    id: newId(),
    clientId,
    userId: owner.user.id,
    mcpGrantId: grantId,
    accessToken: newId(),
    refreshToken: newId(),
    scopes: 'orbit.read',
    accessTokenExpiresAt: new Date(Date.now() + 60_000),
    refreshTokenExpiresAt: new Date(Date.now() + 60_000),
  });
  const issues = await assignments(workspace, identity.id);
  return { workspace, owner, identity, grantId, issues };
}

async function assignments(workspace: Workspace, identityId: string) {
  const rows: { row: typeof schema.issue.$inferSelect; open: boolean }[] = [];
  for (const state of workspace.states) {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: state.category,
      stateId: state.id,
    });
    const [assigned] = await db
      .update(schema.issue)
      .set({
        assigneeId: null,
        assigneeUserId: null,
        assigneeAgentId: identityId,
        ownerUserId: workspace.adminUser.id,
      })
      .where(eq(schema.issue.id, issue.id))
      .returning();
    if (assigned === undefined) throw new Error('missing assigned issue');
    rows.push({ row: assigned, open: isOpenCategory(state.category) });
  }
  return rows;
}

async function assertCleared(
  issues: Awaited<ReturnType<typeof assignments>>,
  identityId: string,
  actor: { type: 'user' | 'system'; id: string },
) {
  for (const { row, open } of issues) {
    const [updated] = await db.select().from(schema.issue).where(eq(schema.issue.id, row.id));
    expect(updated?.assigneeAgentId).toBe(open ? null : identityId);
    expect(updated?.ownerUserId).toBe(row.ownerUserId);
    const activities = await db
      .select()
      .from(schema.issueActivity)
      .where(
        and(eq(schema.issueActivity.issueId, row.id), eq(schema.issueActivity.field, 'assignee')),
      );
    if (open) {
      expect(updated?.syncId).toBeGreaterThan(row.syncId);
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        actorType: actor.type,
        actorId: actor.id,
        principalUserId: actor.type === 'user' ? actor.id : null,
        grantId: null,
        fromValue: { type: 'agent', id: identityId },
        toValue: null,
        syncId: updated?.syncId,
      });
    } else {
      expect(updated).toEqual(row);
      expect(activities).toHaveLength(0);
    }
  }
}

describe('Agent responsibility lifecycle cleanup', () => {
  it('keeps a second identity for the same owner and client assigned and connected', async () => {
    const { workspace, owner, identity } = await fixture();
    const { identity: other } = await db.transaction((tx) =>
      preparePersonalAgentConsent(tx, {
        userId: owner.user.id,
        organizationId: workspace.organizationId,
        clientId: identity.clientId,
        selection: { createAgent: { name: 'Other', avatar: null } },
      }),
    );
    const grantId = await recordMcpGrant({
      clientId: identity.clientId,
      userId: owner.user.id,
      organizationId: workspace.organizationId,
      scopes: 'orbit.read',
      agentIdentityId: other.id,
    });
    const otherIssues = await assignments(workspace, other.id);
    await manageAgentIdentity(owner.principal, identity.id, { action: 'pause' });
    for (const { row } of otherIssues) {
      expect((await db.select().from(schema.issue).where(eq(schema.issue.id, row.id)))[0]).toEqual(
        row,
      );
    }
    expect(
      (await db.select().from(schema.mcpGrant).where(eq(schema.mcpGrant.id, grantId)))[0]
        ?.revokedAt,
    ).toBeNull();
  });

  it('rolls back identity locks, grant revocation, tokens and assignments when activity fails', async () => {
    const { owner, identity, grantId, issues } = await fixture();
    const beforeGrants = await db.select().from(schema.mcpGrant);
    const beforeTokens = await db.select().from(schema.oauthAccessToken);
    const beforeActivities = await db.select().from(schema.issueActivity);
    await db.execute(sql`create function reject_agent_cleanup_activity() returns trigger as $$
      begin
        if new.field = 'assignee' then raise exception 'cleanup activity rejected'; end if;
        return new;
      end;
    $$ language plpgsql`);
    await db.execute(sql`create trigger reject_agent_cleanup_activity_trigger
      before insert on issue_activity for each row execute function reject_agent_cleanup_activity()`);
    try {
      await expect(
        manageAgentIdentity(owner.principal, identity.id, { action: 'pause' }),
      ).rejects.toMatchObject({ cause: { message: 'cleanup activity rejected' } });
      expect(
        (
          await db
            .select()
            .from(schema.agentIdentity)
            .where(eq(schema.agentIdentity.id, identity.id))
        )[0],
      ).toEqual(identity);
      expect(await db.select().from(schema.mcpGrant)).toEqual(beforeGrants);
      expect(await db.select().from(schema.oauthAccessToken)).toEqual(beforeTokens);
      expect(await db.select().from(schema.issueActivity)).toEqual(beforeActivities);
      for (const { row } of issues) {
        expect(
          (await db.select().from(schema.issue).where(eq(schema.issue.id, row.id)))[0],
        ).toEqual(row);
      }
    } finally {
      await db.execute(sql`drop trigger reject_agent_cleanup_activity_trigger on issue_activity`);
      await db.execute(sql`drop function reject_agent_cleanup_activity()`);
    }
    await revokeMcpGrant(grantId, owner.principal);
    await assertCleared(issues, identity.id, { type: 'user', id: owner.user.id });
  });

  const actions: AgentIdentityAction[] = [
    { action: 'pause' },
    { action: 'revoke_connection' },
    { action: 'delete', reason: 'owner_request' },
  ];
  for (const action of actions) {
    it(`${action.action} clears every open state and preserves different Issue Owners and closed history`, async () => {
      const { workspace, owner, identity, grantId, issues } = await fixture();
      await manageAgentIdentity(owner.principal, identity.id, action);
      await assertCleared(issues, identity.id, { type: 'user', id: owner.user.id });
      expect(
        await db
          .select()
          .from(schema.oauthAccessToken)
          .where(eq(schema.oauthAccessToken.mcpGrantId, grantId)),
      ).toHaveLength(0);
      if (action.action === 'pause') {
        await manageAgentIdentity(owner.principal, identity.id, { action: 'resume' });
        await recordMcpGrant({
          clientId: identity.clientId,
          userId: owner.user.id,
          organizationId: workspace.organizationId,
          scopes: 'orbit.read',
          agentIdentityId: identity.id,
        });
        await assertCleared(issues, identity.id, { type: 'user', id: owner.user.id });
      }
    });
  }

  it('clears assignments for the exact connection without accepting a stale Grant', async () => {
    const { workspace, owner, identity, grantId, issues } = await fixture();
    const currentId = await recordMcpGrant({
      clientId: identity.clientId,
      userId: owner.user.id,
      organizationId: workspace.organizationId,
      scopes: 'orbit.read',
      agentIdentityId: identity.id,
    });
    await expect(revokeMcpGrant(grantId, workspace.admin)).rejects.toMatchObject({
      code: 'not_found',
    });
    for (const { row } of issues) {
      const [unchanged] = await db.select().from(schema.issue).where(eq(schema.issue.id, row.id));
      expect(unchanged).toEqual(row);
    }
    await revokeMcpGrant(currentId, workspace.admin);
    await assertCleared(issues, identity.id, { type: 'user', id: workspace.adminUser.id });
  });

  it('cleans departing owners Agent assignments even when another member owns the Issues', async () => {
    const { workspace, owner, identity, issues } = await fixture();
    const [member] = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspace.organizationId),
          eq(schema.member.userId, owner.user.id),
        ),
      );
    if (member === undefined) throw new Error('missing owner membership');
    const result = await removeMember(workspace.admin, member.id);
    await assertCleared(issues, identity.id, { type: 'system', id: 'system' });
    for (const { row, open } of issues) {
      const action = result.actions.find((entry) => entry.modelId === row.id);
      if (open) expect(action?.data['assigneeAgentId']).toBeNull();
      else expect(action).toBeUndefined();
    }
  });
});
