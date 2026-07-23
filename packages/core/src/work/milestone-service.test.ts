import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import { createMilestone, listMilestones, reorderMilestones } from './milestone-service.ts';
import { createProject } from './project-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newProject(name = 'Launch'): Promise<string> {
  const { project } = await createProject(workspace.admin, {
    name,
    teamIds: [workspace.teamId],
  });
  return project.id;
}

describe('milestone ordering invariant', () => {
  it('gives every new milestone a strictly larger sort order', async () => {
    const projectId = await newProject();
    const orders: number[] = [];
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      const { milestone } = await createMilestone(workspace.admin, { projectId, name });
      orders.push(milestone.sortOrder);
    }

    expect(new Set(orders).size).toBe(orders.length);
    for (const [index, order] of orders.entries()) {
      if (index === 0) continue;
      const previous = orders[index - 1];
      if (previous === undefined) throw new Error('missing previous order');
      expect(order).toBeGreaterThan(previous);
    }
    expect((await listMilestones(workspace.admin, projectId)).map((row) => row.name)).toEqual([
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
    ]);
  });

  it('numbers each project independently', async () => {
    const first = await newProject('First');
    const second = await newProject('Second');
    const a = await createMilestone(workspace.admin, { projectId: first, name: 'Alpha' });
    const b = await createMilestone(workspace.admin, { projectId: second, name: 'Beta' });

    expect(b.milestone.sortOrder).toBe(a.milestone.sortOrder);
    expect(await listMilestones(workspace.admin, second)).toHaveLength(1);
  });

  it('breaks a sort order tie by creation time', async () => {
    const projectId = await newProject();
    const first = await createMilestone(workspace.admin, { projectId, name: 'Newer' });
    const second = await createMilestone(workspace.admin, { projectId, name: 'Older' });
    await db
      .update(schema.milestone)
      .set({
        sortOrder: first.milestone.sortOrder,
        createdAt: new Date(first.milestone.createdAt.getTime() - 60_000),
      })
      .where(eq(schema.milestone.id, second.milestone.id));

    expect((await listMilestones(workspace.admin, projectId)).map((row) => row.name)).toEqual([
      'Older',
      'Newer',
    ]);
  });
});

describe('milestone project relationship invariant', () => {
  it('refuses a reorder that leaves a milestone of the project out', async () => {
    const projectId = await newProject();
    const kept = await createMilestone(workspace.admin, { projectId, name: 'Kept' });
    await createMilestone(workspace.admin, { projectId, name: 'Forgotten' });

    await expect(
      reorderMilestones(workspace.admin, projectId, [kept.milestone.id]),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses a reorder that lists a milestone twice', async () => {
    const projectId = await newProject();
    const only = await createMilestone(workspace.admin, { projectId, name: 'Only' });

    await expect(
      reorderMilestones(workspace.admin, projectId, [only.milestone.id, only.milestone.id]),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses a reorder that pulls in another project', async () => {
    const projectId = await newProject('Here');
    const elsewhere = await newProject('Elsewhere');
    const mine = await createMilestone(workspace.admin, { projectId, name: 'Mine' });
    const stray = await createMilestone(workspace.admin, {
      projectId: elsewhere,
      name: 'Stray',
    });

    await expect(
      reorderMilestones(workspace.admin, projectId, [stray.milestone.id, mine.milestone.id]),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('keeps sort orders distinct after a full reorder', async () => {
    const projectId = await newProject();
    const one = await createMilestone(workspace.admin, { projectId, name: 'One' });
    const two = await createMilestone(workspace.admin, { projectId, name: 'Two' });
    const three = await createMilestone(workspace.admin, { projectId, name: 'Three' });

    const { milestones } = await reorderMilestones(workspace.admin, projectId, [
      three.milestone.id,
      one.milestone.id,
      two.milestone.id,
    ]);
    expect(milestones.map((row) => row.name)).toEqual(['Three', 'One', 'Two']);

    const listed = await listMilestones(workspace.admin, projectId);
    expect(listed.map((row) => row.name)).toEqual(['Three', 'One', 'Two']);
    expect(new Set(listed.map((row) => row.sortOrder)).size).toBe(3);
  });

  it('refuses a milestone on a project outside the organization', async () => {
    await expect(
      createMilestone(workspace.admin, {
        projectId: '00000000-0000-4000-8000-000000000000',
        name: 'Nowhere',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
