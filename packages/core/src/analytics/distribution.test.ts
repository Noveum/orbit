import { beforeEach, describe, expect, it } from 'bun:test';
import { addMember, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  buildChart,
  projectProgressSeries,
  scopeSeries,
  stateGroupBreakdown,
  workDistribution,
} from './distribution.ts';
import type { AnalyticsScope } from './schemas.ts';
import { createLabel, createProjectRow, insertIssue, insertLabelOn } from './test-fixtures.ts';

let workspace: Workspace;
let memberId: string;
let projectId: string;
let labelOne: string;
let labelTwo: string;
const WORKSPACE: AnalyticsScope = { type: 'workspace' };

function slice(rows: readonly { key: string; value: number }[], key: string): number {
  return rows.find((row) => row.key === key)?.value ?? 0;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const member = await addMember(workspace, 'member', { name: 'Bea Builder' });
  memberId = member.user.id;
  projectId = await createProjectRow(workspace, 'Platform');
  labelOne = await createLabel(workspace, 'Bug');
  labelTwo = await createLabel(workspace, 'Feature');
  const admin = workspace.adminUser.id;

  const one = await insertIssue(workspace, {
    number: 1,
    state: 'Done',
    assigneeId: admin,
    projectId,
    estimate: 3,
  });
  const two = await insertIssue(workspace, {
    number: 2,
    state: 'In Progress',
    assigneeId: admin,
    projectId,
    estimate: 5,
  });
  const three = await insertIssue(workspace, {
    number: 3,
    state: 'Todo',
    assigneeId: memberId,
    estimate: 2,
  });
  await insertIssue(workspace, {
    number: 4,
    state: 'Done',
    assigneeId: memberId,
    projectId,
    estimate: 8,
  });
  await insertIssue(workspace, { number: 5, state: 'Backlog' });

  await insertLabelOn(one, labelOne);
  await insertLabelOn(two, labelOne);
  await insertLabelOn(two, labelTwo);
  await insertLabelOn(three, labelTwo);
});

describe('buildChart flat', () => {
  it('counts issues per assignee', async () => {
    const chart = await buildChart(workspace.admin, {
      scope: WORKSPACE,
      xAxis: 'assignee',
      measure: 'issues',
    });
    const total = chart.data.reduce((sum, datum) => sum + datum.total, 0);
    expect(total).toBe(5);
    expect(chart.data.find((datum) => datum.name === 'Ada Admin')?.total).toBe(2);
    expect(chart.data.find((datum) => datum.name === 'Bea Builder')?.total).toBe(2);
    expect(chart.data.find((datum) => datum.name === 'Unassigned')?.total).toBe(1);
  });

  it('sums points per assignee when the measure is points', async () => {
    const chart = await buildChart(workspace.admin, {
      scope: WORKSPACE,
      xAxis: 'assignee',
      measure: 'points',
    });
    expect(chart.data.find((datum) => datum.name === 'Ada Admin')?.total).toBe(8);
    expect(chart.data.find((datum) => datum.name === 'Bea Builder')?.total).toBe(10);
  });

  it('supports many x-axes through one field map', async () => {
    const byState = await buildChart(workspace.admin, {
      scope: WORKSPACE,
      xAxis: 'state',
      measure: 'issues',
    });
    expect(byState.data.find((datum) => datum.name === 'Done')?.total).toBe(2);

    const byEstimate = await buildChart(workspace.admin, {
      scope: WORKSPACE,
      xAxis: 'estimate',
      measure: 'issues',
    });
    expect(
      slice(
        byEstimate.data.map((d) => ({ key: d.key, value: d.total })),
        '0',
      ),
    ).toBe(1);
    expect(
      slice(
        byEstimate.data.map((d) => ({ key: d.key, value: d.total })),
        '8',
      ),
    ).toBe(1);

    const byPriority = await buildChart(workspace.admin, {
      scope: WORKSPACE,
      xAxis: 'priority',
      measure: 'issues',
    });
    expect(byPriority.data).toHaveLength(1);
    expect(byPriority.data[0]?.total).toBe(5);
  });

  it('counts distinct issues per label even with multi-label fan-out', async () => {
    const chart = await buildChart(workspace.admin, {
      scope: WORKSPACE,
      xAxis: 'label',
      measure: 'issues',
    });
    expect(chart.data.find((datum) => datum.name === 'Bug')?.total).toBe(2);
    expect(chart.data.find((datum) => datum.name === 'Feature')?.total).toBe(2);
    const total = chart.data.reduce((sum, datum) => sum + datum.total, 0);
    expect(total).toBeGreaterThan(5);
  });
});

describe('stateGroupBreakdown', () => {
  it('reconciles: each row total equals the sum of its state groups and rows sum to the issue count', async () => {
    const breakdown = await stateGroupBreakdown(workspace.admin, WORKSPACE, 'assignee');
    let grand = 0;
    for (const row of breakdown.data) {
      const rowSum = Object.values(row.values).reduce((sum, value) => sum + value, 0);
      expect(rowSum).toBe(row.total);
      grand += row.total;
    }
    expect(grand).toBe(5);
    expect(Object.keys(breakdown.schema).length).toBeGreaterThan(0);
  });
});

describe('workDistribution', () => {
  it('groups issues by project', async () => {
    const rows = await workDistribution(workspace.admin, WORKSPACE, 'project', 'issues');
    expect(slice(rows, 'none')).toBe(2);
    expect(rows.find((row) => row.name === 'Platform')?.value).toBe(3);
  });
});

describe('scopeSeries and projectProgressSeries', () => {
  it('reports a cumulative non decreasing scope ending at the total', async () => {
    const series = await scopeSeries(workspace.admin, WORKSPACE, 'issues', 'week');
    expect(series.length).toBeGreaterThan(0);
    for (let index = 1; index < series.length; index += 1) {
      const previous = series[index - 1]?.scope ?? 0;
      const current = series[index]?.scope ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
    expect(series.at(-1)?.scope).toBe(5);
  });

  it('reports the project scope from a single SQL series, not an unbounded scan', async () => {
    const series = await projectProgressSeries(workspace.admin, projectId, 'issues');
    expect(series.at(-1)?.scope).toBe(3);
  });
});
