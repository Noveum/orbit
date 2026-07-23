import type { FilterPredicate } from '@orbit/shared/filters';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../test-support.ts';
import { addDays, today } from './issue-predicates.ts';
import { createIssue, listIssues } from './issue-service.ts';
import { createLabel } from './label-service.ts';
import { createProject } from './project-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newIssue(title: string, overrides: Record<string, unknown> = {}) {
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title,
    ...overrides,
  });
  return issue;
}

async function titlesMatching(...predicates: FilterPredicate[]): Promise<string[]> {
  const page = await listIssues(workspace.admin, { teamId: workspace.teamId, predicates });
  return page.issues.map((issue) => issue.title).sort();
}

describe('addDays', () => {
  it('walks the calendar forward without drifting off the day boundary', () => {
    expect(addDays('2026-02-26', 7)).toBe('2026-03-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('assignee predicates', () => {
  it('matches any of the listed assignees', async () => {
    const one = await addMember(workspace, 'member', { name: 'One' });
    const two = await addMember(workspace, 'member', { name: 'Two' });
    await newIssue('For one', { assigneeId: one.user.id });
    await newIssue('For two', { assigneeId: two.user.id });
    await newIssue('For nobody');

    expect(
      await titlesMatching({
        field: 'assignee',
        operator: 'is',
        values: [one.user.id, two.user.id],
      }),
    ).toEqual(['For one', 'For two']);
  });

  it('treats none as unassigned', async () => {
    const one = await addMember(workspace, 'member', { name: 'One' });
    await newIssue('For one', { assigneeId: one.user.id });
    await newIssue('For nobody');

    expect(await titlesMatching({ field: 'assignee', operator: 'is', values: ['none'] })).toEqual([
      'For nobody',
    ]);
  });

  it('keeps unassigned issues when negating an assignee', async () => {
    const one = await addMember(workspace, 'member', { name: 'One' });
    const two = await addMember(workspace, 'member', { name: 'Two' });
    await newIssue('For one', { assigneeId: one.user.id });
    await newIssue('For two', { assigneeId: two.user.id });
    await newIssue('For nobody');

    expect(
      await titlesMatching({ field: 'assignee', operator: 'is_not', values: [one.user.id] }),
    ).toEqual(['For nobody', 'For two']);
  });
});

describe('state, priority, creator and project predicates', () => {
  it('filters by workflow state', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const done = stateNamed(workspace, 'Done');
    await newIssue('Waiting', { stateId: todo.id });
    await newIssue('Shipped', { stateId: done.id });

    expect(await titlesMatching({ field: 'state', operator: 'is', values: [done.id] })).toEqual([
      'Shipped',
    ]);
    expect(await titlesMatching({ field: 'state', operator: 'is_not', values: [done.id] })).toEqual(
      ['Waiting'],
    );
  });

  it('filters by priority across several values', async () => {
    await newIssue('Urgent', { priority: 1 });
    await newIssue('High', { priority: 2 });
    await newIssue('Low', { priority: 4 });

    expect(await titlesMatching({ field: 'priority', operator: 'is', values: ['1', '2'] })).toEqual(
      ['High', 'Urgent'],
    );
    expect(
      await titlesMatching({ field: 'priority', operator: 'is_not', values: ['1', '2'] }),
    ).toEqual(['Low']);
  });

  it('filters by creator', async () => {
    const other = await addMember(workspace, 'member', { name: 'Other' });
    await newIssue('By admin');
    await createIssue(other.principal, { teamId: workspace.teamId, title: 'By other' });

    expect(
      await titlesMatching({ field: 'creator', operator: 'is', values: [other.user.id] }),
    ).toEqual(['By other']);
  });

  it('filters by project and by having no project', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Atlas',
      teamIds: [workspace.teamId],
    });
    await newIssue('In atlas', { projectId: project.id });
    await newIssue('Loose');

    expect(
      await titlesMatching({ field: 'project', operator: 'is', values: [project.id] }),
    ).toEqual(['In atlas']);
    expect(await titlesMatching({ field: 'project', operator: 'is', values: ['none'] })).toEqual([
      'Loose',
    ]);
  });
});

describe('label predicates', () => {
  it('matches issues carrying any of the labels and negates them', async () => {
    const { label: bug } = await createLabel(workspace.admin, {
      name: 'Bug',
      color: '#ff0000',
      teamId: workspace.teamId,
    });
    await newIssue('Broken', { labelIds: [bug.id] });
    await newIssue('Fine');

    expect(await titlesMatching({ field: 'label', operator: 'is', values: [bug.id] })).toEqual([
      'Broken',
    ]);
    expect(await titlesMatching({ field: 'label', operator: 'is_not', values: [bug.id] })).toEqual([
      'Fine',
    ]);
  });
});

describe('due date predicates', () => {
  it('separates overdue, this week and no due date', async () => {
    const now = today();
    await newIssue('Late', { dueDate: addDays(now, -3) });
    await newIssue('Soon', { dueDate: addDays(now, 2) });
    await newIssue('Later', { dueDate: addDays(now, 30) });
    await newIssue('Undated');

    expect(await titlesMatching({ field: 'due', operator: 'is', values: ['overdue'] })).toEqual([
      'Late',
    ]);
    expect(await titlesMatching({ field: 'due', operator: 'is', values: ['this_week'] })).toEqual([
      'Soon',
    ]);
    expect(await titlesMatching({ field: 'due', operator: 'is', values: ['none'] })).toEqual([
      'Undated',
    ]);
    expect(
      await titlesMatching({ field: 'due', operator: 'is', values: ['overdue', 'this_week'] }),
    ).toEqual(['Late', 'Soon']);
  });
});

describe('combined predicates', () => {
  it('intersects predicates across fields', async () => {
    const one = await addMember(workspace, 'member', { name: 'One' });
    await newIssue('Both', { assigneeId: one.user.id, priority: 1 });
    await newIssue('Only assignee', { assigneeId: one.user.id, priority: 4 });
    await newIssue('Only priority', { priority: 1 });

    expect(
      await titlesMatching(
        { field: 'assignee', operator: 'is', values: [one.user.id] },
        { field: 'priority', operator: 'is', values: ['1'] },
      ),
    ).toEqual(['Both']);
  });

  it('returns nothing when the predicates cannot both hold', async () => {
    await newIssue('Alone', { priority: 1 });

    expect(
      await titlesMatching(
        { field: 'priority', operator: 'is', values: ['1'] },
        { field: 'priority', operator: 'is_not', values: ['1'] },
      ),
    ).toEqual([]);
  });
});
