import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import type { IssueRow } from '../../src/work/issue-fields.ts';
import {
  assertExpectedIssueState,
  createIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';

const baseIssue: IssueRow = {
  id: 'issue_123',
  organizationId: 'org_123',
  teamId: 'team_123',
  number: 1,
  identifier: 'ENG-1',
  title: 'Test issue',
  description: '',
  stateId: 'state_in_progress',
  priority: 1,
  creatorId: 'user_1',
  assigneeId: 'user_2',
  projectId: 'proj_1',
  milestoneId: 'mile_1',
  cycleId: 'cycle_1',
  parentId: 'issue_parent_base',
  estimate: 3,
  estimatePointId: null,
  dueDate: '2026-10-01',
  sortOrder: 1000,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  syncId: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  stateEnteredAt: new Date(),
};

describe('Cross-user concurrency conflict validation (6 cases)', () => {
  it('A changes status -> B changes label -> A Undo rejected (Bug remains)', () => {
    const issueAfterAChangedStatus: IssueRow = {
      ...baseIssue,
      stateId: 'state_done',
    };
    const currentLabelsAfterBAddedBug = ['label_docs', 'label_bug'];

    expect(() => {
      assertExpectedIssueState(
        issueAfterAChangedStatus,
        {
          stateId: 'state_done',
          labelIds: ['label_docs'],
          reviewerIds: [],
          parentId: 'issue_parent_base',
        },
        currentLabelsAfterBAddedBug,
        [],
      );
    }).toThrow('Cannot undo: labels was changed by another update.');

    expect(currentLabelsAfterBAddedBug).toContain('label_bug');
  });

  it('A changes status -> B changes reviewer -> A Undo rejected (Bob remains)', () => {
    const issueAfterAChangedStatus: IssueRow = {
      ...baseIssue,
      stateId: 'state_done',
    };
    const currentReviewersAfterBAddedBob = ['user_bob'];

    expect(() => {
      assertExpectedIssueState(
        issueAfterAChangedStatus,
        {
          stateId: 'state_done',
          labelIds: [],
          reviewerIds: [],
          parentId: 'issue_parent_base',
        },
        [],
        currentReviewersAfterBAddedBob,
      );
    }).toThrow('Cannot undo: reviewers was changed by another update.');

    expect(currentReviewersAfterBAddedBob).toContain('user_bob');
  });

  it('A changes status -> B changes parent -> A Undo rejected (Parent remains)', () => {
    const issueAfterBChangedParent: IssueRow = {
      ...baseIssue,
      stateId: 'state_done',
      parentId: 'issue_parent_123',
    };

    expect(() => {
      assertExpectedIssueState(
        issueAfterBChangedParent,
        {
          stateId: 'state_done',
          labelIds: [],
          reviewerIds: [],
          parentId: 'issue_parent_base',
        },
        [],
        [],
      );
    }).toThrow('Cannot undo: parent was changed by another update.');

    expect(issueAfterBChangedParent.parentId).toBe('issue_parent_123');
  });

  it('A changes status -> B changes label -> A Redo rejected (Bug remains)', () => {
    const issueAfterAUndidStatus: IssueRow = {
      ...baseIssue,
      stateId: 'state_in_progress',
    };
    const currentLabelsAfterBAddedBug = ['label_docs', 'label_bug'];

    expect(() => {
      assertExpectedIssueState(
        issueAfterAUndidStatus,
        {
          stateId: 'state_in_progress',
          labelIds: ['label_docs'],
          reviewerIds: [],
          parentId: 'issue_parent_base',
        },
        currentLabelsAfterBAddedBug,
        [],
      );
    }).toThrow('Cannot undo: labels was changed by another update.');

    expect(currentLabelsAfterBAddedBug).toContain('label_bug');
  });

  it('A changes status -> B changes reviewer -> A Redo rejected (Bob remains)', () => {
    const issueAfterAUndidStatus: IssueRow = {
      ...baseIssue,
      stateId: 'state_in_progress',
    };
    const currentReviewersAfterBAddedBob = ['user_bob'];

    expect(() => {
      assertExpectedIssueState(
        issueAfterAUndidStatus,
        {
          stateId: 'state_in_progress',
          labelIds: [],
          reviewerIds: [],
          parentId: 'issue_parent_base',
        },
        [],
        currentReviewersAfterBAddedBob,
      );
    }).toThrow('Cannot undo: reviewers was changed by another update.');

    expect(currentReviewersAfterBAddedBob).toContain('user_bob');
  });

  it('A changes status -> B changes parent -> A Redo rejected (Parent remains)', () => {
    const issueAfterBChangedParent: IssueRow = {
      ...baseIssue,
      stateId: 'state_in_progress',
      parentId: 'issue_parent_123',
    };

    expect(() => {
      assertExpectedIssueState(
        issueAfterBChangedParent,
        {
          stateId: 'state_in_progress',
          labelIds: [],
          reviewerIds: [],
          parentId: 'issue_parent_base',
        },
        [],
        [],
      );
    }).toThrow('Cannot undo: parent was changed by another update.');

    expect(issueAfterBChangedParent.parentId).toBe('issue_parent_123');
  });
});

describe('service-level updateIssue CAS transaction integration', () => {
  let workspace: Workspace;

  beforeEach(async () => {
    await resetDatabase();
    workspace = await createWorkspace('Nova');
  });

  it('rejects updateIssue through database transaction when expected stateId is stale', async () => {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Service CAS test issue',
    });

    await expect(
      updateIssue(workspace.admin, issue.id, {
        title: 'New title',
        expected: {
          stateId: 'stale_state_id_that_never_existed',
        },
      }),
    ).rejects.toThrow('Cannot undo: state was changed by another update.');
  });

  it('rejects updateIssue through database transaction when expected labelIds are stale', async () => {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Service CAS test issue for labels',
    });

    await expect(
      updateIssue(workspace.admin, issue.id, {
        title: 'New title',
        expected: {
          labelIds: ['stale_label_id_123'],
        },
      }),
    ).rejects.toThrow('Cannot undo: labels was changed by another update.');
  });
});
