import { describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import type { Comment, DocComment, Issue } from '../../../src/lib/query/schemas.ts';
import {
  admitsNewRows,
  applyCommentDelta,
  applyDocCommentDelta,
  applyIssueDelta,
  applyIssueDeltaToPages,
  applyIssueDetailDelta,
  applyReactionDelta,
  awaitsServerRefresh,
  belongsInList,
  flattenIssuePages,
  mapIssuePages,
  orderingOf,
  searchOf,
  sortForSearch,
  summarizeReactions,
} from '../../../src/lib/query/sync.ts';

const TEAM_ID = 'team_eng';
const TEAM = (issue: Issue) => issue.teamId === TEAM_ID;

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: TEAM_ID,
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

function docComment(overrides: Partial<DocComment['comment']> = {}): DocComment {
  return {
    comment: {
      id: 'doc_comment_1',
      docId: 'doc_1',
      authorId: 'user_1',
      parentId: null,
      body: 'First',
      anchor: null,
      editedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      syncId: 5,
      ...overrides,
    },
    bodyHtml: '<p>First</p>',
  };
}

describe('applyDocCommentDelta', () => {
  it('appends a doc comment posted by someone else with the plain text fallback', () => {
    const next = applyDocCommentDelta(
      [docComment()],
      action({
        model: 'doc_comment',
        action: 'insert',
        data: { ...docComment({ id: 'doc_comment_2', body: 'Second' }).comment },
      }),
    );
    expect(next).toHaveLength(2);
    expect(next[1]?.comment.body).toBe('Second');
    expect(next[1]?.bodyHtml).toBe('');
  });

  it('drops a doc comment on delete or soft delete', () => {
    const deleted = { ...docComment().comment, deletedAt: '2026-01-02T00:00:00.000Z', syncId: 7 };
    expect(
      applyDocCommentDelta([docComment()], action({ model: 'doc_comment', data: deleted })),
    ).toEqual([]);
  });

  it('ignores an out of order doc comment edit', () => {
    const list = [docComment({ syncId: 9 })];
    const stale = { ...docComment({ body: 'Old', syncId: 8 }).comment };
    expect(applyDocCommentDelta(list, action({ model: 'doc_comment', data: stale }))).toBe(list);
  });

  it('carries the anchor of a comment somebody else attached to a passage', () => {
    const anchor = { quote: 'the migration', prefix: 'blocked on ', suffix: '.', start: 24 };
    const next = applyDocCommentDelta(
      [docComment()],
      action({
        model: 'doc_comment',
        action: 'insert',
        data: { ...docComment({ id: 'doc_comment_2', body: 'Which one?' }).comment, anchor },
      }),
    );

    expect(next[1]?.comment.anchor).toEqual(anchor);
    expect(next[0]?.comment.anchor).toBeNull();
  });

  it('reads an older doc comment that arrives with no anchor field at all', () => {
    const { anchor: _dropped, ...legacy } = docComment({ id: 'doc_comment_3' }).comment;

    const next = applyDocCommentDelta(
      [],
      action({ model: 'doc_comment', action: 'insert', data: legacy }),
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.comment.anchor).toBeNull();
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

describe('issue pages', () => {
  const pages = (...groups: Issue[][]) => ({
    pages: groups.map((issues, index) => ({
      issues,
      nextCursor: index === groups.length - 1 ? null : `cursor-${index}`,
    })),
    pageParams: groups.map((_group, index) => (index === 0 ? null : `cursor-${index - 1}`)),
  });

  it('reads every loaded page as one list', () => {
    const data = pages([issue({ id: 'a' })], [issue({ id: 'b' })]);
    expect(flattenIssuePages(data).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('keeps the page structure and cursors when a mutation rewrites the list', () => {
    const data = pages([issue({ id: 'a' }), issue({ id: 'b' })], [issue({ id: 'c' })]);
    const next = mapIssuePages(data, (issues) => issues.filter((row) => row.id !== 'a'));

    expect(next.pages).toHaveLength(2);
    expect(flattenIssuePages(next).map((row) => row.id)).toEqual(['b', 'c']);
    expect(next.pages[0]?.nextCursor).toBe('cursor-0');
    expect(next.pages[1]?.nextCursor).toBeNull();
    expect(next.pageParams).toEqual(data.pageParams);
  });

  it('applies a realtime delta across the loaded pages', () => {
    const data = pages([issue({ id: 'a' })], [issue({ id: 'b' })]);
    const next = applyIssueDeltaToPages(
      data,
      action({ data: { id: 'b', title: 'Renamed', syncId: 12 } }),
      TEAM,
    );
    expect(next?.pages[1]?.issues[0]?.title).toBe('Renamed');
  });
});

describe('belongsInList', () => {
  const base = issue({ id: 'issue_1', teamId: 'team_eng', stateId: 'state_todo' });

  it('accepts anything when the search carries no scope', () => {
    expect(belongsInList('limit=100&orderBy=manual', base)).toBe(true);
  });

  it('keeps a board column to its own status', () => {
    expect(belongsInList('teamId=team_eng&stateId=state_todo', base)).toBe(true);
    expect(belongsInList('teamId=team_eng&stateId=state_done', base)).toBe(false);
  });

  it('keeps a team list to its own team', () => {
    expect(belongsInList('teamId=team_design', base)).toBe(false);
  });

  it('matches an unassigned issue only when no assignee is required', () => {
    const unassigned = issue({ id: 'issue_2', assigneeId: null });
    expect(belongsInList('limit=100', unassigned)).toBe(true);
    expect(belongsInList('assigneeId=user_1', unassigned)).toBe(false);
  });

  it('reads the scope out of a query key', () => {
    expect(searchOf(['issues', 'team_eng', 'teamId=team_eng&stateId=state_todo'])).toBe(
      'teamId=team_eng&stateId=state_todo',
    );
    expect(searchOf(['issues'])).toBe('');
  });
});

describe('a cached list keeps the order the server would return', () => {
  it('orders by the query ordering, not by manual sortOrder', () => {
    const older = issue({ id: 'issue_a', sortOrder: 10, updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = issue({ id: 'issue_b', sortOrder: 90, updatedAt: '2026-06-01T00:00:00.000Z' });
    const byUpdated = sortForSearch('orderBy=updated', [older, newer]);
    expect(byUpdated.map((entry) => entry.id)).toEqual(['issue_b', 'issue_a']);

    const byManual = sortForSearch('orderBy=manual', [newer, older]);
    expect(byManual.map((entry) => entry.id)).toEqual(['issue_a', 'issue_b']);
  });

  it('treats an unknown or missing ordering as manual', () => {
    expect(orderingOf('')).toBe('manual');
    expect(orderingOf('orderBy=nonsense')).toBe('manual');
    expect(orderingOf('orderBy=priority')).toBe('priority');
  });

  it('sorts a title ordering as text and an estimate ordering as a number', () => {
    const b = issue({ id: 'i_b', title: 'beta', estimate: 8 });
    const a = issue({ id: 'i_a', title: 'alpha', estimate: 21 });
    expect(sortForSearch('orderBy=title', [b, a]).map((entry) => entry.id)).toEqual(['i_a', 'i_b']);
    expect(sortForSearch('orderBy=estimate', [a, b]).map((entry) => entry.id)).toEqual([
      'i_b',
      'i_a',
    ]);
  });
});

describe('a filtered list never invents a row the server did not return', () => {
  const filtered = 'teamId=team_eng&filter=cHJpb3JpdHk6dXJnZW50';

  it('refuses to admit an insert it cannot check against the encoded filter', () => {
    const incoming = issue({ id: 'issue_2', identifier: 'ENG-4' });
    const list = [issue()];
    expect(
      applyIssueDelta(list, action({ action: 'insert', data: incoming }), TEAM, filtered),
    ).toBe(list);
  });

  it('admits the same insert into a list carrying no encoded filter', () => {
    const incoming = issue({ id: 'issue_2', identifier: 'ENG-4' });
    const next = applyIssueDelta(
      [issue()],
      action({ action: 'insert', data: incoming }),
      TEAM,
      'teamId=team_eng',
    );
    expect(next).toHaveLength(2);
  });

  it('asks the server to settle the filtered list instead', () => {
    const incoming = issue({ id: 'issue_2', identifier: 'ENG-4' });
    const insert = action({ action: 'insert', data: incoming });
    expect(awaitsServerRefresh([issue()], insert, TEAM, filtered)).toBe(true);
    expect(awaitsServerRefresh([issue()], insert, TEAM, 'teamId=team_eng')).toBe(false);
    expect(awaitsServerRefresh([issue(), incoming], insert, TEAM, filtered)).toBe(false);
  });

  it('still drops a delete from a filtered list without waiting for the server', () => {
    const remove = action({ action: 'delete', data: { id: 'issue_1' } });
    expect(applyIssueDelta([issue()], remove, TEAM, filtered)).toEqual([]);
    expect(awaitsServerRefresh([issue()], remove, TEAM, filtered)).toBe(false);
  });

  it('reads the filter param, not merely any query string', () => {
    expect(admitsNewRows('')).toBe(true);
    expect(admitsNewRows('teamId=team_eng&orderBy=updated')).toBe(true);
    expect(admitsNewRows('filter=')).toBe(true);
    expect(admitsNewRows(filtered)).toBe(false);
  });
});

describe('an ordering name from the URL cannot reach the prototype', () => {
  it('treats an inherited property name as manual rather than crashing', () => {
    for (const name of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      expect(orderingOf(`orderBy=${encodeURIComponent(name)}`)).toBe('manual');
      expect(() => sortForSearch(`orderBy=${encodeURIComponent(name)}`, [issue()])).not.toThrow();
    }
  });
});

describe('a remote edit that changes where a row belongs in the order', () => {
  const byPriority = 'orderBy=priority';

  it('moves the row rather than leaving it where it happened to be', () => {
    const local = [
      issue({ id: 'issue_1', identifier: 'ENG-1', priority: 1 }),
      issue({ id: 'issue_2', identifier: 'ENG-2', priority: 2 }),
      issue({ id: 'issue_3', identifier: 'ENG-3', priority: 3 }),
    ];

    const demoted = applyIssueDelta(
      local,
      action({ modelId: 'issue_1', data: { id: 'issue_1', syncId: 12, priority: 4 } }),
      TEAM,
      byPriority,
    );

    expect(demoted.map((entry) => entry.id)).toEqual(['issue_2', 'issue_3', 'issue_1']);
  });

  it('leaves an order the edit did not disturb exactly as it was', () => {
    const local = [
      issue({ id: 'issue_1', identifier: 'ENG-1', priority: 1 }),
      issue({ id: 'issue_2', identifier: 'ENG-2', priority: 2 }),
    ];

    const renamed = applyIssueDelta(
      local,
      action({ modelId: 'issue_1', data: { id: 'issue_1', syncId: 12, title: 'Renamed' } }),
      TEAM,
      byPriority,
    );

    expect(renamed.map((entry) => entry.id)).toEqual(['issue_1', 'issue_2']);
    expect(renamed[0]?.title).toBe('Renamed');
  });
});
