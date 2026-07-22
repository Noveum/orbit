import { scopes } from '@orbit/shared/events';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../test-support.ts';
import { createIssue, updateIssue } from './issue-service.ts';
import { createMilestone, listMilestones, reorderMilestones } from './milestone-service.ts';
import {
  addProjectTeam,
  createProject,
  listProjects,
  listProjectTeams,
  postProjectUpdate,
  projectProgress,
  removeProjectTeam,
  updateProject,
} from './project-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newProject(name = 'Launch') {
  const { project } = await createProject(workspace.admin, {
    name,
    teamIds: [workspace.teamId],
  });
  return project;
}

describe('createProject', () => {
  it('allocates a unique slug and links teams', async () => {
    const first = await newProject();
    const second = await newProject();
    expect(first.slug).toBe('launch');
    expect(second.slug).toBe('launch-2');

    const teams = await listProjectTeams(workspace.admin, first.id);
    expect(teams.map((row) => row.teamId)).toEqual([workspace.teamId]);
  });

  it('refuses a contributor', async () => {
    const { principal } = await addMember(workspace, 'contributor');
    await expect(createProject(principal, { name: 'Nope' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('updateProject', () => {
  it('keeps unspecified fields untouched', async () => {
    const project = await newProject();
    const { project: updated, actions } = await updateProject(workspace.admin, project.id, {
      summary: 'Now with a summary',
    });

    expect(updated.summary).toBe('Now with a summary');
    expect(updated.name).toBe(project.name);
    expect(updated.status).toBe(project.status);
    expect(updated.health).toBe(project.health);
    expect(actions[0]?.scopes).toContain(scopes.project(project.id));

    const teams = await listProjectTeams(workspace.admin, project.id);
    expect(teams).toHaveLength(1);
  });
});

describe('project teams', () => {
  it('adds and removes a team', async () => {
    const project = await newProject();
    await removeProjectTeam(workspace.admin, project.id, workspace.teamId);
    expect(await listProjectTeams(workspace.admin, project.id)).toHaveLength(0);

    const actions = await addProjectTeam(workspace.admin, project.id, workspace.teamId);
    expect(actions[0]?.scopes).toContain(scopes.team(workspace.teamId));
    expect(await listProjectTeams(workspace.admin, project.id)).toHaveLength(1);
  });
});

describe('postProjectUpdate', () => {
  it('records the update and moves the project health', async () => {
    const project = await newProject();
    const result = await postProjectUpdate(workspace.admin, project.id, {
      health: 'at_risk',
      body: 'Slipping a week.',
    });
    expect(result.update.health).toBe('at_risk');
    expect(result.project.health).toBe('at_risk');
  });
});

describe('projectProgress', () => {
  it('counts scope, started, completed, and per milestone completion', async () => {
    const project = await newProject();
    const { milestone } = await createMilestone(workspace.admin, {
      projectId: project.id,
      name: 'Alpha',
    });

    const inMilestone = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Milestone work',
      projectId: project.id,
      milestoneId: milestone.id,
    });
    const started = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'In flight',
      projectId: project.id,
    });
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Not started',
      projectId: project.id,
    });

    await updateIssue(workspace.admin, started.issue.id, {
      stateId: stateNamed(workspace, 'In Progress').id,
    });
    await updateIssue(workspace.admin, inMilestone.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });

    const progress = await projectProgress(workspace.admin, project.id);
    expect(progress.scope).toBe(3);
    expect(progress.started).toBe(1);
    expect(progress.completed).toBe(1);
    expect(progress.milestones).toEqual([
      { milestoneId: milestone.id, name: 'Alpha', scope: 1, completed: 1 },
    ]);
  });
});

describe('milestones', () => {
  it('reorders milestones', async () => {
    const project = await newProject();
    const first = await createMilestone(workspace.admin, { projectId: project.id, name: 'One' });
    const second = await createMilestone(workspace.admin, { projectId: project.id, name: 'Two' });

    const { milestones } = await reorderMilestones(workspace.admin, project.id, [
      second.milestone.id,
      first.milestone.id,
    ]);
    expect(milestones.map((row) => row.name)).toEqual(['Two', 'One']);

    const listed = await listMilestones(workspace.admin, project.id);
    expect(listed.map((row) => row.name)).toEqual(['Two', 'One']);
  });

  it('refuses milestones from another project', async () => {
    const project = await newProject();
    const other = await newProject('Other');
    const stray = await createMilestone(workspace.admin, { projectId: other.id, name: 'Stray' });
    await expect(
      reorderMilestones(workspace.admin, project.id, [stray.milestone.id]),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('listProjects', () => {
  it('hides archived projects by default', async () => {
    await newProject();
    expect(await listProjects(workspace.admin)).toHaveLength(1);
  });
});
