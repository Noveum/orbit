import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
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
