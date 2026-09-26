import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { preparePersonalAgentConsent } from '../../src/auth/agent-identity-service.ts';
import { recordMcpGrant } from '../../src/auth/mcp-token.ts';
import { newId } from '../../src/internal.ts';
import {
  addTeamMember,
  archiveTeam,
  createTeam,
  getTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  restoreTeam,
} from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';

let nova: Workspace;
let vega: Workspace;

beforeEach(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
  vega = await createWorkspace('Vega');
});

async function teamMemberCount(teamId: string, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.teamMember)
    .where(and(eq(schema.teamMember.teamId, teamId), eq(schema.teamMember.userId, userId)));
  return rows.length;
}

async function agentFor(ownerUserId: string): Promise<string> {
  const clientId = newId();
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    clientId,
    name: 'Team service test client',
    redirectUrls: 'https://example.com/callback',
    type: 'public',
  });
  const { identity } = await db.transaction((tx) =>
    preparePersonalAgentConsent(tx, {
      userId: ownerUserId,
      organizationId: nova.organizationId,
      clientId,
      selection: { createAgent: { name: 'Researcher', avatar: null } },
    }),
  );
  await recordMcpGrant({
    clientId,
    userId: ownerUserId,
    organizationId: nova.organizationId,
    scopes: 'orbit.read',
    agentIdentityId: identity.id,
  });
  return identity.id;
}

describe('cross tenant team access', () => {
  it('refuses to remove a member of another workspace and mutates nothing', async () => {
    const outsider = await addMember(vega, 'member');
    expect(await teamMemberCount(vega.teamId, outsider.user.id)).toBe(1);

    await expect(removeTeamMember(nova.admin, vega.teamId, outsider.user.id)).rejects.toMatchObject(
      { code: 'not_found' },
    );

    expect(await teamMemberCount(vega.teamId, outsider.user.id)).toBe(1);
  });

  it('refuses to list the roster of another workspace', async () => {
    await expect(listTeamMembers(nova.admin, vega.teamId)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('refuses to read a team of another workspace', async () => {
    await expect(getTeam(nova.admin, vega.teamId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses to add anybody to a team of another workspace', async () => {
    const insider = await addMember(nova, 'member');
    await expect(
      addTeamMember(nova.admin, vega.teamId, { userId: insider.user.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await teamMemberCount(vega.teamId, insider.user.id)).toBe(0);
  });
});

describe('team membership boundary inside one workspace', () => {
  it('keeps a roster away from a member of another team', async () => {
    const { team } = await createTeam(nova.admin, { name: 'Design', key: 'DES' });
    const engineer = await addMember(nova, 'member', { teamIds: [nova.teamId] });

    await expect(listTeamMembers(engineer.principal, team.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await listTeamMembers(engineer.principal, nova.teamId)).toHaveLength(2);
  });

  it('clears open review responsibility when a member loses team access', async () => {
    const reviewer = await addMember(nova, 'member', { teamIds: [nova.teamId] });
    const { issue } = await createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Protect reviewer access',
      reviewerIds: [reviewer.user.id],
    });

    await removeTeamMember(nova.admin, nova.teamId, reviewer.user.id);
    expect(
      await db
        .select()
        .from(schema.issueReviewer)
        .where(eq(schema.issueReviewer.issueId, issue.id)),
    ).toHaveLength(0);
    expect(await teamMemberCount(nova.teamId, reviewer.user.id)).toBe(0);
  });

  it('clears Agent assignments only in a team its owner leaves', async () => {
    const { team: otherTeam } = await createTeam(nova.admin, {
      name: 'Research',
      key: 'RES',
    });
    const owner = await addMember(nova, 'member', { teamIds: [nova.teamId, otherTeam.id] });
    const agentId = await agentFor(owner.user.id);
    const { issue: removedTeamIssue } = await createIssue(owner.principal, {
      teamId: nova.teamId,
      title: 'Agent assignment in removed team',
      assigneeAgentId: agentId,
    });
    const { issue: retainedTeamIssue } = await createIssue(owner.principal, {
      teamId: otherTeam.id,
      title: 'Agent assignment in retained team',
      assigneeAgentId: agentId,
    });
    await updateIssue(nova.admin, removedTeamIssue.id, { ownerUserId: nova.adminUser.id });
    await updateIssue(nova.admin, retainedTeamIssue.id, { ownerUserId: nova.adminUser.id });

    const actions = await removeTeamMember(nova.admin, nova.teamId, owner.user.id);
    const [cleared] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, removedTeamIssue.id));
    const [retained] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, retainedTeamIssue.id));
    const issueAction = actions.find((action) => action.modelId === removedTeamIssue.id);
    const activity = await db
      .select()
      .from(schema.issueActivity)
      .where(eq(schema.issueActivity.issueId, removedTeamIssue.id));

    expect(cleared?.assigneeAgentId).toBeNull();
    expect(cleared?.ownerUserId).toBe(nova.adminUser.id);
    expect(retained?.assigneeAgentId).toBe(agentId);
    expect(retained?.ownerUserId).toBe(nova.adminUser.id);
    expect(issueAction?.data['assigneeAgentId']).toBeNull();
    expect(activity.at(-1)).toMatchObject({
      actorType: 'system',
      cause: 'team_access_lost',
      causeActorId: nova.adminUser.id,
      fromValue: { type: 'agent', id: agentId },
      toValue: null,
      syncId: cleared?.syncId,
    });
  });
});

describe('archiving and restoring a team', () => {
  it('takes an archived team out of the default listing and puts it back on restore', async () => {
    const { team } = await createTeam(nova.admin, { name: 'Design', key: 'DES' });

    await archiveTeam(nova.admin, team.id);
    expect((await listTeams(nova.admin)).map((entry) => entry.id)).not.toContain(team.id);
    expect(
      (await listTeams(nova.admin, { includeArchived: true })).map((entry) => entry.id),
    ).toContain(team.id);

    const restored = await restoreTeam(nova.admin, team.id);
    expect(restored.team.archivedAt).toBeNull();
    expect((await listTeams(nova.admin)).map((entry) => entry.id)).toContain(team.id);
  });

  it('leaves the issues of an archived team where they are', async () => {
    const { team } = await createTeam(nova.admin, { name: 'Design', key: 'DES' });
    await archiveTeam(nova.admin, team.id);

    const rows = await db.select().from(schema.team).where(eq(schema.team.id, team.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.archivedAt).not.toBeNull();
  });

  it('refuses to restore a team of another workspace', async () => {
    await archiveTeam(vega.admin, vega.teamId);
    await expect(restoreTeam(nova.admin, vega.teamId)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('refuses to archive or restore for a role without team:manage', async () => {
    const member = await addMember(nova, 'member', { teamIds: [nova.teamId] });
    await expect(archiveTeam(member.principal, nova.teamId)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(restoreTeam(member.principal, nova.teamId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
