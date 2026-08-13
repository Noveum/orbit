import { beforeEach, describe, expect, it } from 'bun:test';
import { asc, db, eq, schema } from '@orbit/db';
import type { FilterGroup } from '@orbit/shared/filters';
import { inCondition } from '@orbit/shared/filters';
import type { Principal } from '@orbit/shared/policy';
import { type IssueFilterInput, issueFilterSchema } from '@orbit/shared/validators';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { buildIssueWhere, type IssueVisibility } from '../../src/work/issue-query.ts';
import {
  archiveIssue,
  createIssue,
  listIssues,
  setRelation,
} from '../../src/work/issue-service.ts';
import { createLabel } from '../../src/work/label-service.ts';
import { createMilestone } from '../../src/work/milestone-service.ts';
import { createProject } from '../../src/work/project-service.ts';

const injectedNow = new Date('2036-08-13T17:45:00.000Z');

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

function parsedFilter(input: unknown = {}): IssueFilterInput {
  return issueFilterSchema.parse(input);
}

async function titlesMatching(
  principal: Principal,
  visibility: IssueVisibility,
  input: unknown = {},
): Promise<string[]> {
  const rows = await db
    .select({ title: schema.issue.title })
    .from(schema.issue)
    .where(
      buildIssueWhere(principal, {
        visibility,
        filter: parsedFilter(input),
        now: injectedNow,
      }),
    )
    .orderBy(asc(schema.issue.title));
  return rows.map((row) => row.title);
}

async function listedTitles(principal: Principal, input: unknown = {}): Promise<string[]> {
  const page = await listIssues(principal, input);
  return page.issues.map((issue) => issue.title).sort();
}

function group(...children: FilterGroup['children']): FilterGroup {
  return { kind: 'group', combinator: 'and', children };
}

describe('buildIssueWhere visibility', () => {
  it('keeps ordinary roles team scoped while workspace analytics spans teams in one organization', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Operations', key: 'OPS' });
    const operationsState = states.find((state) => state.category === 'unstarted');
    if (operationsState === undefined) throw new Error('missing operations state');
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Engineering work' });
    await createIssue(workspace.admin, {
      teamId: team.id,
      stateId: operationsState.id,
      title: 'Operations work',
    });
    const otherWorkspace = await createWorkspace('Vega');
    await createIssue(otherWorkspace.admin, {
      teamId: otherWorkspace.teamId,
      title: 'Other organization work',
    });

    const readers = await Promise.all(
      (['guest', 'contributor', 'member'] as const).map(
        async (role) => await addMember(workspace, role, { teamIds: [workspace.teamId] }),
      ),
    );

    for (const reader of readers) {
      expect(await titlesMatching(reader.principal, 'team')).toEqual(['Engineering work']);
      expect(await titlesMatching(reader.principal, 'workspace-analytics')).toEqual([
        'Engineering work',
        'Operations work',
      ]);
    }
    expect(await titlesMatching(workspace.admin, 'team')).toEqual([
      'Engineering work',
      'Operations work',
    ]);
    expect(await titlesMatching(workspace.admin, 'workspace-analytics')).toEqual([
      'Engineering work',
      'Operations work',
    ]);
  });

  it('applies archived and sub-issue choices without weakening organization isolation', async () => {
    const parent = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parent issue',
    });
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      parentId: parent.issue.id,
      title: 'Child issue',
    });
    const archived = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Archived issue',
    });
    await archiveIssue(workspace.admin, archived.issue.id);
    const otherWorkspace = await createWorkspace('Vega');
    await createIssue(otherWorkspace.admin, {
      teamId: otherWorkspace.teamId,
      title: 'Other organization issue',
    });

    expect(
      await titlesMatching(workspace.admin, 'workspace-analytics', {
        includeSubIssues: false,
      }),
    ).toEqual(['Parent issue']);
    expect(
      await titlesMatching(workspace.admin, 'workspace-analytics', {
        includeArchived: true,
        includeSubIssues: true,
      }),
    ).toEqual(['Archived issue', 'Child issue', 'Parent issue']);
  });
});

describe('buildIssueWhere predicate parity', () => {
  it('matches ordinary list direct scope fields and search', async () => {
    const assignee = await addMember(workspace, 'member');
    const { project } = await createProject(workspace.admin, {
      name: 'Atlas',
      teamIds: [workspace.teamId],
    });
    const { milestone } = await createMilestone(workspace.admin, {
      projectId: project.id,
      name: 'Launch',
    });
    const { label } = await createLabel(workspace.admin, {
      name: 'Launch',
      color: '#ff0000',
      teamId: workspace.teamId,
    });
    const [cycle] = await db
      .select()
      .from(schema.cycle)
      .where(eq(schema.cycle.organizationId, workspace.organizationId))
      .limit(1);
    if (cycle === undefined) throw new Error('missing cycle');
    const match = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Searchable launch',
      assigneeId: assignee.user.id,
      projectId: project.id,
      milestoneId: milestone.id,
      cycleId: cycle.id,
      stateId: stateNamed(workspace, 'Todo').id,
      labelIds: [label.id],
    });
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Distractor' });

    const cases: readonly [unknown, string[]][] = [
      [{ teamId: workspace.teamId }, ['Distractor', 'Searchable launch']],
      [{ projectId: project.id }, ['Searchable launch']],
      [{ cycleId: cycle.id }, ['Searchable launch']],
      [{ milestoneId: milestone.id }, ['Searchable launch']],
      [{ assigneeId: assignee.user.id }, ['Searchable launch']],
      [{ stateId: stateNamed(workspace, 'Todo').id }, ['Searchable launch']],
      [{ parentId: match.issue.id }, []],
      [{ stateCategory: 'unstarted' }, ['Searchable launch']],
      [{ labelId: label.id }, ['Searchable launch']],
      [{ query: 'launch' }, ['Searchable launch']],
    ];

    for (const [input, expected] of cases) {
      expect(await titlesMatching(workspace.admin, 'team', input)).toEqual(expected);
      expect(await listedTitles(workspace.admin, input)).toEqual(expected);
    }
  });

  it('keeps labels, milestones, blocked relations, unset values, and nested groups aligned', async () => {
    const { label } = await createLabel(workspace.admin, {
      name: 'Urgent',
      color: '#ff0000',
      teamId: workspace.teamId,
    });
    const { project } = await createProject(workspace.admin, {
      name: 'Atlas',
      teamIds: [workspace.teamId],
    });
    const { milestone } = await createMilestone(workspace.admin, {
      projectId: project.id,
      name: 'Launch',
    });
    const matching = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Matching issue',
      priority: 1,
      projectId: project.id,
      milestoneId: milestone.id,
      labelIds: [label.id],
    });
    const blocker = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Blocker issue',
    });
    await setRelation(workspace.admin, blocker.issue.id, {
      relatedIssueId: matching.issue.id,
      type: 'blocks',
    });
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Unset issue',
      priority: 4,
    });

    const cases: readonly [FilterGroup, string[]][] = [
      [group(inCondition('label', [label.id])), ['Matching issue']],
      [group(inCondition('milestone', [milestone.id])), ['Matching issue']],
      [group(inCondition('relation', ['blocked'])), ['Matching issue']],
      [group(inCondition('project', ['none'])), ['Blocker issue', 'Unset issue']],
      [
        group({
          kind: 'group',
          combinator: 'or',
          children: [inCondition('priority', ['1']), inCondition('priority', ['4'])],
        }),
        ['Matching issue', 'Unset issue'],
      ],
    ];

    for (const [filter, expected] of cases) {
      const input = { filter };
      expect(await titlesMatching(workspace.admin, 'team', input)).toEqual(expected);
      expect(await listedTitles(workspace.admin, input)).toEqual(expected);
    }
  });

  it('evaluates relative filters from the supplied clock', async () => {
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Inside supplied window',
      dueDate: '2036-08-22',
    });
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Outside supplied window',
      dueDate: '2036-09-12',
    });
    const filter = group({
      kind: 'condition',
      property: 'due',
      operator: 'relative',
      relative: { unit: 'week', offset: 2, direction: 'future' },
      negate: false,
    });

    expect(await titlesMatching(workspace.admin, 'team', { filter })).toEqual([
      'Inside supplied window',
    ]);
  });
});
