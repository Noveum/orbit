import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import {
  bindGithubInstallation,
  linkGithubRepository,
  replaceGithubRepositories,
} from '@orbit/services/github';
import { scopes } from '@orbit/shared/events';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  reaches,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';
import {
  createMilestone,
  listMilestones,
  reorderMilestones,
} from '../../src/work/milestone-service.ts';
import {
  addProjectTeam,
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  listProjectsForTeams,
  listProjectTeams,
  listProjectUpdates,
  postProjectUpdate,
  projectProgress,
  removeProjectTeam,
  updateProject,
} from '../../src/work/project-service.ts';

async function newIssue(
  title: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title,
    ...overrides,
  });
  return issue;
}

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

describe('project scope maths', () => {
  it('leaves cancelled work out of scope so a project can reach a hundred percent', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Apollo',
      teamIds: [workspace.teamId],
    });

    const shipped = await newIssue('Shipped', { projectId: project.id });
    const dropped = await newIssue('Dropped', { projectId: project.id });
    await newIssue('Still going', { projectId: project.id });

    await updateIssue(workspace.admin, shipped.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    await updateIssue(workspace.admin, dropped.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });

    const progress = await projectProgress(workspace.admin, project.id);

    expect(progress.scope).toBe(2);
    expect(progress.completed).toBe(1);
    expect(progress.canceled).toBe(1);
  });

  it('reaches a hundred percent when everything left is done', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Gemini',
      teamIds: [workspace.teamId],
    });
    const done = await newIssue('Done', { projectId: project.id });
    const dropped = await newIssue('Dropped', { projectId: project.id });
    await updateIssue(workspace.admin, done.id, { stateId: stateNamed(workspace, 'Done').id });
    await updateIssue(workspace.admin, dropped.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });

    const progress = await projectProgress(workspace.admin, project.id);
    expect(progress.completed).toBe(progress.scope);
  });

  it('hides a project from a team that does not own it', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { principal: outsider } = await addMember(workspace, 'member', {
      teamIds: [other.team.id],
    });
    const { project } = await createProject(workspace.admin, {
      name: 'Private work',
      teamIds: [workspace.teamId],
    });

    await expect(projectProgress(outsider, project.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('a project stays inside the teams it belongs to', () => {
  it('hides another team’s project from a member, and from every entry point', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { project } = await createProject(workspace.admin, {
      name: 'Rebrand',
      teamIds: [other.team.id],
    });
    const { principal: engineer } = await addMember(workspace, 'member');

    expect((await listProjects(engineer)).map((row) => row.id)).not.toContain(project.id);
    await expect(getProject(engineer, project.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(listProjectUpdates(engineer, project.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('still shows a project that belongs to no team in particular', async () => {
    const { project } = await createProject(workspace.admin, { name: 'Company wiki' });
    const { principal: engineer } = await addMember(workspace, 'member');
    expect((await listProjects(engineer)).map((row) => row.id)).toContain(project.id);
  });

  it('refuses a status update written by somebody outside the project teams', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { project } = await createProject(workspace.admin, {
      name: 'Rebrand',
      teamIds: [other.team.id],
    });
    const { principal: lead } = await addMember(workspace, 'admin');
    const { principal: engineer } = await addMember(workspace, 'member');

    await expect(
      postProjectUpdate(engineer, project.id, { health: 'on_track', body: 'All good.' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      (await postProjectUpdate(lead, project.id, { health: 'on_track', body: 'All good.' })).update
        .body,
    ).toBe('All good.');
  });
});

describe('the payload the client boots from', () => {
  it('shows the newest project updates, not the first ever written', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Long running',
      teamIds: [workspace.teamId],
    });
    for (const week of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await postProjectUpdate(workspace.admin, project.id, {
        health: 'on_track',
        body: `Week ${week}`,
      });
    }

    const latest = await listProjectUpdates(workspace.admin, project.id, 2);

    expect(latest).toHaveLength(2);
    expect(latest[0]?.body).toBe('Week Five');
    expect(latest[1]?.body).toBe('Week Four');
  });

  it('keeps a project that belongs to no team in particular', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Company wiki',
      teamIds: [],
    });

    const forTeams = await listProjectsForTeams(workspace.admin, [workspace.teamId]);

    expect(forTeams.map((row) => row.id)).toContain(project.id);
  });

  it('drops an archived project so it leaves the picker', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Finished work',
      teamIds: [workspace.teamId],
    });
    await archiveProject(workspace.admin, project.id);

    const forTeams = await listProjectsForTeams(workspace.admin, [workspace.teamId]);

    expect(forTeams.map((row) => row.id)).not.toContain(project.id);
  });

  it('still returns the team projects a member can reach', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Team work',
      teamIds: [workspace.teamId],
    });

    const forTeams = await listProjectsForTeams(workspace.admin, [workspace.teamId]);

    expect(forTeams.map((row) => row.id)).toContain(project.id);
  });
});

describe('a project delta reaches only the teams that own the project', () => {
  async function outsider() {
    const { team } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { principal } = await addMember(workspace, 'member', {
      name: 'Outsider',
      teamIds: [team.id],
    });
    return principal;
  }

  it('scopes a restricted project to its teams, never to the whole workspace', async () => {
    const stranger = await outsider();
    const { project, actions } = await createProject(workspace.admin, {
      name: 'Restricted',
      teamIds: [workspace.teamId],
    });

    const created = actions[0];
    expect(created?.scopes).toEqual(
      expect.arrayContaining([scopes.team(workspace.teamId), scopes.project(project.id)]),
    );
    expect(created?.scopes).not.toContain(scopes.organization(workspace.organizationId));
    expect(created === undefined ? true : reaches(stranger, created)).toBe(false);
  });

  it('keeps every later restricted project delta away from another team', async () => {
    const stranger = await outsider();
    const { principal: insider } = await addMember(workspace, 'member', {
      name: 'Insider',
      teamIds: [workspace.teamId],
    });
    const { project } = await createProject(workspace.admin, {
      name: 'Restricted',
      teamIds: [workspace.teamId],
    });

    const updated = await updateProject(workspace.admin, project.id, { summary: 'Moving' });
    const posted = await postProjectUpdate(workspace.admin, project.id, {
      health: 'at_risk',
      body: 'Slipping.',
    });
    const archived = await archiveProject(workspace.admin, project.id);
    const removed = await deleteProject(workspace.admin, project.id);

    const emitted = [...updated.actions, ...posted.actions, ...archived.actions, ...removed];
    expect(emitted).toHaveLength(4);
    for (const action of emitted) {
      expect(action.scopes).toContain(scopes.team(workspace.teamId));
      expect(action.scopes).not.toContain(scopes.organization(workspace.organizationId));
      expect(reaches(stranger, action)).toBe(false);
      expect(reaches(insider, action)).toBe(true);
    }
  });

  it('follows the project when its teams change', async () => {
    const stranger = await outsider();
    const { project } = await createProject(workspace.admin, {
      name: 'Handover',
      teamIds: [workspace.teamId],
    });

    const { actions } = await updateProject(workspace.admin, project.id, {
      teamIds: [...stranger.teamIds],
    });

    const action = actions[0];
    expect(action?.scopes).not.toContain(scopes.organization(workspace.organizationId));
    expect(action === undefined ? false : reaches(stranger, action)).toBe(true);
  });

  it('still reaches a member of another team when the project has no teams', async () => {
    const stranger = await outsider();
    const { project, actions } = await createProject(workspace.admin, { name: 'Company wiki' });

    const created = actions[0];
    expect(created?.scopes).toEqual(
      expect.arrayContaining([
        scopes.organization(workspace.organizationId),
        scopes.project(project.id),
      ]),
    );
    expect(created === undefined ? false : reaches(stranger, created)).toBe(true);

    const { actions: renamed } = await updateProject(workspace.admin, project.id, {
      name: 'Company handbook',
    });
    const update = renamed[0];
    expect(update === undefined ? false : reaches(stranger, update)).toBe(true);
  });
});

describe('deleteProject and watched repositories', () => {
  const INSTALLATION_ID = '151887625';
  const REPOSITORY_ID = '884762793';

  async function connectRepository(): Promise<void> {
    await db.transaction(async (tx) => {
      const installation = await bindGithubInstallation(tx, {
        organizationId: workspace.organizationId,
        connectedById: workspace.adminUser.id,
        account: {
          installationId: INSTALLATION_ID,
          accountLogin: 'Noveum',
          accountId: '192082188',
          accountType: 'Organization',
          repositorySelection: 'all',
          suspended: false,
        },
      });
      await replaceGithubRepositories(tx, {
        installation,
        repositories: [
          {
            repositoryId: REPOSITORY_ID,
            repositoryName: 'Noveum/ai-gateway',
            name: 'ai-gateway',
            ownerLogin: 'Noveum',
            private: true,
            archived: false,
            defaultBranch: 'main',
            htmlUrl: 'https://github.com/Noveum/ai-gateway',
          },
        ],
      });
    });
  }

  async function counts(): Promise<{ links: number; watched: number }> {
    const links = await db
      .select({ id: schema.githubRepositoryLink.id })
      .from(schema.githubRepositoryLink)
      .where(eq(schema.githubRepositoryLink.organizationId, workspace.organizationId));
    const watched = await db
      .select({ id: schema.githubRepositorySync.id })
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.organizationId, workspace.organizationId));
    return { links: links.length, watched: watched.length };
  }

  async function associate(projectId: string): Promise<void> {
    await db.transaction(async (tx) =>
      linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: REPOSITORY_ID,
        projectId,
        linkedById: workspace.adminUser.id,
      }),
    );
  }

  it('stops watching a repository whose only project has been deleted', async () => {
    await connectRepository();
    const { project } = await createProject(workspace.admin, { name: 'Gateway' });
    await associate(project.id);
    expect(await counts()).toEqual({ links: 1, watched: 1 });

    await deleteProject(workspace.admin, project.id);

    expect(await counts()).toEqual({ links: 0, watched: 0 });
  });

  it('keeps watching a repository another project still associates', async () => {
    await connectRepository();
    const { project: doomed } = await createProject(workspace.admin, { name: 'Doomed' });
    const { project: kept } = await createProject(workspace.admin, { name: 'Kept' });
    await associate(doomed.id);
    await associate(kept.id);

    await deleteProject(workspace.admin, doomed.id);

    expect(await counts()).toEqual({ links: 1, watched: 1 });
  });
});
