import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, moveIssue, updateIssue } from '../../src/work/issue-service.ts';
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

describe('narrowing a label to a team takes it off the issues that team cannot see', () => {
  async function labelIdsOn(issueId: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(schema.issueLabel)
      .where(eq(schema.issueLabel.issueId, issueId));
    return rows.map((row) => row.labelId);
  }

  it('detaches it from an issue on another team and leaves the issue on its own team alone', async () => {
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const outside = await createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Platform work',
      labelIds: [shared.label.id],
    });
    const inside = await createIssue(nova.admin, {
      teamId: designTeamId,
      title: 'Design work',
      labelIds: [shared.label.id],
    });

    await updateLabel(nova.admin, shared.label.id, { teamId: designTeamId });

    expect(await labelIdsOn(outside.issue.id)).toEqual([]);
    expect(await labelIdsOn(inside.issue.id)).toEqual([shared.label.id]);
  });

  it('keeps the other labels of the issue it strips', async () => {
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const kept = await createLabel(nova.admin, { name: 'Slow', color: '#22C55E' });
    const outside = await createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Platform work',
      labelIds: [shared.label.id, kept.label.id],
    });

    await updateLabel(nova.admin, shared.label.id, { teamId: designTeamId });

    expect(await labelIdsOn(outside.issue.id)).toEqual([kept.label.id]);
  });

  it('tells the issue audience, so a live board drops the chip without a refetch', async () => {
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const kept = await createLabel(nova.admin, { name: 'Slow', color: '#22C55E' });
    const outside = await createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Platform work',
      labelIds: [shared.label.id, kept.label.id],
    });
    const [before] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, outside.issue.id));

    const result = await updateLabel(nova.admin, shared.label.id, { teamId: designTeamId });

    const issueAction = result.actions.find((action) => action.model === 'issue');
    expect(issueAction?.modelId).toBe(outside.issue.id);
    expect(issueAction?.data['labelIds']).toEqual([kept.label.id]);
    expect(issueAction?.scopes).toContain(scopes.team(nova.teamId));
    expect(issueAction?.scopes).not.toContain(scopes.team(designTeamId));
    const [after] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, outside.issue.id));
    expect(after?.syncId).toBeGreaterThan(before?.syncId ?? 0);
  });

  it('touches nothing when the label widens back to the whole workspace', async () => {
    const teamOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });
    const inside = await createIssue(nova.admin, {
      teamId: designTeamId,
      title: 'Design work',
      labelIds: [teamOnly.label.id],
    });

    const result = await updateLabel(nova.admin, teamOnly.label.id, { teamId: null });

    expect(await labelIdsOn(inside.issue.id)).toEqual([teamOnly.label.id]);
    expect(result.actions.filter((action) => action.model === 'issue')).toHaveLength(0);
  });
});

describe('carrying an issue to another team drops the labels that team cannot use', () => {
  async function labelIdsOn(issueId: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(schema.issueLabel)
      .where(eq(schema.issueLabel.issueId, issueId));
    return rows.map((row) => row.labelId);
  }

  it('strips the old team label, keeps the workspace one, and says so over the wire', async () => {
    const designOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const issue = await createIssue(nova.admin, {
      teamId: designTeamId,
      title: 'Design work',
      labelIds: [designOnly.label.id, shared.label.id],
    });

    const moved = await moveIssue(nova.admin, issue.issue.id, {
      teamId: nova.teamId,
      stateId: stateNamed(nova, 'Todo').id,
    });

    expect(moved.issue.teamId).toBe(nova.teamId);
    expect(await labelIdsOn(issue.issue.id)).toEqual([shared.label.id]);
    const action = moved.actions.find(
      (entry) => entry.model === 'issue' && entry.modelId === issue.issue.id,
    );
    expect(action?.data['labelIds']).toEqual([shared.label.id]);
    expect(action?.scopes).toContain(scopes.team(nova.teamId));
  });

  it('takes it off the issue that moved and off no other', async () => {
    const designOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });
    const leaving = await createIssue(nova.admin, {
      teamId: designTeamId,
      title: 'Design work',
      labelIds: [designOnly.label.id],
    });
    const staying = await createIssue(nova.admin, {
      teamId: designTeamId,
      title: 'More design work',
      labelIds: [designOnly.label.id],
    });

    await moveIssue(nova.admin, leaving.issue.id, {
      teamId: nova.teamId,
      stateId: stateNamed(nova, 'Todo').id,
    });

    expect(await labelIdsOn(leaving.issue.id)).toEqual([]);
    expect(await labelIdsOn(staying.issue.id)).toEqual([designOnly.label.id]);
  });

  it('leaves the labels alone when the move keeps the issue on its own team', async () => {
    const designOnly = await createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    });
    const issue = await createIssue(nova.admin, {
      teamId: designTeamId,
      title: 'Design work',
      labelIds: [designOnly.label.id],
    });

    await moveIssue(nova.admin, issue.issue.id, {});

    expect(await labelIdsOn(issue.issue.id)).toEqual([designOnly.label.id]);
  });
});

describe('a patch that changes nothing changes nothing', () => {
  it('does not bump the sync id and does not fan out', async () => {
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });

    const empty = await updateLabel(nova.admin, shared.label.id, {});
    const same = await updateLabel(nova.admin, shared.label.id, {
      name: 'Flaky',
      color: '#EF4444',
      teamId: null,
    });

    expect(empty.actions).toHaveLength(0);
    expect(same.actions).toHaveLength(0);
    expect((await rowById(shared.label.id))?.syncId).toBe(shared.label.syncId);
  });

  it('still fans out when one field really moves', async () => {
    const shared = await createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });

    const changed = await updateLabel(nova.admin, shared.label.id, {
      name: 'Flaky',
      color: '#22C55E',
    });

    expect(changed.actions).toHaveLength(1);
    expect((await rowById(shared.label.id))?.color).toBe('#22C55E');
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
