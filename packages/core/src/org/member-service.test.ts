import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import { newId } from '../internal.ts';
import { addMember, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import { createIssue } from '../work/issue-service.ts';
import { listMembers, removeMember, resolvePrincipal, updateMemberRole } from './member-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function memberIdFor(userId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);
  if (row === undefined) throw new Error('missing member row');
  return row.id;
}

describe('resolvePrincipal', () => {
  it('returns the role and the team ids of the workspace', async () => {
    const principal = await resolvePrincipal(workspace.admin.userId, workspace.organizationId);
    expect(principal.role).toBe('admin');
    expect(principal.teamIds).toContain(workspace.teamId);
  });

  it('refuses a user outside the workspace', async () => {
    const outsider = await addMember(workspace, 'member');
    await db.delete(schema.member).where(eq(schema.member.userId, outsider.user.id));
    await expect(
      resolvePrincipal(outsider.user.id, workspace.organizationId),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('listMembers', () => {
  it('joins the user record', async () => {
    await addMember(workspace, 'member', { name: 'Bo Member' });
    const members = await listMembers(workspace.admin);
    expect(members).toHaveLength(2);
    expect(members.every((entry) => entry.user.email.length > 0)).toBe(true);
  });
});

describe('updateMemberRole', () => {
  it('changes a role and returns a scoped sync action', async () => {
    const { user } = await addMember(workspace, 'contributor');
    const memberId = await memberIdFor(user.id);

    const result = await updateMemberRole(workspace.admin, memberId, { role: 'member' });
    expect(result.member.role).toBe('member');
    expect(result.actions[0]?.model).toBe('member');
    expect(result.actions[0]?.scopes).toEqual(
      expect.arrayContaining([scopes.organization(workspace.organizationId), scopes.user(user.id)]),
    );
  });

  it('refuses to demote the last admin', async () => {
    const memberId = await memberIdFor(workspace.admin.userId);
    await expect(
      updateMemberRole(workspace.admin, memberId, { role: 'member' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('allows demoting an admin once another admin exists', async () => {
    const { user } = await addMember(workspace, 'admin');
    const memberId = await memberIdFor(user.id);
    const result = await updateMemberRole(workspace.admin, memberId, { role: 'member' });
    expect(result.member.role).toBe('member');
  });

  it('stops a non admin from changing roles', async () => {
    const { principal, user } = await addMember(workspace, 'member');
    const memberId = await memberIdFor(user.id);
    await expect(updateMemberRole(principal, memberId, { role: 'admin' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('removeMember', () => {
  it('unassigns their open issues and drops team memberships', async () => {
    const { user } = await addMember(workspace, 'member');
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Owned',
      assigneeId: user.id,
    });

    const result = await removeMember(workspace.admin, await memberIdFor(user.id));
    expect(result.reassignedIssueIds).toContain(issue.id);

    const [refreshed] = await db.select().from(schema.issue).where(eq(schema.issue.id, issue.id));
    expect(refreshed?.assigneeId).toBeNull();

    const teams = await db
      .select()
      .from(schema.teamMember)
      .where(eq(schema.teamMember.userId, user.id));
    expect(teams).toHaveLength(0);
    expect(result.actions.some((action) => action.action === 'delete')).toBe(true);
  });

  it('reassigns open issues to a replacement', async () => {
    const leaver = await addMember(workspace, 'member');
    const stayer = await addMember(workspace, 'member');
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Handover',
      assigneeId: leaver.user.id,
    });

    await removeMember(workspace.admin, await memberIdFor(leaver.user.id), {
      reassignToUserId: stayer.user.id,
    });

    const [refreshed] = await db.select().from(schema.issue).where(eq(schema.issue.id, issue.id));
    expect(refreshed?.assigneeId).toBe(stayer.user.id);
  });

  it('refuses to remove the last admin', async () => {
    await expect(
      removeMember(workspace.admin, await memberIdFor(workspace.admin.userId)),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('removeMember kills the session', () => {
  it('deletes every session of the removed user in the same transaction', async () => {
    const { user } = await addMember(workspace, 'member');
    await db.insert(schema.session).values({
      id: newId(),
      token: newId(),
      userId: user.id,
      activeOrganizationId: workspace.organizationId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    await removeMember(workspace.admin, await memberIdFor(user.id));

    const sessions = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, user.id));
    expect(sessions).toHaveLength(0);
  });

  it('leaves other people signed in', async () => {
    const leaver = await addMember(workspace, 'member');
    const stayer = await addMember(workspace, 'member');
    await db.insert(schema.session).values({
      id: newId(),
      token: newId(),
      userId: stayer.user.id,
      activeOrganizationId: workspace.organizationId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    await removeMember(workspace.admin, await memberIdFor(leaver.user.id));

    const sessions = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, stayer.user.id));
    expect(sessions).toHaveLength(1);
  });
});
