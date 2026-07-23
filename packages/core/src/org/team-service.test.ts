import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { addMember, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  addTeamMember,
  createTeam,
  getTeam,
  listTeamMembers,
  removeTeamMember,
} from './team-service.ts';

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
