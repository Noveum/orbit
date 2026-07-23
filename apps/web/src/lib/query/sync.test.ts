import { describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import type { Comment, Issue } from './schemas.ts';
import {
  applyCommentDelta,
  applyIssueDelta,
  applyIssueDetailDelta,
  applyReactionDelta,
  summarizeReactions,
} from './sync.ts';

const TEAM = 'team_eng';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: TEAM,
    number: 3,
    identifier: 'ENG-3',
    title: 'Ship the board',
    description: '',
    stateId: 'state_todo',
    priority: 2,
    creatorId: 'user_1',
    assigneeId: null,
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 1024,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    stateEnteredAt: '2026-01-01T00:00:00.000Z',
    syncId: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: ['label_1'],
    ...overrides,
  };
}

function action(overrides: Partial<SyncAction> = {}): SyncAction {
  return {
    syncId: 11,
    organizationId: 'org_1',
    scopes: ['org:org_1'],
    action: 'update',
    model: 'issue',
    modelId: 'issue_1',
    data: {},
    actor: { type: 'user', id: 'user_2', name: 'Other' },
    at: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('sync id staleness guard', () => {
  it('never lets a late delta revert newer local state', () => {
    const local = [issue({ syncId: 30, title: 'Newer local title', stateId: 'state_done' })];
    const late = action({
      syncId: 21,
      data: { id: 'issue_1', title: 'Older remote title', stateId: 'state_todo', syncId: 21 },
    });
    expect(applyIssueDelta(local, late, TEAM)).toBe(local);

    const detail = { issue: issue({ syncId: 30, title: 'Newer local title' }) };
    expect(applyIssueDetailDelta(detail, late)?.issue.title).toBe('Newer local title');

    const thread = [comment({ syncId: 12, body: 'Newer local body' })];
    const lateComment = action({
      model: 'comment',
      data: { ...comment({ body: 'Older remote body', syncId: 11 }).comment },
    });
    expect(applyCommentDelta(thread, lateComment)).toBe(thread);
  });

  it('stays idempotent when the same delta arrives twice', () => {
    const insert = action({
      action: 'insert',
      data: issue({ id: 'issue_2', identifier: 'ENG-4', syncId: 12 }),
    });
    const once = applyIssueDelta([issue()], insert, TEAM);
    expect(applyIssueDelta(once, insert, TEAM)).toHaveLength(2);

    const reaction = action({
      model: 'reaction',
      action: 'insert',
      data: { id: 'reaction_1', commentId: 'comment_1', userId: 'user_2', emoji: '🎉' },
    });
    const first = applyReactionDelta([comment()], reaction);
    expect(applyReactionDelta(first, reaction)[0]?.reactions).toHaveLength(1);
  });
});

describe('applyIssueDelta', () => {
  it('merges a partial update and keeps labels the delta does not carry', () => {
    const list = [issue()];
    const next = applyIssueDelta(
      list,
      action({ data: { id: 'issue_1', stateId: 'state_doing', syncId: 12 } }),
      TEAM,
    );
    expect(next[0]?.stateId).toBe('state_doing');
    expect(next[0]?.labelIds).toEqual(['label_1']);
    expect(next[0]?.title).toBe('Ship the board');
  });

  it('ignores an out of order syncId', () => {
    const list = [issue({ syncId: 20 })];
    const next = applyIssueDelta(
      list,
      action({ data: { id: 'issue_1', stateId: 'state_doing', syncId: 19 } }),
      TEAM,
    );
    expect(next).toBe(list);
    expect(next[0]?.stateId).toBe('state_todo');
  });

  it('applies an equal syncId as stale so a repeat delta does not churn', () => {
    const list = [issue({ syncId: 20 })];
    expect(
      applyIssueDelta(list, action({ data: { id: 'issue_1', syncId: 20, title: 'x' } }), TEAM),
    ).toBe(list);
  });

  it('inserts a full issue that belongs to the list team', () => {
    const incoming = issue({ id: 'issue_2', identifier: 'ENG-4' });
    const next = applyIssueDelta([issue()], action({ action: 'insert', data: incoming }), TEAM);
    expect(next).toHaveLength(2);
    expect(next[1]?.identifier).toBe('ENG-4');
  });

  it('ignores an insert for another team', () => {
    const incoming = issue({ id: 'issue_2', teamId: 'team_des' });
    const list = [issue()];
    expect(applyIssueDelta(list, action({ action: 'insert', data: incoming }), TEAM)).toBe(list);
  });

  it('drops an issue on delete and on archive', () => {
    expect(
      applyIssueDelta([issue()], action({ action: 'delete', data: { id: 'issue_1' } }), TEAM),
    ).toEqual([]);
    expect(
      applyIssueDelta([issue()], action({ action: 'archive', data: { id: 'issue_1' } }), TEAM),
    ).toEqual([]);
  });

  it('removes an issue that moved to another team', () => {
    const next = applyIssueDelta(
      [issue()],
      action({ data: { id: 'issue_1', teamId: 'team_des', syncId: 12 } }),
      TEAM,
    );
    expect(next).toEqual([]);
  });

  it('ignores payloads that do not match the contract', () => {
    const list = [issue()];
    expect(applyIssueDelta(list, action({ data: { nope: true } }), TEAM)).toBe(list);
  });
});

describe('applyIssueDetailDelta', () => {
  it('drops the rendered description when the markdown changes so the viewer sees the new text', () => {
    const detail = { issue: issue(), descriptionHtml: '<p>old</p>' };
    const patched = applyIssueDetailDelta(
      detail,
      action({ data: { id: 'issue_1', description: 'new body', syncId: 12 } }),
    );
    expect(patched?.issue.description).toBe('new body');
    expect(patched?.descriptionHtml).toBe('');
  });

  it('keeps the rendered description when only other fields change', () => {
    const detail = { issue: issue(), descriptionHtml: '<p>old</p>' };
    const patched = applyIssueDetailDelta(
      detail,
      action({ data: { id: 'issue_1', priority: 1, syncId: 12 } }),
    );
    expect(patched?.descriptionHtml).toBe('<p>old</p>');
  });

  it('patches the detail cache for the same issue only', () => {
    const detail = { issue: issue() };
    const patched = applyIssueDetailDelta(
      detail,
      action({ data: { id: 'issue_1', title: 'Renamed', syncId: 12 } }),
    );
    expect(patched?.issue.title).toBe('Renamed');
    expect(applyIssueDetailDelta(detail, action({ data: { id: 'other', title: 'No' } }))).toBe(
      detail,
    );
    expect(applyIssueDetailDelta(undefined, action())).toBeUndefined();
  });
});

function comment(overrides: Partial<Comment['comment']> = {}): Comment {
  return {
    comment: {
      id: 'comment_1',
      issueId: 'issue_1',
      authorId: 'user_1',
      parentId: null,
      body: 'First',
      editedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      syncId: 5,
      ...overrides,
    },
    bodyHtml: '<p>First</p>',
    reactions: [],
  };
}

describe('applyCommentDelta', () => {
  it('appends a comment posted by someone else with its raw body for the plain text fallback', () => {
    const next = applyCommentDelta(
      [comment()],
      action({
        model: 'comment',
        action: 'insert',
        data: { ...comment({ id: 'comment_2', body: 'Second' }).comment },
      }),
    );
    expect(next).toHaveLength(2);
    expect(next[1]?.comment.body).toBe('Second');
    expect(next[1]?.bodyHtml).toBe('');
  });

  it('drops a comment on delete or soft delete', () => {
    const deleted = { ...comment().comment, deletedAt: '2026-01-02T00:00:00.000Z', syncId: 7 };
    expect(applyCommentDelta([comment()], action({ model: 'comment', data: deleted }))).toEqual([]);
  });

  it('ignores an out of order comment edit', () => {
    const list = [comment({ syncId: 9 })];
    const stale = { ...comment({ body: 'Old', syncId: 8 }).comment };
    expect(applyCommentDelta(list, action({ model: 'comment', data: stale }))).toBe(list);
  });
});

describe('applyReactionDelta', () => {
  it('adds and removes a reaction on the matching comment', () => {
    const base = [comment()];
    const added = applyReactionDelta(
      base,
      action({
        model: 'reaction',
        action: 'insert',
        data: { id: 'reaction_1', commentId: 'comment_1', userId: 'user_2', emoji: '🎉' },
      }),
    );
    expect(added[0]?.reactions).toHaveLength(1);

    const removed = applyReactionDelta(
      added,
      action({
        model: 'reaction',
        action: 'delete',
        data: { id: 'reaction_1', commentId: 'comment_1', userId: 'user_2', emoji: '🎉' },
      }),
    );
    expect(removed[0]?.reactions).toHaveLength(0);
  });
});

describe('summarizeReactions', () => {
  it('groups by emoji and marks the ones the viewer owns', () => {
    const summary = summarizeReactions(
      [
        { id: 'r1', commentId: 'c1', userId: 'me', emoji: '👍' },
        { id: 'r2', commentId: 'c1', userId: 'you', emoji: '👍' },
        { id: 'r3', commentId: 'c1', userId: 'you', emoji: '🎉' },
      ],
      'me',
    );
    expect(summary).toHaveLength(2);
    expect(summary.find((entry) => entry.emoji === '👍')).toEqual({
      emoji: '👍',
      count: 2,
      mine: true,
    });
    expect(summary.find((entry) => entry.emoji === '🎉')).toEqual({
      emoji: '🎉',
      count: 1,
      mine: false,
    });
  });
});
