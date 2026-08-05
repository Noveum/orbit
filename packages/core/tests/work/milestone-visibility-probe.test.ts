import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  updateMilestone,
} from '../../src/work/milestone-service.ts';
import { createProject } from '../../src/work/project-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('probe', () => {
  it('lets an outsider member read, rename and delete another team milestone', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { project } = await createProject(workspace.admin, {
      name: 'Rebrand',
      teamIds: [other.team.id],
    });
    const { milestone } = await createMilestone(workspace.admin, {
      projectId: project.id,
      name: 'Beta',
    });
    const { principal: engineer } = await addMember(workspace, 'member');

    const listed = await listMilestones(engineer, project.id);
    console.log(
      'listed by outsider:',
      listed.map((row) => row.name),
    );

    const renamed = await updateMilestone(engineer, milestone.id, { name: 'Hijacked' });
    console.log('renamed by outsider:', renamed.milestone.name);

    await deleteMilestone(engineer, milestone.id);
    const rows = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, milestone.id));
    console.log('rows after outsider delete:', rows.length);
    expect(rows).toHaveLength(0);
  });

  it('lets an outsider member create a milestone on another team project', async () => {
    const other = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { project } = await createProject(workspace.admin, {
      name: 'Rebrand',
      teamIds: [other.team.id],
    });
    const { principal: engineer } = await addMember(workspace, 'member');
    const created = await createMilestone(engineer, { projectId: project.id, name: 'Injected' });
    console.log('created by outsider:', created.milestone.name);
    expect(created.milestone.projectId).toBe(project.id);
  });
});
