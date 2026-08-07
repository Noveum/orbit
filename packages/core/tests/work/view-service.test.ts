import { beforeEach, describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { VirtualViewId } from '@orbit/shared/filters';
import { VIRTUAL_VIEW_IDS, virtualViewState } from '@orbit/shared/filters';
import type { Principal } from '@orbit/shared/policy';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  reaches,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, listIssues } from '../../src/work/issue-service.ts';
import {
  createView,
  deleteView,
  getView,
  listViews,
  setViewFavorite,
  updateView,
} from '../../src/work/view-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

function privateInput(name: string) {
  return { name, filter: { groupBy: 'state', visibility: 'private' } };
}

function sharedInput(name: string) {
  return { name, filter: { groupBy: 'state', visibility: 'workspace' } };
}

function only(actions: readonly SyncAction[]): SyncAction {
  const [action] = actions;
  if (action === undefined) throw new Error('no sync action was published');
  return action;
}

describe('a saved view only reaches the people who can open it', () => {
  it('keeps a private view on its owner scope alone', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, privateInput('My work'));

    const insert = only(created.actions);
    expect(insert.scopes).toEqual([scopes.user(workspace.admin.userId)]);
    expect(insert.scopes).not.toContain(scopes.organization(workspace.organizationId));
    expect(reaches(colleague, insert)).toBe(false);
    expect(reaches(workspace.admin, insert)).toBe(true);
  });

  it('keeps every later delta of a private view off the workspace scope', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, privateInput('My work'));

    const renamed = await updateView(workspace.admin, created.view.id, { name: 'Still mine' });
    const removed = await deleteView(workspace.admin, created.view.id);

    for (const action of [...renamed.actions, ...removed]) {
      expect(action.scopes).not.toContain(scopes.organization(workspace.organizationId));
      expect(reaches(colleague, action)).toBe(false);
      expect(reaches(workspace.admin, action)).toBe(true);
    }
  });

  it('never carries the filter of a private view in a delta anyone else receives', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, privateInput('Layoff planning'));

    const insert = only(created.actions);
    expect(JSON.stringify(insert.data)).toContain('Layoff planning');
    expect(reaches(colleague, insert)).toBe(false);
  });

  it('still announces a shared view to the whole workspace', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, sharedInput('Team triage'));

    const insert = only(created.actions);
    expect(insert.scopes).toContain(scopes.organization(workspace.organizationId));
    expect(reaches(colleague, insert)).toBe(true);

    const renamed = await updateView(workspace.admin, created.view.id, { name: 'Triage' });
    expect(reaches(colleague, only(renamed.actions))).toBe(true);
    expect((await listViews(colleague)).some((view) => view.id === created.view.id)).toBe(true);
  });

  it('tells the workspace a view is gone when its owner makes it private', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, sharedInput('Team triage'));

    const { actions } = await updateView(workspace.admin, created.view.id, {
      filter: { ...created.view.state, visibility: 'private' },
    });

    const forEveryoneElse = actions.filter((action) => reaches(colleague, action));
    expect(forEveryoneElse).toHaveLength(1);
    expect(forEveryoneElse[0]?.action).toBe('delete');
    expect(JSON.stringify(forEveryoneElse[0]?.data)).not.toContain('Team triage');
    expect((await listViews(colleague)).some((view) => view.id === created.view.id)).toBe(false);

    const forTheOwner = actions.filter((action) => action.action !== 'delete');
    expect(forTheOwner).toHaveLength(1);
    expect(forTheOwner[0]?.scopes).toEqual([scopes.user(workspace.admin.userId)]);
  });
});

describe('a team view stays inside the team it belongs to', () => {
  interface TwoTeams {
    readonly designTeamId: string;
    readonly engineer: Principal;
    readonly teammate: Principal;
    readonly designer: Principal;
  }

  async function twoTeams(): Promise<TwoTeams> {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const engineer = await addMember(workspace, 'member', {
      name: 'Engineer',
      teamIds: [workspace.teamId, design.team.id],
    });
    const teammate = await addMember(workspace, 'member', { name: 'Teammate' });
    const designer = await addMember(workspace, 'member', {
      name: 'Designer',
      teamIds: [design.team.id],
    });
    return {
      designTeamId: design.team.id,
      engineer: engineer.principal,
      teammate: teammate.principal,
      designer: designer.principal,
    };
  }

  function teamInput(name: string, teamId: string) {
    return { name, filter: { groupBy: 'state', visibility: 'team', teamId } };
  }

  async function listedIds(principal: Principal): Promise<string[]> {
    return (await listViews(principal)).map((view) => view.id);
  }

  it('publishes a team view to that team alone', async () => {
    const { engineer, teammate, designer } = await twoTeams();

    const created = await createView(engineer, teamInput('Engineering triage', workspace.teamId));

    const insert = only(created.actions);
    expect(insert.scopes).toEqual([scopes.team(workspace.teamId), scopes.user(engineer.userId)]);
    expect(insert.scopes).not.toContain(scopes.organization(workspace.organizationId));
    expect(reaches(teammate, insert)).toBe(true);
    expect(reaches(designer, insert)).toBe(false);
  });

  it('never carries the filter of a team view in a delta another team receives', async () => {
    const { engineer, designer } = await twoTeams();

    const created = await createView(engineer, teamInput('Reorg candidates', workspace.teamId));

    const insert = only(created.actions);
    expect(JSON.stringify(insert.data)).toContain('Reorg candidates');
    expect(reaches(designer, insert)).toBe(false);
  });

  it('lists a team view for the team and hides it from everyone else', async () => {
    const { engineer, teammate, designer } = await twoTeams();

    const created = await createView(engineer, teamInput('Engineering triage', workspace.teamId));

    expect(await listedIds(teammate)).toContain(created.view.id);
    expect(await listedIds(designer)).not.toContain(created.view.id);
  });

  it('refuses to open a team view from another team', async () => {
    const { engineer, teammate, designer } = await twoTeams();

    const created = await createView(engineer, teamInput('Engineering triage', workspace.teamId));

    expect((await getView(teammate, created.view.id)).name).toBe('Engineering triage');
    expect(getView(designer, created.view.id)).rejects.toThrow(/not shared with you/);
    expect(setViewFavorite(designer, created.view.id, { favorite: true })).rejects.toThrow(
      /not shared with you/,
    );
  });

  it('keeps every later delta of a team view off the workspace scope', async () => {
    const { engineer, designer } = await twoTeams();
    const created = await createView(engineer, teamInput('Engineering triage', workspace.teamId));

    const renamed = await updateView(engineer, created.view.id, { name: 'Triage' });
    const removed = await deleteView(engineer, created.view.id);

    for (const action of [...renamed.actions, ...removed]) {
      expect(action.scopes).not.toContain(scopes.organization(workspace.organizationId));
      expect(reaches(designer, action)).toBe(false);
    }
  });

  it('tells the workspace a view is gone when its owner narrows it to one team', async () => {
    const { engineer, teammate, designer } = await twoTeams();
    const created = await createView(engineer, sharedInput('Everything'));
    expect(await listedIds(designer)).toContain(created.view.id);

    const { actions } = await updateView(engineer, created.view.id, {
      filter: { ...created.view.state, visibility: 'team', teamId: workspace.teamId },
    });

    const forTheOtherTeam = actions.filter((action) => reaches(designer, action));
    expect(forTheOtherTeam).toHaveLength(1);
    expect(forTheOtherTeam[0]?.action).toBe('delete');
    expect(JSON.stringify(forTheOtherTeam[0]?.data)).not.toContain('Everything');
    expect(await listedIds(designer)).not.toContain(created.view.id);
    expect(await listedIds(teammate)).toContain(created.view.id);
  });

  it('drops the old team when a view moves to another one', async () => {
    const { designTeamId, engineer, teammate, designer } = await twoTeams();
    const created = await createView(engineer, teamInput('Triage', workspace.teamId));

    const { actions } = await updateView(engineer, created.view.id, {
      filter: { ...created.view.state, visibility: 'team', teamId: designTeamId },
    });

    const forTheOldTeam = actions.filter((action) => reaches(teammate, action));
    expect(forTheOldTeam).toHaveLength(1);
    expect(forTheOldTeam[0]?.action).toBe('delete');
    expect(await listedIds(teammate)).not.toContain(created.view.id);
    expect(await listedIds(designer)).toContain(created.view.id);
  });

  it('takes nothing away when a team view opens up to the whole workspace', async () => {
    const { engineer, teammate, designer } = await twoTeams();
    const created = await createView(engineer, teamInput('Triage', workspace.teamId));

    const { actions } = await updateView(engineer, created.view.id, {
      filter: { ...created.view.state, visibility: 'workspace' },
    });

    expect(actions.filter((action) => action.action === 'delete')).toHaveLength(0);
    expect(reaches(designer, only(actions))).toBe(true);
    expect(await listedIds(designer)).toContain(created.view.id);
    expect(await listedIds(teammate)).toContain(created.view.id);
  });

  it('refuses to publish a view to a team the author is not on', async () => {
    const { designer } = await twoTeams();

    expect(
      createView(designer, teamInput('Peek at engineering', workspace.teamId)),
    ).rejects.toThrow(/not a member of that team/);
  });

  it('refuses a team view that names no team', async () => {
    const { engineer } = await twoTeams();

    expect(
      createView(engineer, { name: 'Nowhere', filter: { visibility: 'team' } }),
    ).rejects.toThrow(/Pick the team/);
  });
});

describe('the built-in views select the issues they promise', () => {
  async function issueNamed(
    title: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title,
      ...overrides,
    });
    return issue.id;
  }

  function stateFor(id: VirtualViewId) {
    return virtualViewState(id, workspace.admin.userId);
  }

  async function titlesFor(id: VirtualViewId): Promise<string[]> {
    const page = await listIssues(workspace.admin, { filter: stateFor(id).filter });
    return page.issues.map((issue) => issue.title).sort();
  }

  it('keeps only issues with nobody assigned in the unassigned view', async () => {
    const { user: teammate } = await addMember(workspace, 'member', { name: 'Teammate' });
    await issueNamed('Nobody owns this');
    await issueNamed('Someone owns this', { assigneeId: teammate.id });

    expect(await titlesFor('virtual:unassigned')).toEqual(['Nobody owns this']);
  });

  it('keeps only issues whose due date has passed in the overdue view', async () => {
    await issueNamed('Late', { dueDate: '2020-01-01' });
    await issueNamed('Not due for ages', { dueDate: '2999-01-01' });
    await issueNamed('No due date at all');

    expect(await titlesFor('virtual:overdue')).toEqual(['Late']);
  });

  it('keeps every issue in the all issues view and only mine in the assigned view', async () => {
    const { user: teammate } = await addMember(workspace, 'member', { name: 'Teammate' });
    await issueNamed('Mine', { assigneeId: workspace.admin.userId });
    await issueNamed('Theirs', { assigneeId: teammate.id });

    expect(await titlesFor('virtual:all')).toEqual(['Mine', 'Theirs']);
    expect(await titlesFor('virtual:assigned')).toEqual(['Mine']);
  });

  it('offers every built-in to a brand new workspace with nothing saved', async () => {
    const listed = await listViews(workspace.admin);
    expect(listed.filter((view) => view.virtual).map((view) => view.id)).toEqual([
      ...VIRTUAL_VIEW_IDS,
    ]);
    expect(listed.filter((view) => !view.virtual)).toHaveLength(0);
  });

  it('hides finished work from the triage built-ins so they stay actionable', () => {
    expect(stateFor('virtual:unassigned').display.showCompleted).toBe('none');
    expect(stateFor('virtual:overdue').display.showCompleted).toBe('none');
    expect(stateFor('virtual:all').display.showCompleted).toBe('all');
  });
});
