import { beforeEach, describe, expect, it } from 'bun:test';
import { db } from '@orbit/db';
import { describeActivity, listActivity } from '../../src/activity/activity-service.ts';
import {
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('describeActivity', () => {
  it('renders a status move with human names', () => {
    expect(
      describeActivity({
        field: 'stateId',
        fromValue: { id: 'a', name: 'In Progress' },
        toValue: { id: 'b', name: 'In Review' },
      }),
    ).toBe('moved from In Progress to In Review');
  });

  it('renders assignment, priority, titles, and fallbacks', () => {
    expect(
      describeActivity({ field: 'assigneeId', fromValue: null, toValue: { id: 'u', name: 'Ada' } }),
    ).toBe('assigned to Ada');
    expect(
      describeActivity({ field: 'assigneeId', fromValue: { id: 'u', name: 'Ada' }, toValue: null }),
    ).toBe('unassigned Ada');
    expect(describeActivity({ field: 'priority', fromValue: 0, toValue: 2 })).toBe(
      'set priority to High',
    );
    expect(describeActivity({ field: 'title', fromValue: 'Old', toValue: 'New' })).toBe(
      'renamed to "New"',
    );
    expect(describeActivity({ field: 'created', fromValue: null, toValue: null })).toBe(
      'created the issue',
    );
    expect(describeActivity({ field: 'archived', fromValue: null, toValue: null })).toBe(
      'archived the issue',
    );
    expect(describeActivity({ field: 'estimate', fromValue: 1, toValue: 3 })).toBe(
      'changed the estimate',
    );
    expect(describeActivity({ field: 'mystery', fromValue: 'a', toValue: 'b' })).toBe(
      'changed mystery from a to b',
    );
  });

  it('names a link by its label rather than the stored type', () => {
    expect(
      describeActivity({ field: 'relation', fromValue: null, toValue: 'blocked_by ENG-3' }),
    ).toBe('marked as Blocked by ENG-3');
    expect(
      describeActivity({ field: 'relation', fromValue: null, toValue: 'duplicated_by ENG-9' }),
    ).toBe('marked as Duplicated by ENG-9');
    expect(describeActivity({ field: 'relation', fromValue: 'related ENG-4', toValue: null })).toBe(
      'removed a Relates to ENG-4 relation',
    );
  });

  it('leaves a relation value it does not recognise alone', () => {
    expect(
      describeActivity({ field: 'relation', fromValue: null, toValue: 'invented_type ENG-1' }),
    ).toBe('marked as invented_type ENG-1');
    expect(describeActivity({ field: 'relation', fromValue: null, toValue: null })).toBe(
      'removed a relation',
    );
  });
});

describe('listActivity', () => {
  it('records the actor and renders the whole trail', async () => {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Trailed',
    });
    await updateIssue(workspace.admin, issue.id, {
      stateId: stateNamed(workspace, 'In Progress').id,
    });

    const rows = await listActivity(db, workspace.admin, issue.id, { oldestFirst: true });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.actorId === workspace.admin.userId)).toBe(true);
    expect(rows.every((row) => row.actorName.length > 0)).toBe(true);
    expect(rows.map(describeActivity)).toEqual([
      'created the issue',
      'moved from Triage to In Progress',
    ]);
  });
});
