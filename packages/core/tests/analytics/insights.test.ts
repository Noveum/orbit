import { beforeEach, describe, expect, it } from 'bun:test';
import { type AnalyticsQuery, analyticsQuerySchema, insightConfigSchema } from '@orbit/shared';
import { loadAnalyticsInsights } from '../../src/analytics/insights.ts';
import { createLabel, insertIssue, insertLabelOn } from '../../src/analytics/test-fixtures.ts';
import {
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';

const now = new Date('2026-08-13T12:00:00.000Z');

let workspace: Workspace;

function query(): AnalyticsQuery {
  return analyticsQuerySchema.parse({
    range: { preset: 'custom', from: '2026-08-01', to: '2026-08-10' },
    compare: 'none',
  });
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('loadAnalyticsInsights', () => {
  it('aggregates bars by slice and segment with cohort keys and sums', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const inProgress = stateNamed(workspace, 'In Progress');
    await insertIssue(workspace, { number: 1, state: 'Todo', priority: 1 });
    await insertIssue(workspace, { number: 2, state: 'Todo', priority: 1 });
    await insertIssue(workspace, { number: 3, state: 'Todo', priority: 2 });
    await insertIssue(workspace, { number: 4, state: 'In Progress', priority: 1 });

    const result = await loadAnalyticsInsights(
      workspace.admin,
      query(),
      insightConfigSchema.parse({ measure: 'count', slice: 'state', segment: 'priority' }),
      { now, timezone: 'UTC' },
    );

    if (result.kind !== 'bars') throw new Error('Expected a bars result.');
    expect(result.unit).toBe('issues');
    expect(result.buckets.map((bucket) => bucket.id)).toEqual([todo.id, inProgress.id]);

    const todoBucket = result.buckets.find((bucket) => bucket.id === todo.id);
    const inProgressBucket = result.buckets.find((bucket) => bucket.id === inProgress.id);
    if (todoBucket === undefined || inProgressBucket === undefined) {
      throw new Error('Missing expected buckets.');
    }

    expect(todoBucket.value).toBe(3);
    expect(todoBucket.label).toBe('Todo');
    expect(todoBucket.cohort).toEqual({ cohort: `state:${todo.id}` });
    expect(todoBucket.segments.find((segment) => segment.id === '1')).toEqual({
      id: '1',
      label: 'Urgent',
      value: 2,
    });
    expect(todoBucket.segments.find((segment) => segment.id === '2')).toEqual({
      id: '2',
      label: 'High',
      value: 1,
    });

    expect(inProgressBucket.value).toBe(1);
    expect(inProgressBucket.cohort).toEqual({ cohort: `state:${inProgress.id}` });
    expect(inProgressBucket.segments).toEqual([{ id: '1', label: 'Urgent', value: 1 }]);
  });

  it('weighs bars by points, treating an unestimated issue as one point', async () => {
    await insertIssue(workspace, { number: 5, state: 'Todo', estimate: 3 });
    await insertIssue(workspace, { number: 6, state: 'Todo', estimate: null });

    const result = await loadAnalyticsInsights(
      workspace.admin,
      query(),
      insightConfigSchema.parse({ measure: 'points', slice: 'state' }),
      { now, timezone: 'UTC' },
    );

    if (result.kind !== 'bars') throw new Error('Expected a bars result.');
    expect(result.unit).toBe('points');
    const todo = stateNamed(workspace, 'Todo');
    expect(result.buckets.find((bucket) => bucket.id === todo.id)?.value).toBe(4);
  });

  it('counts an issue under every label it carries', async () => {
    const bugId = await createLabel(workspace, 'Bug');
    const featureId = await createLabel(workspace, 'Feature');
    const dual = await insertIssue(workspace, { number: 10, state: 'Todo' });
    await insertLabelOn(dual, bugId);
    await insertLabelOn(dual, featureId);
    await insertIssue(workspace, { number: 11, state: 'Todo' });
    const bugOnly = await insertIssue(workspace, { number: 12, state: 'Todo' });
    await insertLabelOn(bugOnly, bugId);

    const result = await loadAnalyticsInsights(
      workspace.admin,
      query(),
      insightConfigSchema.parse({ measure: 'count', slice: 'label' }),
      { now, timezone: 'UTC' },
    );

    if (result.kind !== 'bars') throw new Error('Expected a bars result.');
    const bugBucket = result.buckets.find((bucket) => bucket.id === bugId);
    const featureBucket = result.buckets.find((bucket) => bucket.id === featureId);
    const noneBucket = result.buckets.find((bucket) => bucket.id === 'none');
    if (bugBucket === undefined || featureBucket === undefined || noneBucket === undefined) {
      throw new Error('Missing expected label buckets.');
    }

    expect(bugBucket.value).toBe(2);
    expect(bugBucket.label).toBe('Bug');
    expect(featureBucket.value).toBe(1);
    expect(featureBucket.label).toBe('Feature');
    expect(noneBucket.value).toBe(1);
    expect(noneBucket.label).toBe('No label');
  });

  it('keeps a bucket total independent of segment fanout for multi-label issues', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const bugId = await createLabel(workspace, 'Bug');
    const featureId = await createLabel(workspace, 'Feature');
    const dual = await insertIssue(workspace, { number: 30, state: 'Todo' });
    await insertLabelOn(dual, bugId);
    await insertLabelOn(dual, featureId);

    const result = await loadAnalyticsInsights(
      workspace.admin,
      query(),
      insightConfigSchema.parse({ measure: 'count', slice: 'state', segment: 'label' }),
      { now, timezone: 'UTC' },
    );

    if (result.kind !== 'bars') throw new Error('Expected a bars result.');
    const todoBucket = result.buckets.find((bucket) => bucket.id === todo.id);
    if (todoBucket === undefined) throw new Error('Missing the Todo bucket.');
    expect(todoBucket.value).toBe(1);
    expect(todoBucket.segments.find((segment) => segment.id === bugId)?.value).toBe(1);
    expect(todoBucket.segments.find((segment) => segment.id === featureId)?.value).toBe(1);
  });

  it('rolls slices beyond the cap into a non-drillable other bucket', async () => {
    const labelIds: string[] = [];
    for (let index = 0; index < 31; index += 1) {
      const labelId = await createLabel(workspace, `Slice ${String(index).padStart(2, '0')}`);
      labelIds.push(labelId);
      const issueId = await insertIssue(workspace, { number: 200 + index, state: 'Todo' });
      await insertLabelOn(issueId, labelId);
    }

    const result = await loadAnalyticsInsights(
      workspace.admin,
      query(),
      insightConfigSchema.parse({ measure: 'count', slice: 'label' }),
      { now, timezone: 'UTC' },
    );

    if (result.kind !== 'bars') throw new Error('Expected a bars result.');
    expect(result.buckets).toHaveLength(31);

    const other = result.buckets.find((bucket) => bucket.id === 'other');
    if (other === undefined) throw new Error('Missing the other bucket.');
    expect(other.cohort).toBeNull();
    expect(other.value).toBe(1);

    const named = result.buckets.find((bucket) => bucket.id !== 'other');
    if (named === undefined) throw new Error('Missing a named bucket.');
    expect(named.cohort).not.toBeNull();
    expect(named.cohort).toEqual({ cohort: `label:${named.id}` });
  });

  it('rolls segments beyond the cap into an other bucket', async () => {
    const labelIds: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      const labelId = await createLabel(workspace, `Label ${String(index).padStart(2, '0')}`);
      labelIds.push(labelId);
      const issueId = await insertIssue(workspace, { number: 100 + index, state: 'Todo' });
      await insertLabelOn(issueId, labelId);
    }

    const result = await loadAnalyticsInsights(
      workspace.admin,
      query(),
      insightConfigSchema.parse({ measure: 'count', slice: 'state_category', segment: 'label' }),
      { now, timezone: 'UTC' },
    );

    if (result.kind !== 'bars') throw new Error('Expected a bars result.');
    const bucket = result.buckets.find((entry) => entry.id === 'unstarted');
    if (bucket === undefined) throw new Error('Missing the unstarted bucket.');
    expect(bucket.segments).toHaveLength(9);
    const other = bucket.segments.find((segment) => segment.id === 'other');
    if (other === undefined) throw new Error('Missing the other segment.');
    expect(other.value).toBe(1);
    const sortedIds = [...labelIds].sort((left, right) => left.localeCompare(right));
    const overflowLabelId = sortedIds.at(-1);
    expect(bucket.segments.some((segment) => segment.id === overflowLabelId)).toBe(false);
  });

  it('labels state category buckets for people instead of the raw enum value', async () => {
    await insertIssue(workspace, { number: 40, state: 'Todo' });
    await insertIssue(workspace, { number: 41, state: 'In Progress' });

    const result = await loadAnalyticsInsights(
      workspace.admin,
      query(),
      insightConfigSchema.parse({ measure: 'count', slice: 'state_category' }),
      { now, timezone: 'UTC' },
    );

    if (result.kind !== 'bars') throw new Error('Expected a bars result.');
    const started = result.buckets.find((bucket) => bucket.id === 'started');
    const unstarted = result.buckets.find((bucket) => bucket.id === 'unstarted');
    if (started === undefined || unstarted === undefined) {
      throw new Error('Missing expected state category buckets.');
    }
    expect(started.label).toBe('Started');
    expect(unstarted.label).toBe('Unstarted');
  });

  it('produces scatter points and exact percentiles for cycle time', async () => {
    const shortId = await insertIssue(workspace, {
      number: 20,
      state: 'Done',
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      completedAt: new Date('2026-08-03T00:00:00.000Z'),
    });
    const longId = await insertIssue(workspace, {
      number: 21,
      state: 'Done',
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      completedAt: new Date('2026-08-07T00:00:00.000Z'),
    });
    await insertIssue(workspace, {
      number: 22,
      state: 'Done',
      startedAt: new Date('2026-08-05T00:00:00.000Z'),
      completedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    const result = await loadAnalyticsInsights(
      workspace.admin,
      query(),
      insightConfigSchema.parse({ measure: 'cycle_time' }),
      { now, timezone: 'UTC' },
    );

    if (result.kind !== 'scatter') throw new Error('Expected a scatter result.');
    expect(result.unit).toBe('days');
    expect(result.points).toHaveLength(2);
    expect(result.points.map((point) => point.issueId)).toEqual([longId, shortId]);
    expect(result.points[0]?.days).toBeCloseTo(6, 5);
    expect(result.points[1]?.days).toBeCloseTo(2, 5);
    expect(result.percentiles).not.toBeNull();
    expect(result.percentiles?.p25).toBeCloseTo(3, 5);
    expect(result.percentiles?.p50).toBeCloseTo(4, 5);
    expect(result.percentiles?.p75).toBeCloseTo(5, 5);
    expect(result.percentiles?.p95).toBeCloseTo(5.8, 5);
  });
});
