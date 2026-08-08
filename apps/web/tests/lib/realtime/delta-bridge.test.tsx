import { describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { clientId } from '@/lib/query/client-id.ts';
import {
  BOARD_ROOT,
  BOOTSTRAP_ROOT,
  DOC_ROOT,
  DOCS_HOME_ROOT,
  DOCS_ROOT,
  ISSUE_FACETS_ROOT,
  ISSUE_SUMMARY_ROOT,
  MILESTONES_ROOT,
  queryKeys,
  VIEWS_ROOT,
} from '@/lib/query/keys.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import type { IssuePages } from '@/lib/query/sync.ts';

let capturedHandler: ((actions: SyncAction[]) => void) | null = null;
let capturedResume: ((since: number) => void) | null = null;
const observed: number[] = [];

mock.module('@orbit/realtime-client/react', () => ({
  useRealtimeStatus: () => 'open',
  useScopeSubscription: () => undefined,
  useDeltaHandler: (handler: (actions: SyncAction[]) => void) => {
    capturedHandler = handler;
  },
  useResumeHandler: (handler: (since: number) => void) => {
    capturedResume = handler;
  },
  useObserveSyncId: () => (syncId: number) => observed.push(syncId),
}));

const { DeltaBridge } = await import('../../../src/lib/realtime/delta-bridge.tsx');

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
    labelIds: [],
    ...overrides,
  };
}

function action(overrides: Partial<SyncAction> = {}): SyncAction {
  return {
    syncId: 11,
    organizationId: 'org_1',
    scopes: [`team:${TEAM}`],
    action: 'update',
    model: 'issue',
    modelId: 'issue_1',
    data: { id: 'issue_1', title: 'Renamed', syncId: 11 },
    actor: { type: 'user', id: 'user_1' },
    at: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

function renameAction(originClientId: string, title: string): SyncAction {
  return { ...action({ data: { id: 'issue_1', title, syncId: 11 } }), originClientId };
}

function mount(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.issues(TEAM), {
    pages: [{ issues: [issue()], nextCursor: null }],
    pageParams: [null],
  });
  render(
    <QueryClientProvider client={client}>
      <DeltaBridge organizationId="org_1" teamIds={[TEAM]} />
    </QueryClientProvider>,
  );
  return client;
}

function titleIn(client: QueryClient): string | undefined {
  return client.getQueryData<IssuePages>(queryKeys.issues(TEAM))?.pages[0]?.issues[0]?.title;
}

function trackInvalidations(client: QueryClient): unknown[][] {
  const seen: unknown[][] = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filters?: Parameters<typeof original>[0]) => {
    const key = filters?.queryKey;
    if (key !== undefined) seen.push([...key]);
    return Promise.resolve();
  };
  return seen;
}

describe('DeltaBridge origin suppression', () => {
  it('applies a delta that originated in another tab of the same user', () => {
    const client = mount();
    expect(capturedHandler).not.toBeNull();
    act(() => capturedHandler?.([renameAction('other-tab-client-id', 'Renamed elsewhere')]));
    expect(titleIn(client)).toBe('Renamed elsewhere');
  });

  it('skips a delta that this tab originated', () => {
    const client = mount();
    act(() => capturedHandler?.([renameAction(clientId(), 'Echo of my own write')]));
    expect(titleIn(client)).toBe('Ship the board');
  });

  it('applies a delta that carries no origin so older publishers still land', () => {
    const client = mount();
    const { originClientId: _ignored, ...withoutOrigin } = renameAction('unused', 'From the MCP');
    act(() => capturedHandler?.([withoutOrigin]));
    expect(titleIn(client)).toBe('From the MCP');
  });
});

describe('DeltaBridge ordering', () => {
  it('ignores a delta whose sync id is not newer than the cached row', () => {
    const client = mount();
    act(() =>
      capturedHandler?.([
        action({ syncId: 12, data: { id: 'issue_1', title: 'Newest', syncId: 12 } }),
        action({ syncId: 9, data: { id: 'issue_1', title: 'Stale replay', syncId: 9 } }),
      ]),
    );
    expect(titleIn(client)).toBe('Newest');
  });

  it('keeps a delta for another team out of this team list', () => {
    const client = mount();
    act(() =>
      capturedHandler?.([
        action({
          modelId: 'issue_other',
          data: { ...issue({ id: 'issue_other', teamId: 'team_design' }), syncId: 30 },
        }),
      ]),
    );
    const list = client.getQueryData<IssuePages>(queryKeys.issues(TEAM));
    expect(list?.pages.flatMap((page) => page.issues)).toHaveLength(1);
  });
});

describe('DeltaBridge root invalidation', () => {
  it('invalidates the bootstrap root once for a burst of org config models', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() =>
      capturedHandler?.([
        action({ model: 'workflow_state', modelId: 'state_1', data: { id: 'state_1' } }),
        action({ model: 'label', modelId: 'label_1', data: { id: 'label_1' } }),
        action({ model: 'team_member', modelId: 'tm_1', data: { id: 'tm_1' } }),
      ]),
    );
    expect(seen).toEqual([[BOOTSTRAP_ROOT]]);
  });

  it('invalidates the milestones root, and nothing else, for a milestone delta', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() =>
      capturedHandler?.([
        action({ model: 'milestone', modelId: 'milestone_1', data: { id: 'milestone_1' } }),
        action({ model: 'milestone', modelId: 'milestone_2', data: { id: 'milestone_2' } }),
      ]),
    );
    expect(seen).toEqual([[MILESTONES_ROOT]]);
  });

  it('invalidates the views root for a view delta', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() => capturedHandler?.([action({ model: 'view', modelId: 'view_1', data: {} })]));
    expect(seen).toEqual([[VIEWS_ROOT]]);
  });

  it('invalidates docs once, the docs home once, and each touched doc for a doc burst', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() =>
      capturedHandler?.([
        action({ model: 'doc', modelId: 'doc_1', data: {} }),
        action({ model: 'doc_collection', modelId: 'col_1', data: {} }),
      ]),
    );
    expect(seen).toEqual([[DOCS_ROOT], [DOCS_HOME_ROOT], [DOC_ROOT, 'doc_1']]);
  });

  it('refreshes the counts and the milestone counts for an issue delta', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() => capturedHandler?.([action()]));
    expect(seen).toEqual([
      [ISSUE_SUMMARY_ROOT],
      [ISSUE_FACETS_ROOT],
      [BOARD_ROOT],
      [MILESTONES_ROOT],
    ]);
  });
});

describe('DeltaBridge doc comments', () => {
  it('patches only the cache for the doc the comment belongs to', () => {
    const client = mount();
    client.setQueryData(queryKeys.docComments('doc_a'), []);
    client.setQueryData(queryKeys.docComments('doc_b'), []);
    act(() =>
      capturedHandler?.([
        action({
          model: 'doc_comment',
          modelId: 'dc_1',
          scopes: ['org:org_1', 'doc:doc_a'],
          data: {
            id: 'dc_1',
            docId: 'doc_a',
            authorId: 'user_1',
            parentId: null,
            body: 'Hi',
            editedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            syncId: 12,
          },
        }),
      ]),
    );
    expect(client.getQueryData(queryKeys.docComments('doc_a'))).toHaveLength(1);
    expect(client.getQueryData(queryKeys.docComments('doc_b'))).toHaveLength(0);
  });
});

describe('DeltaBridge reconnect backfill', () => {
  it('replays the catch up endpoint instead of refetching the visible list', async () => {
    const client = mount();
    const seen = trackInvalidations(client);
    observed.length = 0;
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(
        Response.json({
          syncId: 42,
          truncated: false,
          actions: [
            action({ syncId: 42, data: { id: 'issue_1', title: 'Caught up', syncId: 42 } }),
          ],
        }),
      );
    }) as typeof fetch;

    try {
      await act(async () => {
        capturedResume?.(17);
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requested).toEqual(['/api/sync?since=17']);
    expect(titleIn(client)).toBe('Caught up');
    expect(observed).toContain(42);
    expect(seen).toEqual([
      [ISSUE_SUMMARY_ROOT],
      [ISSUE_FACETS_ROOT],
      [BOARD_ROOT],
      [MILESTONES_ROOT],
    ]);
  });
});

function deleteAction(id: string, identifier: string): SyncAction {
  return {
    ...action({
      action: 'delete',
      modelId: id,
      data: { id, teamId: TEAM, identifier },
    }),
    originClientId: 'another-persons-tab',
  };
}

function detailFor(row: Issue, subIssues: readonly Issue[]) {
  return {
    issue: row,
    descriptionHtml: '',
    activity: [],
    activityCursor: null,
    subIssues,
    subscribed: false,
  };
}

function idsIn(client: QueryClient): string[] {
  const pages = client.getQueryData<IssuePages>(queryKeys.issues(TEAM));
  return (pages?.pages ?? []).flatMap((page) => page.issues).map((row) => row.id);
}

describe('DeltaBridge deletions', () => {
  it('drops the row from a list somebody else is looking at', () => {
    const client = mount();
    expect(idsIn(client)).toEqual(['issue_1']);

    act(() => capturedHandler?.([deleteAction('issue_1', 'ENG-3')]));

    expect(idsIn(client)).toEqual([]);
  });

  it('forgets the open detail for the issue that was deleted', () => {
    const client = mount();
    client.setQueryData(queryKeys.issue('ENG-3'), detailFor(issue(), []));

    act(() => capturedHandler?.([deleteAction('issue_1', 'ENG-3')]));

    expect(client.getQueryData(queryKeys.issue('ENG-3'))).toBeUndefined();
  });

  it('takes a deleted child out of the sub issue list its parent still shows', () => {
    const client = mount();
    const child = issue({ id: 'issue_child', identifier: 'ENG-4', parentId: 'issue_1' });
    client.setQueryData(queryKeys.issue('ENG-3'), detailFor(issue(), [child]));

    act(() => capturedHandler?.([deleteAction('issue_child', 'ENG-4')]));

    const parent = client.getQueryData<{ subIssues: readonly Issue[]; issue: Issue }>(
      queryKeys.issue('ENG-3'),
    );
    expect(parent?.subIssues).toEqual([]);
    expect(parent?.issue.id).toBe('issue_1');
  });

  it('frees a cached child when the parent delete is followed by its own update', () => {
    const client = mount();
    const child = issue({ id: 'issue_child', identifier: 'ENG-4', parentId: 'issue_1' });
    client.setQueryData(queryKeys.issues(TEAM), {
      pages: [{ issues: [issue(), child], nextCursor: null }],
      pageParams: [null],
    });

    act(() =>
      capturedHandler?.([
        deleteAction('issue_1', 'ENG-3'),
        {
          ...action({
            modelId: 'issue_child',
            data: { ...child, parentId: null, syncId: 40 },
            syncId: 40,
          }),
          originClientId: 'another-persons-tab',
        },
      ]),
    );

    const rows = (client.getQueryData<IssuePages>(queryKeys.issues(TEAM))?.pages ?? []).flatMap(
      (page) => page.issues,
    );
    expect(rows.map((row) => row.id)).toEqual(['issue_child']);
    expect(rows[0]?.parentId).toBeNull();
  });
});
