import { beforeEach, describe, expect, it } from 'bun:test';
import type { FilterCondition, FilterGroup, FilterNode } from '@orbit/shared/filters';
import { inCondition } from '@orbit/shared/filters';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../test-support.ts';
import { addDays, today } from './issue-predicates.ts';
import { createIssue, listIssues, setRelation, subscribe } from './issue-service.ts';
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

function group(...children: FilterNode[]): FilterGroup {
  return { kind: 'group', combinator: 'and', children };
}

async function titlesMatching(...conditions: FilterCondition[]): Promise<string[]> {
  const page = await listIssues(workspace.admin, {
    teamId: workspace.teamId,
    filter: group(...conditions),
  });
  return page.issues.map((issue) => issue.title).sort();
}

async function titlesForTree(filter: FilterGroup): Promise<string[]> {
  const page = await listIssues(workspace.admin, { teamId: workspace.teamId, filter });
  return page.issues.map((issue) => issue.title).sort();
}

describe('addDays', () => {
  it('walks the calendar forward without drifting off the day boundary', () => {
    expect(addDays('2026-02-26', 7)).toBe('2026-03-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('assignee conditions', () => {
  it('matches any of the listed assignees', async () => {
    const one = await addMember(workspace, 'member', { name: 'One' });
    const two = await addMember(workspace, 'member', { name: 'Two' });
    await newIssue('For one', { assigneeId: one.user.id });
    await newIssue('For two', { assigneeId: two.user.id });
    await newIssue('For nobody');

    expect(await titlesMatching(inCondition('assignee', [one.user.id, two.user.id]))).toEqual([
      'For one',
      'For two',
    ]);
  });

  it('treats none as unassigned', async () => {
    const one = await addMember(workspace, 'member', { name: 'One' });
    await newIssue('For one', { assigneeId: one.user.id });
    await newIssue('For nobody');

    expect(await titlesMatching(inCondition('assignee', ['none']))).toEqual(['For nobody']);
  });

  it('keeps unassigned issues when negating an assignee', async () => {
    const one = await addMember(workspace, 'member', { name: 'One' });
    const two = await addMember(workspace, 'member', { name: 'Two' });
    await newIssue('For one', { assigneeId: one.user.id });
    await newIssue('For two', { assigneeId: two.user.id });
    await newIssue('For nobody');

    expect(await titlesMatching(inCondition('assignee', [one.user.id], true))).toEqual([
      'For nobody',
      'For two',
    ]);
  });
});

describe('state, priority, creator and project conditions', () => {
  it('filters by workflow state', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const done = stateNamed(workspace, 'Done');
    await newIssue('Waiting', { stateId: todo.id });
    await newIssue('Shipped', { stateId: done.id });

    expect(await titlesMatching(inCondition('state', [done.id]))).toEqual(['Shipped']);
    expect(await titlesMatching(inCondition('state', [done.id], true))).toEqual(['Waiting']);
  });

  it('filters by priority across several values', async () => {
    await newIssue('Urgent', { priority: 1 });
    await newIssue('High', { priority: 2 });
    await newIssue('Low', { priority: 4 });

    expect(await titlesMatching(inCondition('priority', ['1', '2']))).toEqual(['High', 'Urgent']);
    expect(await titlesMatching(inCondition('priority', ['1', '2'], true))).toEqual(['Low']);
  });

  it('filters by creator', async () => {
    const other = await addMember(workspace, 'member', { name: 'Other' });
    await newIssue('By admin');
    await createIssue(other.principal, { teamId: workspace.teamId, title: 'By other' });

    expect(await titlesMatching(inCondition('creator', [other.user.id]))).toEqual(['By other']);
  });

  it('filters by project and by having no project', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Atlas',
      teamIds: [workspace.teamId],
    });
    await newIssue('In atlas', { projectId: project.id });
    await newIssue('Loose');

    expect(await titlesMatching(inCondition('project', [project.id]))).toEqual(['In atlas']);
    expect(await titlesMatching(inCondition('project', ['none']))).toEqual(['Loose']);
  });
});

describe('estimate conditions', () => {
  it('matches a set of point values and an unset estimate', async () => {
    await newIssue('Small', { estimate: 1 });
    await newIssue('Large', { estimate: 8 });
    await newIssue('Unsized');

    expect(await titlesMatching(inCondition('estimate', ['1', '8']))).toEqual(['Large', 'Small']);
    expect(await titlesMatching(inCondition('estimate', ['none']))).toEqual(['Unsized']);
  });

  it('matches a between range', async () => {
    await newIssue('One', { estimate: 1 });
    await newIssue('Three', { estimate: 3 });
    await newIssue('Thirteen', { estimate: 13 });

    expect(
      await titlesMatching({
        kind: 'condition',
        property: 'estimate',
        operator: 'range',
        from: '2',
        to: '8',
        negate: false,
      }),
    ).toEqual(['Three']);
  });
});

describe('label conditions', () => {
  it('matches issues carrying any of the labels and negates them', async () => {
    const { label: bug } = await createLabel(workspace.admin, {
      name: 'Bug',
      color: '#ff0000',
      teamId: workspace.teamId,
    });
    await newIssue('Broken', { labelIds: [bug.id] });
    await newIssue('Fine');

    expect(await titlesMatching(inCondition('label', [bug.id]))).toEqual(['Broken']);
    expect(await titlesMatching(inCondition('label', [bug.id], true))).toEqual(['Fine']);
  });
});

describe('date conditions', () => {
  it('separates overdue, this week and no due date', async () => {
    const now = today();
    await newIssue('Late', { dueDate: addDays(now, -3) });
    await newIssue('Soon', { dueDate: addDays(now, 2) });
    await newIssue('Later', { dueDate: addDays(now, 30) });
    await newIssue('Undated');

    expect(await titlesMatching(inCondition('due', ['overdue']))).toEqual(['Late']);
    expect(await titlesMatching(inCondition('due', ['this_week']))).toEqual(['Soon']);
    expect(await titlesMatching(inCondition('due', ['none']))).toEqual(['Undated']);
    expect(await titlesMatching(inCondition('due', ['overdue', 'this_week']))).toEqual([
      'Late',
      'Soon',
    ]);
  });

  it('matches a relative window that moves with the calendar', async () => {
    const now = today();
    await newIssue('Next week', { dueDate: addDays(now, 9) });
    await newIssue('Next quarter', { dueDate: addDays(now, 80) });

    expect(
      await titlesMatching({
        kind: 'condition',
        property: 'due',
        operator: 'relative',
        relative: { unit: 'week', offset: 2, direction: 'future' },
        negate: false,
      }),
    ).toEqual(['Next week']);
  });

  it('matches an explicit between range on created date', async () => {
    await newIssue('Made today');
    expect(
      await titlesMatching({
        kind: 'condition',
        property: 'created',
        operator: 'range',
        from: addDays(today(), -1),
        to: addDays(today(), 1),
        negate: false,
      }),
    ).toEqual(['Made today']);
  });
});

describe('relation, subscriber and content conditions', () => {
  it('separates parents, sub-issues and unrelated issues', async () => {
    const parent = await newIssue('Parent');
    await newIssue('Child', { parentId: parent.id });
    await newIssue('Alone');

    expect(await titlesMatching(inCondition('relation', ['sub_issue']))).toEqual(['Child']);
    expect(await titlesMatching(inCondition('relation', ['parent']))).toEqual(['Parent']);
    expect(await titlesMatching(inCondition('relation', ['none']))).toEqual(['Alone']);
  });

  it('matches blocking relations in both directions', async () => {
    const blocker = await newIssue('Blocker');
    const blocked = await newIssue('Blocked');
    await setRelation(workspace.admin, blocker.id, {
      relatedIssueId: blocked.id,
      type: 'blocks',
    });

    expect(await titlesMatching(inCondition('relation', ['blocking']))).toEqual(['Blocker']);
    expect(await titlesMatching(inCondition('relation', ['blocked']))).toEqual(['Blocked']);
  });

  it('matches issues a person subscribes to', async () => {
    const watcher = await addMember(workspace, 'member', { name: 'Watcher' });
    const watched = await newIssue('Watched');
    await newIssue('Ignored');
    await subscribe(watcher.principal, watched.id);

    expect(await titlesMatching(inCondition('subscriber', [watcher.user.id]))).toEqual(['Watched']);
  });

  it('matches free text across title and description', async () => {
    await newIssue('Fix the login redirect', { description: 'happens on Safari' });
    await newIssue('Unrelated work');

    expect(
      await titlesMatching({
        kind: 'condition',
        property: 'content',
        operator: 'exact',
        value: 'safari',
        negate: false,
      }),
    ).toEqual(['Fix the login redirect']);
  });
});

describe('combined trees', () => {
  it('intersects conditions across properties', async () => {
    const one = await addMember(workspace, 'member', { name: 'One' });
    await newIssue('Both', { assigneeId: one.user.id, priority: 1 });
    await newIssue('Only assignee', { assigneeId: one.user.id, priority: 4 });
    await newIssue('Only priority', { priority: 1 });

    expect(
      await titlesMatching(inCondition('assignee', [one.user.id]), inCondition('priority', ['1'])),
    ).toEqual(['Both']);
  });

  it('returns nothing when the conditions cannot both hold', async () => {
    await newIssue('Alone', { priority: 1 });

    expect(
      await titlesMatching(inCondition('priority', ['1']), inCondition('priority', ['1'], true)),
    ).toEqual([]);
  });

  it('unions a nested or group inside an and group', async () => {
    await newIssue('Urgent', { priority: 1 });
    await newIssue('Low', { priority: 4 });
    await newIssue('Medium', { priority: 3 });

    expect(
      await titlesForTree({
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'group',
            combinator: 'or',
            children: [inCondition('priority', ['1']), inCondition('priority', ['4'])],
          },
        ],
      }),
    ).toEqual(['Low', 'Urgent']);
  });
});
