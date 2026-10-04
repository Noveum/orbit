import { describe, expect, it } from 'bun:test';
import { groupIssues } from '../../../src/features/filters/grouping.ts';
import { canRegroup, planDrop, regroupPatch } from '../../../src/features/issues/board.tsx';
import type { Cycle, Issue } from '../../../src/lib/query/schemas.ts';

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Something',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    estimate: null,
    assigneeId: null,
    creatorId: 'member_1',
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    dueDate: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    archivedAt: null,
    sortOrder: 1024,
    labelIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Issue;
}

function cycle(id: string, number: number): Cycle {
  return {
    id,
    organizationId: 'org_1',
    teamId: 'team_1',
    number,
    name: `Sprint ${number}`,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-01-14T00:00:00.000Z',
    completedAt: null,
  } as Cycle;
}

const cycles = [cycle('cycle_1', 1), cycle('cycle_2', 2)];

const issues = [
  issue({ id: 'a', identifier: 'ENG-1', cycleId: 'cycle_1', sortOrder: 1024 }),
  issue({ id: 'b', identifier: 'ENG-2', cycleId: 'cycle_1', sortOrder: 2048 }),
  issue({ id: 'c', identifier: 'ENG-3', cycleId: null, sortOrder: 1024 }),
];

const sprintColumns = groupIssues(
  issues,
  'cycle',
  { states: [], members: [], projects: [], cycles, labels: [] },
  { showEmptyGroups: true, ordering: 'manual' },
);

describe('regroupPatch', () => {
  it('does not offer agent assignment through a human regrouping patch', () => {
    expect(regroupPatch('assignee', 'agent:agent_1')).toBeNull();
  });
  it('moves an issue into the sprint the column represents', () => {
    expect(regroupPatch('cycle', 'cycle_2')).toEqual({ cycleId: 'cycle_2' });
  });

  it('takes an issue out of every sprint when dropped on the ungrouped column', () => {
    expect(regroupPatch('cycle', 'none')).toEqual({ cycleId: null });
  });

  it('never clears the status, because an issue must always have one', () => {
    expect(regroupPatch('state', 'none')).toBeNull();
    expect(regroupPatch('state', 'state_doing')).toEqual({ stateId: 'state_doing' });
  });

  it('reads a priority column as a number rather than an id', () => {
    expect(regroupPatch('priority', '2')).toEqual({ priority: 2 });
    expect(regroupPatch('priority', 'none')).toBeNull();
  });

  it('unassigns and unsets a project on the ungrouped column', () => {
    expect(regroupPatch('assignee', 'none')).toEqual({ assigneeId: null });
    expect(regroupPatch('project', 'none')).toEqual({ projectId: null });
  });

  it('refuses groupings a single drop cannot express', () => {
    expect(regroupPatch('label', 'label_1')).toBeNull();
    expect(regroupPatch('creator', 'member_1')).toBeNull();
    expect(regroupPatch('estimate', '3')).toBeNull();
    expect(regroupPatch('none', 'none')).toBeNull();
  });
});

describe('agent board assignment display', () => {
  it('preserves human reassignment while rejecting agent assignment and unsupported clearing', () => {
    const agentIssue = issue({
      id: 'agent_issue',
      assignee: { type: 'agent', id: 'agent_1', name: 'Build bot', avatar: null, deleted: false },
    });
    const humanIssue = issue({ id: 'human_issue', assigneeId: 'member_1' });
    const rows = [agentIssue, humanIssue];
    const groups = groupIssues(
      rows,
      'assignee',
      { states: [], members: [], projects: [], cycles: [], labels: [] },
      { showEmptyGroups: true, ordering: 'manual' },
    );

    expect(planDrop(groups, rows, humanIssue.id, 'agent:agent_1', 'assignee')).toBeNull();
    expect(planDrop(groups, rows, agentIssue.id, 'none', 'assignee')).toBeNull();
    expect(planDrop(groups, rows, agentIssue.id, humanIssue.id, 'assignee')).toMatchObject({
      assigneeId: 'member_1',
    });
  });
});

describe('canRegroup', () => {
  it('allows dragging on the groupings a drop can express', () => {
    expect(canRegroup('state')).toBe(true);
    expect(canRegroup('cycle')).toBe(true);
    expect(canRegroup('project')).toBe(true);
    expect(canRegroup('assignee')).toBe(true);
    expect(canRegroup('priority')).toBe(true);
  });

  it('refuses the ones it cannot', () => {
    expect(canRegroup('label')).toBe(false);
    expect(canRegroup('creator')).toBe(false);
    expect(canRegroup('estimate')).toBe(false);
    expect(canRegroup('none')).toBe(false);
  });
});

describe('planDrop across sprints', () => {
  it('carries the sprint, not the status, when the board is grouped by sprint', () => {
    const plan = planDrop(sprintColumns, issues, 'c', 'a', 'cycle');
    expect(plan).toMatchObject({ cycleId: 'cycle_1' });
    expect(plan?.stateId).toBeUndefined();
  });

  it('drops an issue back into the backlog column', () => {
    const plan = planDrop(sprintColumns, issues, 'a', 'c', 'cycle');
    expect(plan).toMatchObject({ cycleId: null });
    expect(plan?.stateId).toBeUndefined();
  });

  it('still keeps the neighbours it was dropped between', () => {
    const plan = planDrop(sprintColumns, issues, 'c', 'b', 'cycle');
    expect(plan).toMatchObject({ beforeId: 'a', afterId: 'b' });
  });

  it('refuses a drop while grouped by something a drop cannot express', () => {
    const byLabel = groupIssues(
      issues,
      'label',
      { states: [], members: [], projects: [], cycles, labels: [] },
      { showEmptyGroups: true, ordering: 'manual' },
    );
    expect(planDrop(byLabel, issues, 'a', 'b', 'label')).toBeNull();
  });

  it('never writes a sprint id into the status field', () => {
    const plan = planDrop(sprintColumns, issues, 'c', 'a', 'cycle');
    expect(plan?.stateId).toBeUndefined();
    expect(plan?.cycleId).toBe('cycle_1');
  });
});
