import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';
import {
  createLabel,
  deleteLabel,
  getLabel,
  type LabelRow,
  listLabels,
  updateLabel,
} from '../../src/work/label-service.ts';

let nova: Workspace;
let orion: Workspace;
let designTeamId: string;
let designMember: Principal;
let platformMember: Principal;

beforeEach(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
  orion = await createWorkspace('Orion');
  const design = await createTeam(nova.admin, { name: 'Design', key: 'DSGN' });
  designTeamId = design.team.id;
  designMember = (await addMember(nova, 'member', { teamIds: [designTeamId] })).principal;
  platformMember = (await addMember(nova, 'member', { teamIds: [nova.teamId] })).principal;
});

async function errorOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    const thrown = error as { code?: unknown };
    return typeof thrown.code === 'string' ? thrown.code : 'not-a-domain-error';
  }
  throw new Error('the call was expected to throw and did not');
}

async function rowById(labelId: string): Promise<LabelRow | undefined> {
  const [row] = await db.select().from(schema.label).where(eq(schema.label.id, labelId)).limit(1);
  return row;
}

describe('a team label is fanned out to that team only', () => {
  it('gives a workspace label the org scope and a team label the team scope, never both', async () => {
    const workspaceWide = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const teamOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });

    expect(workspaceWide.actions[0]?.scopes).toEqual([scopes.organization(nova.organizationId)]);
    expect(teamOnly.actions[0]?.scopes).toEqual([scopes.team(designTeamId)]);
    expect(teamOnly.actions[0]?.scopes).not.toContain(scopes.organization(nova.organizationId));
  });

  it('reaches the audience that is losing it and the audience that is gaining it on a move', async () => {
    const created = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });

    const narrowed = await updateLabel(nova.admin, created.label.id, { teamId: designTeamId });

    expect(narrowed.actions[0]?.scopes.slice().sort()).toEqual(
      [scopes.organization(nova.organizationId), scopes.team(designTeamId)].sort(),
    );
  });

  it('deletes a team label to the team that could see it', async () => {
    const teamOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });

    const actions = await deleteLabel(nova.admin, teamOnly.label.id);

    expect(actions[0]?.scopes).toEqual([scopes.team(designTeamId)]);
  });
});

describe('a team label is invisible to a member of another team', () => {
  it('hides it from a list, a read, an edit and a delete, while the admin still sees it', async () => {
    const teamOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });

    expect((await listLabels(designMember)).map((row) => row.id)).toContain(teamOnly.label.id);
    expect((await listLabels(platformMember)).map((row) => row.id)).not.toContain(
      teamOnly.label.id,
    );
    expect((await listLabels(nova.admin)).map((row) => row.id)).toContain(teamOnly.label.id);

    expect(await errorOf(() => getLabel(platformMember, teamOnly.label.id))).toBe('not_found');
    expect(
      await errorOf(() => updateLabel(platformMember, teamOnly.label.id, { name: 'Taken' })),
    ).toBe('not_found');
    expect(await errorOf(() => deleteLabel(platformMember, teamOnly.label.id))).toBe('not_found');
    expect((await rowById(teamOnly.label.id))?.name).toBe('Pixel polish');
  });

  it('still shows a workspace label to everybody', async () => {
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });

    expect((await listLabels(platformMember)).map((row) => row.id)).toContain(shared.label.id);
    expect((await getLabel(platformMember, shared.label.id)).name).toBe('Flaky');
  });
});

describe('a label cannot be pinned to a team the writer has no claim on', () => {
  it('refuses a team in another workspace on create and writes nothing', async () => {
    const before = await db.select().from(schema.label);

    expect(
      await errorOf(() =>
        createLabel(nova.admin, { name: 'Stolen', color: '#EF4444', teamId: orion.teamId }),
      ),
    ).toBe('not_found');

    expect(await db.select().from(schema.label)).toHaveLength(before.length);
  });

  it('refuses a team in another workspace on update and leaves the label workspace wide', async () => {
    const created = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });

    expect(
      await errorOf(() => updateLabel(nova.admin, created.label.id, { teamId: orion.teamId })),
    ).toBe('not_found');

    expect((await rowById(created.label.id))?.teamId).toBeNull();
  });

  it('refuses a team of this workspace that the writer has not joined', async () => {
    expect(
      await errorOf(() =>
        createLabel(platformMember, {
          name: 'Pixel polish',
          color: '#EC4899',
          teamId: designTeamId,
        }),
      ),
    ).toBe('forbidden');
  });
});

describe('an issue can only carry a label its team is allowed', () => {
  it('refuses a label pinned to another team, and refuses one from another workspace', async () => {
    const designOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });
    const foreign = await createLabel(orion.admin, { name: 'Theirs', color: '#22C55E' });

    expect(
      await errorOf(() =>
        createIssue(nova.admin, {
          teamId: nova.teamId,
          title: 'Borrowed',
          labelIds: [designOnly.label.id],
        }),
      ),
    ).toBe('validation_failed');
    expect(
      await errorOf(() =>
        createIssue(nova.admin, {
          teamId: nova.teamId,
          title: 'Borrowed',
          labelIds: [foreign.label.id],
        }),
      ),
    ).toBe('validation_failed');
  });

  it('refuses the same reach on an update and leaves the issue labels alone', async () => {
    const designOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const created = await createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Mine',
      labelIds: [shared.label.id],
    });

    expect(
      await errorOf(() =>
        updateIssue(nova.admin, created.issue.id, { labelIds: [designOnly.label.id] }),
      ),
    ).toBe('validation_failed');

    const links = await db
      .select()
      .from(schema.issueLabel)
      .where(eq(schema.issueLabel.issueId, created.issue.id));
    expect(links.map((row) => row.labelId)).toEqual([shared.label.id]);
  });

  it('still accepts a workspace label and a label of the issue own team', async () => {
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const designOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });

    const created = await createIssue(nova.admin, {
      teamId: designTeamId,
      title: 'Design work',
      labelIds: [shared.label.id, designOnly.label.id],
    });

    const links = await db
      .select()
      .from(schema.issueLabel)
      .where(eq(schema.issueLabel.issueId, created.issue.id));
    expect(links.map((row) => row.labelId).sort()).toEqual(
      [shared.label.id, designOnly.label.id].sort(),
    );
  });
});

describe('two labels cannot share a name in the same place', () => {
  it('answers a duplicate workspace name with a conflict, not a server fault', async () => {
    await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });

    expect(await errorOf(() => createLabel(nova.admin, { name: 'Flaky', color: '#22C55E' }))).toBe(
      'conflict',
    );
  });

  it('answers a rename onto a taken name with a conflict', async () => {
    await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const second = await createLabel(nova.admin, { name: 'Slow', color: '#22C55E' });

    expect(await errorOf(() => updateLabel(nova.admin, second.label.id, { name: 'Flaky' }))).toBe(
      'conflict',
    );
    expect((await rowById(second.label.id))?.name).toBe('Slow');
  });

  it('lets two teams each hold a label of the same name', async () => {
    const first = await createLabel(nova.admin, {
      name: 'Polish',
      color: '#EF4444',
      teamId: designTeamId,
    });
    const second = await createLabel(nova.admin, {
      name: 'Polish',
      color: '#22C55E',
      teamId: nova.teamId,
    });

    expect(first.label.id).not.toBe(second.label.id);
  });
});
