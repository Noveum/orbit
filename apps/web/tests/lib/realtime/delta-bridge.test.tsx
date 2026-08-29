import { describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { ANALYTICS_ROOT } from '@/features/analytics/analytics-keys.ts';
import { clientId } from '@/lib/query/client-id.ts';
import {
  issueCacheRevisionGeneration,
  issueDeletionGeneration,
  issueListRevisionGeneration,
  issueRevisionGeneration,
} from '@/lib/query/issue-cache-generation.ts';
import {
  BOARD_ROOT,
  BOOTSTRAP_ROOT,
  DOC_ROOT,
  DOCS_HOME_ROOT,
  DOCS_ROOT,
  ISSUE_FACETS_ROOT,
  ISSUE_ROOT,
  ISSUE_SUMMARY_ROOT,
  ISSUES_ROOT,
  MILESTONES_ROOT,
  queryKeys,
  VIEWS_ROOT,
} from '@/lib/query/keys.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import type { IssuePages } from '@/lib/query/sync.ts';

let capturedHandler: ((actions: SyncAction[]) => void) | null = null;
let capturedResume: ((since: number) => void) | null = null;
let realtimeStatus: 'connecting' | 'open' | 'reconnecting' | 'closed' = 'open';
const observed: number[] = [];

mock.module('@orbit/realtime-client/react', () => ({
  useRealtimeStatus: () => realtimeStatus,
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

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) throw new Error('deferred promise did not initialize');
  return { promise, resolve: resolvePromise };
}

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

describe('DeltaBridge first connection', () => {
  it('refreshes bootstrap once when the initial connection becomes ready', () => {
    realtimeStatus = 'connecting';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const seen = trackInvalidations(client);
    const mounted = render(
      <QueryClientProvider client={client}>
        <DeltaBridge organizationId="org_1" teamIds={[TEAM]} />
      </QueryClientProvider>,
    );

    realtimeStatus = 'open';
    mounted.rerender(
      <QueryClientProvider client={client}>
        <DeltaBridge organizationId="org_1" teamIds={[TEAM]} />
      </QueryClientProvider>,
    );
    mounted.rerender(
      <QueryClientProvider client={client}>
        <DeltaBridge organizationId="org_1" teamIds={[TEAM]} />
      </QueryClientProvider>,
    );

    expect(seen).toEqual([[BOOTSTRAP_ROOT]]);
    realtimeStatus = 'open';
  });
});

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
    const generation = issueRevisionGeneration(client, 'issue_1');
    const listGeneration = issueListRevisionGeneration(client, queryKeys.issues(TEAM));
    expect(capturedHandler).not.toBeNull();
    act(() => capturedHandler?.([renameAction('other-tab-client-id', 'Renamed elsewhere')]));
    expect(titleIn(client)).toBe('Renamed elsewhere');
    expect(issueRevisionGeneration(client, 'issue_1')).toBe(generation + 1);
    expect(issueListRevisionGeneration(client, queryKeys.issues(TEAM))).toBe(listGeneration + 1);
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

  it('marks an overlapping list fetch when a missing row is deleted', async () => {
    const client = mount();
    const key = queryKeys.issues(TEAM);
    const pending = deferred<IssuePages>();
    const request = client.fetchQuery({ queryKey: key, queryFn: () => pending.promise });
    const generation = issueListRevisionGeneration(client, key);

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          modelId: 'issue_2',
          data: { id: 'issue_2', teamId: TEAM },
        }),
      ]),
    );

    expect(issueListRevisionGeneration(client, key)).toBe(generation + 1);
    const current = client.getQueryData<IssuePages>(key);
    if (current === undefined) throw new Error('missing issue pages');
    pending.resolve(current);
    await request;
  });

  it('cancels a stale list fetch before applying a realtime deletion', async () => {
    const client = mount();
    const key = queryKeys.issues(TEAM);
    const pending = deferred<IssuePages>();
    const request = client
      .fetchQuery({ queryKey: key, queryFn: () => pending.promise })
      .catch(() => undefined);

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          modelId: 'issue_1',
          data: { id: 'issue_1', teamId: TEAM },
        }),
      ]),
    );
    expect(client.getQueryData<IssuePages>(key)?.pages[0]?.issues).toEqual([]);

    pending.resolve({
      pages: [{ issues: [issue()], nextCursor: null }],
      pageParams: [null],
    });
    await request;

    expect(client.getQueryData<IssuePages>(key)?.pages[0]?.issues).toEqual([]);
  });

  it('does not mark an overlapping team list for another team action', async () => {
    const client = mount();
    const key = queryKeys.issues(TEAM, `teamId=${TEAM}`);
    const pages: IssuePages = {
      pages: [{ issues: [issue()], nextCursor: null }],
      pageParams: [null],
    };
    client.setQueryData(key, pages);
    const pending = deferred<IssuePages>();
    const request = client.fetchQuery({ queryKey: key, queryFn: () => pending.promise });
    const generation = issueListRevisionGeneration(client, key);

    act(() =>
      capturedHandler?.([
        action({
          scopes: ['team:team_other'],
          modelId: 'issue_2',
          data: { ...issue({ id: 'issue_2', teamId: 'team_other' }), syncId: 11 },
        }),
      ]),
    );

    expect(issueListRevisionGeneration(client, key)).toBe(generation);
    pending.resolve(pages);
    await request;
  });

  it('cancels a stale source-team fetch when an issue moves to another team', async () => {
    const client = mount();
    const key = queryKeys.issues(TEAM, `teamId=${TEAM}`);
    const pages: IssuePages = {
      pages: [{ issues: [issue()], nextCursor: null }],
      pageParams: [null],
    };
    client.setQueryData(key, pages);
    const pending = deferred<IssuePages>();
    const request = client
      .fetchQuery({ queryKey: key, queryFn: () => pending.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('fetching'));

    act(() =>
      capturedHandler?.([
        action({
          scopes: ['team:team_design'],
          data: {
            ...issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 }),
            teamChanged: true,
          },
          syncId: 30,
        }),
      ]),
    );
    expect(client.getQueryData<IssuePages>(key)?.pages[0]?.issues).toEqual([]);

    pending.resolve(pages);
    await request;
    await Promise.resolve();

    expect(client.getQueryData<IssuePages>(key)?.pages[0]?.issues).toEqual([]);
  });

  it('applies paired departure and arrival actions without clearing the surviving detail', () => {
    const client = mount();
    const sourceKey = queryKeys.issues(TEAM, `teamId=${TEAM}`);
    const destinationKey = queryKeys.issues('team_design', 'teamId=team_design');
    const detailKey = queryKeys.issue('ENG-3');
    client.setQueryData(sourceKey, {
      pages: [{ issues: [issue()], nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(destinationKey, {
      pages: [{ issues: [], nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(detailKey, detailFor(issue(), []));
    const deletionGeneration = issueDeletionGeneration(client, 'issue_1');
    const revisionGeneration = issueRevisionGeneration(client, 'issue_1');
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          scopes: [`team:${TEAM}`],
          syncId: 30,
        }),
        action({
          data: { ...arrived, teamChanged: true },
          scopes: ['team:team_design'],
          syncId: 30,
        }),
      ]),
    );

    expect(client.getQueryData<IssuePages>(sourceKey)?.pages[0]?.issues).toEqual([]);
    expect(client.getQueryData<IssuePages>(destinationKey)?.pages[0]?.issues).toEqual([arrived]);
    expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue).toEqual(arrived);
    expect(issueDeletionGeneration(client, 'issue_1')).toBe(deletionGeneration);
    expect(issueRevisionGeneration(client, 'issue_1')).toBe(revisionGeneration + 1);
  });

  it('preserves a same-sync move when arrival precedes departure', async () => {
    const client = mount();
    const detailKey = queryKeys.issue('ENG-3');
    const canonicalKey = queryKeys.issue('DSGN-4');
    client.setQueryData(detailKey, detailFor(issue(), []));
    const deletionGeneration = issueDeletionGeneration(client, 'issue_1');
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });

    act(() =>
      capturedHandler?.([
        action({
          data: { ...arrived, teamChanged: true },
          scopes: ['team:team_design'],
          syncId: 30,
        }),
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
      ]),
    );

    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue).toEqual(arrived),
    );
    expect(client.getQueryData<ReturnType<typeof detailFor>>(canonicalKey)?.issue).toEqual(arrived);
    expect(issueDeletionGeneration(client, 'issue_1')).toBe(deletionGeneration);
  });

  it('preserves a same-sync move whose departure arrives in a later frame', async () => {
    const client = mount();
    const detailKey = queryKeys.issue('ENG-3');
    client.setQueryData(detailKey, detailFor(issue(), []));
    const deletionGeneration = issueDeletionGeneration(client, 'issue_1');
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });

    act(() =>
      capturedHandler?.([
        action({
          data: { ...arrived, teamChanged: true },
          scopes: ['team:team_design'],
          syncId: 30,
        }),
      ]),
    );
    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue).toEqual(arrived),
    );

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
      ]),
    );

    expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue).toEqual(arrived);
    expect(issueDeletionGeneration(client, 'issue_1')).toBe(deletionGeneration);
  });

  it('applies an equal-sync departure only to a lagging list', () => {
    const client = mount();
    const sourceKey = queryKeys.issues(TEAM, `teamId=${TEAM}`);
    const destinationKey = queryKeys.issues('team_design', 'teamId=team_design');
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });
    client.setQueryData(sourceKey, {
      pages: [{ issues: [issue()], nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(destinationKey, {
      pages: [{ issues: [arrived], nextCursor: null }],
      pageParams: [null],
    });

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          scopes: [`team:${TEAM}`],
          syncId: 30,
        }),
      ]),
    );

    expect(client.getQueryData<IssuePages>(sourceKey)?.pages[0]?.issues).toEqual([]);
    expect(client.getQueryData<IssuePages>(destinationKey)?.pages[0]?.issues).toEqual([arrived]);
  });

  it('clears an issue detail when only its source-team departure arrives', () => {
    const client = mount();
    const detailKey = queryKeys.issue('ENG-3');
    client.setQueryData(detailKey, detailFor(issue(), []));
    const deletionGeneration = issueDeletionGeneration(client, 'issue_1');

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          scopes: [`team:${TEAM}`],
          syncId: 30,
        }),
      ]),
    );

    expect(client.getQueryData(detailKey)).toBeUndefined();
    expect(issueDeletionGeneration(client, 'issue_1')).toBe(deletionGeneration + 1);
  });

  it('clears a detail when a later departure is the final action in the batch', () => {
    const client = mount();
    const detailKey = queryKeys.issue('ENG-3');
    client.setQueryData(detailKey, detailFor(issue(), []));
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });

    act(() =>
      capturedHandler?.([
        action({
          data: { ...arrived, teamChanged: true },
          scopes: ['team:team_design'],
          syncId: 30,
        }),
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: 'team_design',
            identifier: 'DSGN-4',
            departure: true,
            syncId: 31,
          },
          scopes: ['team:team_design'],
          syncId: 31,
        }),
      ]),
    );

    expect(client.getQueryData(detailKey)).toBeUndefined();
  });

  it('keeps a detail when a later ordinary update is the final action in the batch', () => {
    const client = mount();
    const detailKey = queryKeys.issue('ENG-3');
    client.setQueryData(detailKey, detailFor(issue(), []));
    const newest = issue({ title: 'Newest after move', syncId: 31 });

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
        action({ data: newest, syncId: 31 }),
      ]),
    );

    expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue).toEqual(newest);
  });
});

describe('DeltaBridge analytics freshness', () => {
  it('coalesces relevant actions into one aggregate invalidation', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() =>
      capturedHandler?.([
        action({ model: 'issue' }),
        action({ model: 'project', modelId: 'project_1' }),
        action({ model: 'label', modelId: 'label_1' }),
      ]),
    );

    expect(seen.filter((key) => key[0] === ANALYTICS_ROOT)).toEqual([[ANALYTICS_ROOT]]);
  });

  it('invalidates aggregates for this tab before suppressing its row echo', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    const generation = issueRevisionGeneration(client, 'issue_1');
    act(() => capturedHandler?.([renameAction(clientId(), 'Own update')]));

    expect(seen).toContainEqual([ANALYTICS_ROOT]);
    expect(seen).toContainEqual([ISSUE_SUMMARY_ROOT]);
    expect(seen).toContainEqual([ISSUE_FACETS_ROOT]);
    expect(seen).toContainEqual([BOARD_ROOT]);
    expect(seen).toContainEqual([MILESTONES_ROOT]);
    expect(seen).toContainEqual([ISSUES_ROOT]);
    expect(seen).toContainEqual([ISSUE_ROOT]);
    expect(issueRevisionGeneration(client, 'issue_1')).toBe(generation + 1);
    expect(titleIn(client)).toBe('Ship the board');
  });

  it('records an own delete echo without replaying the deleted row', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    const generation = issueDeletionGeneration(client, 'issue_1');

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          originClientId: clientId(),
          data: { id: 'issue_1', teamId: TEAM, identifier: 'ENG-3', syncId: 11 },
        }),
      ]),
    );

    expect(idsIn(client)).toEqual(['issue_1']);
    expect(issueDeletionGeneration(client, 'issue_1')).toBe(generation + 1);
    expect(seen).toContainEqual([ISSUES_ROOT]);
    expect(seen).toContainEqual([ISSUE_ROOT]);
  });

  it('records an own move arrival without treating its departure as deletion', () => {
    const client = mount();
    const deletionGeneration = issueDeletionGeneration(client, 'issue_1');
    const revisionGeneration = issueRevisionGeneration(client, 'issue_1');
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          originClientId: clientId(),
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
        action({
          originClientId: clientId(),
          data: arrived,
          scopes: ['team:team_design'],
          syncId: 30,
        }),
      ]),
    );

    expect(idsIn(client)).toEqual(['issue_1']);
    expect(issueDeletionGeneration(client, 'issue_1')).toBe(deletionGeneration);
    expect(issueRevisionGeneration(client, 'issue_1')).toBe(revisionGeneration + 2);
  });

  it('does not invalidate analytics for unrelated comment activity', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() => capturedHandler?.([action({ model: 'comment', modelId: 'comment_1' })]));

    expect(seen.some((key) => key[0] === ANALYTICS_ROOT)).toBe(false);
  });
});

describe('DeltaBridge ordering', () => {
  it('applies an equal-sync action to lagging list and detail caches', () => {
    const client = mount();
    const currentKey = queryKeys.issues(TEAM, 'orderBy=updated');
    const laggingKey = queryKeys.issues(TEAM, 'orderBy=manual');
    const canonical = issue({ title: 'Canonical', syncId: 50 });
    const lagging = issue({ title: 'Lagging', syncId: 40 });
    client.setQueryData(currentKey, {
      pages: [{ issues: [canonical], nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(laggingKey, {
      pages: [{ issues: [lagging], nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(queryKeys.issue('ENG-3'), detailFor(lagging, []));

    act(() => capturedHandler?.([action({ syncId: 50, data: canonical })]));

    expect(client.getQueryData<IssuePages>(laggingKey)?.pages[0]?.issues[0]).toEqual(canonical);
    expect(
      client.getQueryData<ReturnType<typeof detailFor>>(queryKeys.issue('ENG-3'))?.issue,
    ).toEqual(canonical);
    expect(client.getQueryData<IssuePages>(currentKey)?.pages[0]?.issues[0]).toEqual(canonical);
  });

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

  it('does not resurrect a deleted issue from a delayed full update', () => {
    const client = mount();

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          syncId: 50,
          data: { id: 'issue_1', teamId: TEAM, identifier: 'ENG-3', syncId: 50 },
        }),
      ]),
    );
    expect(idsIn(client)).toEqual([]);

    act(() =>
      capturedHandler?.([
        action({ syncId: 40, data: issue({ title: 'Delayed full row', syncId: 40 }) }),
      ]),
    );

    expect(idsIn(client)).toEqual([]);
  });

  it('cancels a stale detail fetch before applying a newer realtime update', async () => {
    const client = mount();
    const key = queryKeys.issue('ENG-3');
    client.setQueryData(key, detailFor(issue(), []));
    const pendingDetail = deferred<ReturnType<typeof detailFor>>();
    const refetch = client
      .fetchQuery({ queryKey: key, queryFn: () => pendingDetail.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('fetching'));

    act(() =>
      capturedHandler?.([
        action({ syncId: 40, data: { id: 'issue_1', title: 'Newest detail', syncId: 40 } }),
      ]),
    );
    expect(client.getQueryData<ReturnType<typeof detailFor>>(key)?.issue).toMatchObject({
      title: 'Newest detail',
      syncId: 40,
    });

    pendingDetail.resolve(detailFor(issue({ title: 'Stale response', syncId: 11 }), []));
    await refetch;
    await Promise.resolve();

    expect(client.getQueryData<ReturnType<typeof detailFor>>(key)?.issue).toMatchObject({
      title: 'Newest detail',
      syncId: 40,
    });
  });

  it('restarts an initial detail fetch when its issue updates in realtime', async () => {
    const client = mount();
    const key = queryKeys.issue('ENG-3');
    const staleDetail = deferred<ReturnType<typeof detailFor>>();
    const freshDetail = deferred<ReturnType<typeof detailFor>>();
    let requests = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: () => {
        requests += 1;
        return requests === 1 ? staleDetail.promise : freshDetail.promise;
      },
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await waitFor(() => expect(requests).toBe(1));

    act(() =>
      capturedHandler?.([
        action({ syncId: 40, data: { id: 'issue_1', title: 'Newest detail', syncId: 40 } }),
      ]),
    );
    await waitFor(() => expect(requests).toBe(2));
    freshDetail.resolve(detailFor(issue({ title: 'Newest detail', syncId: 40 }), []));
    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(key)?.issue.syncId).toBe(40),
    );

    staleDetail.resolve(detailFor(issue({ title: 'Stale response', syncId: 11 }), []));
    await staleDetail.promise;
    await Promise.resolve();

    expect(client.getQueryData<ReturnType<typeof detailFor>>(key)?.issue).toMatchObject({
      title: 'Newest detail',
      syncId: 40,
    });
    unsubscribe();
  });

  it('cancels only the initial detail fetch named by an issue update', async () => {
    const client = mount();
    client.removeQueries({ queryKey: queryKeys.issues(TEAM), exact: true });
    const matchingKey = queryKeys.issue('ENG-3');
    const unrelatedKey = queryKeys.issue('ENG-99');
    const matching = deferred<ReturnType<typeof detailFor>>();
    const unrelated = deferred<ReturnType<typeof detailFor>>();
    const matchingRequest = client
      .fetchQuery({ queryKey: matchingKey, queryFn: () => matching.promise })
      .catch(() => undefined);
    const unrelatedRequest = client
      .fetchQuery({ queryKey: unrelatedKey, queryFn: () => unrelated.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(matchingKey)?.fetchStatus).toBe('fetching'));
    await waitFor(() => expect(client.getQueryState(unrelatedKey)?.fetchStatus).toBe('fetching'));

    act(() =>
      capturedHandler?.([
        action({ data: issue({ title: 'Newest detail', syncId: 40 }), syncId: 40 }),
      ]),
    );

    await waitFor(() => expect(client.getQueryState(matchingKey)?.fetchStatus).toBe('idle'));
    expect(client.getQueryState(unrelatedKey)?.fetchStatus).toBe('fetching');

    matching.resolve(detailFor(issue({ title: 'Stale response', syncId: 11 }), []));
    unrelated.resolve(detailFor(issue({ identifier: 'ENG-99' }), []));
    await Promise.all([matchingRequest, unrelatedRequest]);
  });

  it('moves a coalesced active detail fetch to the final identifier', async () => {
    const client = mount();
    client.removeQueries({ queryKey: queryKeys.issues(TEAM), exact: true });
    const previousKey = queryKeys.issue('ENG-3');
    const nextKey = queryKeys.issue('DSGN-4');
    const stale = deferred<ReturnType<typeof detailFor>>();
    const fresh = deferred<ReturnType<typeof detailFor>>();
    const requests: string[] = [];
    const previousObserver = new QueryObserver(client, {
      queryKey: previousKey,
      queryFn: () => {
        requests.push('ENG-3');
        return stale.promise;
      },
      retry: false,
    });
    const unsubscribePrevious = previousObserver.subscribe(() => undefined);
    await waitFor(() => expect(requests).toEqual(['ENG-3']));
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 40 });

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
        action({
          data: arrived,
          scopes: ['team:team_design'],
          syncId: 40,
        }),
      ]),
    );

    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(previousKey)?.issue).toEqual(
        arrived,
      ),
    );
    expect(client.getQueryData<ReturnType<typeof detailFor>>(nextKey)?.issue).toEqual(arrived);
    expect(requests).toEqual(['ENG-3']);

    const nextObserver = new QueryObserver(client, {
      queryKey: nextKey,
      queryFn: () => {
        requests.push('DSGN-4');
        return fresh.promise;
      },
      retry: false,
    });
    const unsubscribeNext = nextObserver.subscribe(() => undefined);
    await waitFor(() => expect(requests).toEqual(['ENG-3', 'DSGN-4']));
    fresh.resolve(detailFor(arrived, []));
    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(nextKey)?.issue.syncId).toBe(40),
    );
    stale.resolve(detailFor(issue({ title: 'Stale response', syncId: 11 }), []));
    await stale.promise;
    await Promise.resolve();

    expect(client.getQueryData<ReturnType<typeof detailFor>>(previousKey)?.issue).toMatchObject({
      identifier: 'DSGN-4',
      syncId: 40,
    });
    expect(requests).toEqual(['ENG-3', 'DSGN-4']);
    unsubscribePrevious();
    unsubscribeNext();
  });

  it('migrates a moved detail when canceling its old request rejects', async () => {
    const client = mount();
    client.removeQueries({ queryKey: queryKeys.issues(TEAM), exact: true });
    const previousKey = queryKeys.issue('ENG-3');
    const nextKey = queryKeys.issue('DSGN-4');
    client.setQueryData(previousKey, detailFor(issue(), []));
    const pending = deferred<ReturnType<typeof detailFor>>();
    const request = client
      .fetchQuery({ queryKey: previousKey, queryFn: () => pending.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(previousKey)?.fetchStatus).toBe('fetching'));
    const originalCancel = client.cancelQueries.bind(client);
    client.cancelQueries = (filters, options) =>
      filters?.queryKey?.[0] === ISSUE_ROOT
        ? Promise.reject(new Error('cancel failed'))
        : originalCancel(filters, options);
    const invalidated: unknown[][] = [];
    const originalInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = (filters, options) => {
      if (filters?.queryKey !== undefined) invalidated.push([...filters.queryKey]);
      return originalInvalidate(filters, options);
    };
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });

    try {
      act(() =>
        capturedHandler?.([
          action({
            action: 'delete',
            data: {
              id: 'issue_1',
              teamId: TEAM,
              identifier: 'ENG-3',
              departure: true,
              syncId: 30,
            },
            syncId: 30,
          }),
          action({ data: arrived, scopes: ['team:team_design'], syncId: 30 }),
        ]),
      );

      await waitFor(() =>
        expect(client.getQueryData<ReturnType<typeof detailFor>>(nextKey)?.issue).toEqual(arrived),
      );
      expect(invalidated).toContainEqual([...nextKey]);
    } finally {
      client.cancelQueries = originalCancel;
      client.invalidateQueries = originalInvalidate;
      pending.resolve(detailFor(issue(), []));
      await request;
    }
  });

  it('migrates an equal-sync detail without an issue list cache', async () => {
    const client = mount();
    client.removeQueries({ queryKey: queryKeys.issues(TEAM), exact: true });
    const previousKey = queryKeys.issue('ENG-3');
    const nextKey = queryKeys.issue('DSGN-4');
    const previous = issue({ syncId: 30 });
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });
    client.setQueryData(previousKey, detailFor(previous, []));

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
        action({ data: arrived, scopes: ['team:team_design'], syncId: 30 }),
      ]),
    );

    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(previousKey)?.issue).toEqual(
        arrived,
      ),
    );
    expect(client.getQueryData<ReturnType<typeof detailFor>>(nextKey)?.issue).toEqual(arrived);
  });

  it('migrates an empty old detail when same-sync arrival precedes departure', async () => {
    const client = mount();
    client.removeQueries({ queryKey: queryKeys.issues(TEAM), exact: true });
    const previousKey = queryKeys.issue('ENG-3');
    const nextKey = queryKeys.issue('DSGN-4');
    const pending = deferred<ReturnType<typeof detailFor>>();
    const request = client
      .fetchQuery({ queryKey: previousKey, queryFn: () => pending.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(previousKey)?.fetchStatus).toBe('fetching'));
    const arrived = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 });

    act(() =>
      capturedHandler?.([
        action({ data: arrived, scopes: ['team:team_design'], syncId: 30 }),
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
      ]),
    );

    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(previousKey)?.issue).toEqual(
        arrived,
      ),
    );
    expect(client.getQueryData<ReturnType<typeof detailFor>>(nextKey)?.issue).toEqual(arrived);
    pending.resolve(detailFor(issue(), []));
    await request;
  });

  it('migrates empty old detail keys across two coalesced team moves', async () => {
    const client = mount();
    client.removeQueries({ queryKey: queryKeys.issues(TEAM), exact: true });
    const firstKey = queryKeys.issue('ENG-3');
    const middleKey = queryKeys.issue('DSGN-4');
    const finalKey = queryKeys.issue('PROD-2');
    const firstPending = deferred<ReturnType<typeof detailFor>>();
    const middlePending = deferred<ReturnType<typeof detailFor>>();
    const firstRequest = client
      .fetchQuery({ queryKey: firstKey, queryFn: () => firstPending.promise })
      .catch(() => undefined);
    const middleRequest = client
      .fetchQuery({ queryKey: middleKey, queryFn: () => middlePending.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(firstKey)?.fetchStatus).toBe('fetching'));
    await waitFor(() => expect(client.getQueryState(middleKey)?.fetchStatus).toBe('fetching'));
    const arrived = issue({ teamId: 'team_product', identifier: 'PROD-2', syncId: 31 });

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: TEAM,
            identifier: 'ENG-3',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
        action({
          data: issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 30 }),
          scopes: ['team:team_design'],
          syncId: 30,
        }),
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: 'team_design',
            identifier: 'DSGN-4',
            departure: true,
            syncId: 31,
          },
          scopes: ['team:team_design'],
          syncId: 31,
        }),
        action({ data: arrived, scopes: ['team:team_product'], syncId: 31 }),
      ]),
    );

    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(firstKey)?.issue).toEqual(arrived),
    );
    expect(client.getQueryData<ReturnType<typeof detailFor>>(middleKey)?.issue).toEqual(arrived);
    expect(client.getQueryData<ReturnType<typeof detailFor>>(finalKey)?.issue).toEqual(arrived);
    firstPending.resolve(detailFor(issue(), []));
    middlePending.resolve(detailFor(issue({ identifier: 'DSGN-4' }), []));
    await Promise.all([firstRequest, middleRequest]);
  });

  it('keeps a newer no-list detail fetch ahead of a delayed move pair', async () => {
    const client = mount();
    client.removeQueries({ queryKey: queryKeys.issues(TEAM), exact: true });
    const canonical = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 50 });
    const canonicalKey = queryKeys.issue('DSGN-4');
    client.setQueryData(canonicalKey, detailFor(canonical, []));
    const pending = deferred<ReturnType<typeof detailFor>>();
    const request = client
      .fetchQuery({ queryKey: canonicalKey, queryFn: () => pending.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(canonicalKey)?.fetchStatus).toBe('fetching'));

    act(() =>
      capturedHandler?.([
        action({
          action: 'delete',
          data: {
            id: 'issue_1',
            teamId: 'team_design',
            identifier: 'DSGN-4',
            departure: true,
            syncId: 40,
          },
          scopes: ['team:team_design'],
          syncId: 40,
        }),
        action({
          data: issue({ teamId: 'team_product', identifier: 'PROD-2', syncId: 40 }),
          scopes: ['team:team_product'],
          syncId: 40,
        }),
      ]),
    );
    await Promise.resolve();

    expect(client.getQueryState(canonicalKey)?.fetchStatus).toBe('fetching');
    expect(client.getQueryData<ReturnType<typeof detailFor>>(canonicalKey)?.issue).toEqual(
      canonical,
    );
    expect(client.getQueryData(queryKeys.issue('PROD-2'))).toBeUndefined();

    pending.resolve(detailFor(canonical, []));
    await request;
  });

  it('keeps a newer canonical detail fetch ahead of a delayed full move action', async () => {
    const client = mount();
    const canonical = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 50 });
    client.setQueryData(queryKeys.issues(TEAM), {
      pages: [{ issues: [canonical], nextCursor: null }],
      pageParams: [null],
    });
    const canonicalKey = queryKeys.issue('DSGN-4');
    const fresh = deferred<ReturnType<typeof detailFor>>();
    let requests = 0;
    const observer = new QueryObserver(client, {
      queryKey: canonicalKey,
      queryFn: () => {
        requests += 1;
        return fresh.promise;
      },
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await waitFor(() => expect(requests).toBe(1));

    act(() =>
      capturedHandler?.([
        action({
          data: {
            ...issue({ teamId: 'team_product', identifier: 'PROD-2', syncId: 40 }),
            teamChanged: true,
          },
          scopes: ['team:team_product'],
          syncId: 40,
        }),
      ]),
    );
    await Promise.resolve();

    expect(client.getQueryState(canonicalKey)?.fetchStatus).toBe('fetching');
    expect(client.getQueryData(queryKeys.issue('PROD-2'))).toBeUndefined();
    expect(client.getQueryData<IssuePages>(queryKeys.issues(TEAM))?.pages[0]?.issues).toEqual([
      canonical,
    ]);
    expect(requests).toBe(1);

    fresh.resolve(detailFor(canonical, []));
    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(canonicalKey)?.issue).toEqual(
        canonical,
      ),
    );
    unsubscribe();
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

describe('DeltaBridge workspace sprint membership', () => {
  const cycleId = 'cycle_workspace';

  function cycleRows(client: QueryClient): Issue[] {
    const pages = client.getQueryData<IssuePages>(queryKeys.cycleIssues(cycleId));
    return (pages?.pages ?? []).flatMap((page) => page.issues);
  }

  it('adds an issue from any team to its workspace sprint cache', () => {
    const client = mount();
    client.setQueryData(queryKeys.cycleIssues(cycleId), {
      pages: [{ issues: [], nextCursor: null }],
      pageParams: [null],
    });

    act(() =>
      capturedHandler?.([
        action({
          action: 'insert',
          modelId: 'issue_design',
          data: issue({
            id: 'issue_design',
            teamId: 'team_design',
            identifier: 'DSGN-4',
            cycleId,
            syncId: 30,
          }),
          syncId: 30,
        }),
      ]),
    );

    expect(cycleRows(client).map((row) => row.id)).toEqual(['issue_design']);
  });

  it('keeps a cross-team sprint issue when an unrelated field changes', () => {
    const client = mount();
    client.setQueryData(queryKeys.cycleIssues(cycleId), {
      pages: [
        {
          issues: [issue({ teamId: 'team_design', cycleId })],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });

    act(() =>
      capturedHandler?.([action({ data: { id: 'issue_1', title: 'Still here', syncId: 30 } })]),
    );

    expect(cycleRows(client)).toHaveLength(1);
    expect(cycleRows(client)[0]?.title).toBe('Still here');
  });

  it('removes an issue only when it leaves that workspace sprint', () => {
    const client = mount();
    client.setQueryData(queryKeys.cycleIssues(cycleId), {
      pages: [
        {
          issues: [issue({ teamId: 'team_design', cycleId })],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });

    act(() => capturedHandler?.([action({ data: { id: 'issue_1', cycleId: null, syncId: 30 } })]));

    expect(cycleRows(client)).toEqual([]);
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
    expect(seen).toEqual([[ANALYTICS_ROOT], [BOOTSTRAP_ROOT]]);
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
    expect(seen).toEqual([[ANALYTICS_ROOT], [MILESTONES_ROOT]]);
  });

  it('invalidates the views root for a view delta', () => {
    const client = mount();
    const seen = trackInvalidations(client);
    act(() => capturedHandler?.([action({ model: 'view', modelId: 'view_1', data: {} })]));
    expect(seen).toEqual([[ANALYTICS_ROOT], [VIEWS_ROOT]]);
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
      [ANALYTICS_ROOT],
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
  it('advances the issue cache revision before resetting reconnect caches', async () => {
    const client = mount();
    const revision = issueCacheRevisionGeneration(client);

    act(() => capturedResume?.(0));

    await waitFor(() => expect(issueCacheRevisionGeneration(client)).toBe(revision + 1));
  });

  it('clears cached board pages before reconnect catch up', async () => {
    const client = mount();
    const boardKey = [BOARD_ROOT, 'state'] as const;
    client.setQueryData(boardKey, { groups: [{ id: 'todo' }] });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ syncId: 42, truncated: false, actions: [] }),
      )) as unknown as typeof fetch;

    try {
      act(() => capturedResume?.(17));
      await waitFor(() => expect(client.getQueryData(boardKey)).toBeUndefined());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fences a board request that started before reconnect reset', async () => {
    const client = mount();
    observed.length = 0;
    const boardKey = [BOARD_ROOT, 'state'] as const;
    const stale = deferred<{ version: string }>();
    const fresh = deferred<{ version: string }>();
    let boardRequests = 0;
    client.setQueryData(boardKey, { version: 'cached' });
    const observer = new QueryObserver(client, {
      queryKey: boardKey,
      queryFn: () => {
        boardRequests += 1;
        return boardRequests === 1 ? stale.promise : fresh.promise;
      },
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const firstRequest = observer.refetch().catch(() => undefined);
    await waitFor(() => expect(boardRequests).toBe(1));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL) =>
      Promise.resolve(
        Response.json({ syncId: 42, truncated: false, actions: [] }),
      )) as typeof fetch;

    try {
      act(() => capturedResume?.(17));
      await waitFor(() => expect(boardRequests).toBe(2));
      stale.resolve({ version: 'stale' });
      await stale.promise;
      await Promise.resolve();
      expect(client.getQueryData<{ version: string }>(boardKey)?.version).not.toBe('stale');

      fresh.resolve({ version: 'fresh' });
      await waitFor(() =>
        expect(client.getQueryData<{ version: string }>(boardKey)?.version).toBe('fresh'),
      );
      await waitFor(() => expect(observed).toEqual([42]));
      await firstRequest;
    } finally {
      globalThis.fetch = originalFetch;
      unsubscribe();
    }
  });

  it('recovers an old-identifier detail by stable id without a watermark', async () => {
    const client = mount();
    const previousKey = queryKeys.issue('ENG-3');
    const canonicalKey = queryKeys.issue('DSGN-4');
    const canonical = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 40 });
    client.setQueryData(previousKey, detailFor(issue(), []));
    const observer = new QueryObserver(client, {
      queryKey: previousKey,
      queryFn: () => Promise.reject(new Error('old identifier unavailable')),
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      return Promise.resolve(Response.json(detailFor(canonical, [])));
    }) as typeof fetch;

    try {
      act(() => capturedResume?.(0));
      await waitFor(() =>
        expect(client.getQueryData<ReturnType<typeof detailFor>>(previousKey)?.issue).toEqual(
          canonical,
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
      unsubscribe();
    }

    expect(requested).toContain('/api/issues/issue_1');
    expect(client.getQueryData<ReturnType<typeof detailFor>>(canonicalKey)?.issue).toEqual(
      canonical,
    );
  });

  it('recovers an old-identifier detail by stable id alongside catch up', async () => {
    const client = mount();
    const previousKey = queryKeys.issue('ENG-3');
    const canonicalKey = queryKeys.issue('DSGN-4');
    const canonical = issue({ teamId: 'team_design', identifier: 'DSGN-4', syncId: 40 });
    client.setQueryData(previousKey, detailFor(issue(), []));
    const observer = new QueryObserver(client, {
      queryKey: previousKey,
      queryFn: () => Promise.reject(new Error('old identifier unavailable')),
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      return Promise.resolve(
        url.startsWith('/api/sync')
          ? Response.json({ syncId: 42, truncated: false, actions: [] })
          : Response.json(detailFor(canonical, [])),
      );
    }) as typeof fetch;

    try {
      act(() => capturedResume?.(17));
      await waitFor(() =>
        expect(client.getQueryData<ReturnType<typeof detailFor>>(previousKey)?.issue).toEqual(
          canonical,
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
      unsubscribe();
    }

    expect(requested.sort()).toEqual(['/api/issues/issue_1', '/api/sync?since=17']);
    expect(client.getQueryData<ReturnType<typeof detailFor>>(canonicalKey)?.issue).toEqual(
      canonical,
    );
  });

  it('does not recover an inactive detail during reconnect', async () => {
    const client = mount();
    observed.length = 0;
    client.setQueryData(queryKeys.issue('ENG-3'), detailFor(issue(), []));
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(Response.json({ syncId: 42, truncated: false, actions: [] }));
    }) as typeof fetch;

    try {
      act(() => capturedResume?.(17));
      await waitFor(() => expect(observed).toContain(42));
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requested).toEqual(['/api/sync?since=17']);
  });

  it('aborts and ignores an older reconnect after a newer resume starts', async () => {
    mount();
    observed.length = 0;
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: (AbortSignal | null | undefined)[] = [];
    let requests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      requests += 1;
      return requests === 1 ? first.promise : second.promise;
    }) as typeof fetch;

    try {
      act(() => capturedResume?.(17));
      await waitFor(() => expect(requests).toBe(1));
      act(() => capturedResume?.(18));
      await waitFor(() => expect(requests).toBe(2));
      expect(signals[0]?.aborted).toBe(true);

      second.resolve(Response.json({ syncId: 42, truncated: false, actions: [] }));
      await waitFor(() => expect(observed).toEqual([42]));
      first.resolve(Response.json({ syncId: 41, truncated: false, actions: [] }));
      await first.promise;
      await Promise.resolve();

      expect(observed).toEqual([42]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts an in-flight reconnect when the bridge unmounts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const response = deferred<Response>();
    const signals: (AbortSignal | null | undefined)[] = [];
    observed.length = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return response.promise;
    }) as typeof fetch;
    const mounted = render(
      <QueryClientProvider client={client}>
        <DeltaBridge organizationId="org_1" teamIds={[TEAM]} />
      </QueryClientProvider>,
    );

    try {
      act(() => capturedResume?.(17));
      await waitFor(() => expect(signals).toHaveLength(1));
      mounted.unmount();
      expect(signals[0]?.aborted).toBe(true);
      response.resolve(Response.json({ syncId: 42, truncated: false, actions: [] }));
      await response.promise;
      await Promise.resolve();
      expect(observed).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('clears issue caches before refreshing all queries when no watermark exists', async () => {
    const client = mount();
    const listKey = queryKeys.issues(TEAM);
    const detailKey = queryKeys.issue('ENG-3');
    client.setQueryData(detailKey, detailFor(issue(), []));
    const failedRefetches: string[] = [];
    const listObserver = new QueryObserver(client, {
      queryKey: listKey,
      queryFn: () => {
        failedRefetches.push('list');
        return Promise.reject(new Error('list unavailable'));
      },
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const detailObserver = new QueryObserver(client, {
      queryKey: detailKey,
      queryFn: () => {
        failedRefetches.push('detail');
        return Promise.reject(new Error('detail unavailable'));
      },
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribeList = listObserver.subscribe(() => undefined);
    const unsubscribeDetail = detailObserver.subscribe(() => undefined);
    const invalidations: (unknown[] | null)[] = [];
    const originalInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = (filters?: Parameters<typeof originalInvalidate>[0]) => {
      invalidations.push(filters?.queryKey === undefined ? null : [...filters.queryKey]);
      return Promise.resolve();
    };
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(Response.json({ syncId: 0, truncated: false, actions: [] }));
    }) as typeof fetch;

    try {
      act(() => capturedResume?.(0));
      await waitFor(() => expect(invalidations).toEqual([null]));
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requested).toEqual(['/api/issues/issue_1']);
    expect(client.getQueryData(listKey)).toBeUndefined();
    expect(client.getQueryData(detailKey)).toBeUndefined();
    expect(failedRefetches.sort()).toEqual(['detail', 'list']);
    unsubscribeList();
    unsubscribeDetail();
  });

  it('clears issue caches before applying reconnect catch up', async () => {
    const client = mount();
    client.setQueryData(queryKeys.issue('ENG-3'), detailFor(issue(), []));
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
    expect(client.getQueryData(queryKeys.issues(TEAM))).toBeUndefined();
    expect(client.getQueryData(queryKeys.issue('ENG-3'))).toBeUndefined();
    expect(observed).toContain(42);
    expect(seen).toEqual([
      [ANALYTICS_ROOT],
      [ISSUE_SUMMARY_ROOT],
      [ISSUE_FACETS_ROOT],
      [BOARD_ROOT],
      [MILESTONES_ROOT],
      [BOOTSTRAP_ROOT],
    ]);
  });

  it('clears issue caches even when reconnect catch up fails', async () => {
    const client = mount();
    const detailKey = queryKeys.issue('ENG-3');
    client.setQueryData(detailKey, detailFor(issue(), []));
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.reject(new Error('catch up unavailable'));
    }) as typeof fetch;

    try {
      act(() => capturedResume?.(17));
      await waitFor(() => expect(requested).toContain('/api/sync?since=17'));
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(client.getQueryData(queryKeys.issues(TEAM))).toBeUndefined();
    expect(client.getQueryData(detailKey)).toBeUndefined();
    expect(requested).toEqual(['/api/sync?since=17']);
  });

  it('continues reconnect catch up when an active cache reset rejects', async () => {
    const client = mount();
    observed.length = 0;
    const requested: string[] = [];
    const originalReset = client.resetQueries.bind(client);
    client.resetQueries = (filters, options) => {
      const reset = originalReset(filters, options);
      if (filters?.queryKey?.[0] !== ISSUES_ROOT) return reset;
      return reset.then(() => Promise.reject(new Error('list reset failed')));
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(Response.json({ syncId: 42, truncated: false, actions: [] }));
    }) as typeof fetch;

    try {
      act(() => capturedResume?.(17));
      await waitFor(() => expect(requested).toEqual(['/api/sync?since=17']));
      await waitFor(() => expect(observed).toEqual([42]));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('invalidates nonissue caches when reconnect catch up fails', async () => {
    const client = mount();
    const viewKey = [VIEWS_ROOT, 'mine'] as const;
    client.setQueryData(viewKey, { id: 'view_1' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error('catch up unavailable'))) as unknown as typeof fetch;

    try {
      act(() => capturedResume?.(17));
      await waitFor(() => expect(client.getQueryState(viewKey)?.isInvalidated).toBe(true));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refreshes bootstrap when catch up only contains this tab own echo', async () => {
    const client = mount();
    const seen = trackInvalidations(client);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL) =>
      Promise.resolve(
        Response.json({
          syncId: 42,
          truncated: false,
          actions: [
            action({
              syncId: 42,
              model: 'project',
              modelId: 'project_1',
              originClientId: clientId(),
              data: { id: 'project_1' },
            }),
          ],
        }),
      )) as typeof fetch;

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

    expect(seen).toEqual([[ANALYTICS_ROOT], [BOOTSTRAP_ROOT]]);
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
    parent: null,
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
    const generation = issueDeletionGeneration(client, 'issue_1');

    act(() => capturedHandler?.([deleteAction('issue_1', 'ENG-3')]));

    expect(idsIn(client)).toEqual([]);
    expect(issueDeletionGeneration(client, 'issue_1')).toBe(generation + 1);
  });

  it('forgets the open detail for the issue that was deleted', () => {
    const client = mount();
    client.setQueryData(queryKeys.issue('ENG-3'), detailFor(issue(), []));

    act(() => capturedHandler?.([deleteAction('issue_1', 'ENG-3')]));

    expect(client.getQueryData(queryKeys.issue('ENG-3'))).toBeUndefined();
  });

  it('handles a rejected detail reset while forgetting a realtime deletion', async () => {
    const client = mount();
    const detailKey = queryKeys.issue('ENG-3');
    client.setQueryData(detailKey, detailFor(issue(), []));
    const originalReset = client.resetQueries.bind(client);
    client.resetQueries = (filters, options) =>
      originalReset(filters, options).then(() => Promise.reject(new Error('detail reset failed')));

    try {
      act(() => capturedHandler?.([deleteAction('issue_1', 'ENG-3')]));
      await Promise.resolve();

      expect(client.getQueryData(detailKey)).toBeUndefined();
    } finally {
      client.resetQueries = originalReset;
    }
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

  it('orphans a cached child detail when its parent is deleted', () => {
    const client = mount();
    const parent = issue();
    const child = issue({ id: 'issue_child', identifier: 'ENG-4', parentId: parent.id });
    client.setQueryData(queryKeys.issue(child.identifier), {
      ...detailFor(child, []),
      parent,
    });

    act(() => capturedHandler?.([deleteAction(parent.id, parent.identifier)]));

    const detail = client.getQueryData<ReturnType<typeof detailFor>>(
      queryKeys.issue(child.identifier),
    );
    expect(detail?.issue.parentId).toBeNull();
    expect(detail?.parent).toBeNull();
  });

  it('cancels a pending parent detail before a deleted child can reappear', async () => {
    const client = mount();
    const parent = issue();
    const child = issue({ id: 'issue_child', identifier: 'ENG-4', parentId: parent.id });
    const key = queryKeys.issue(parent.identifier);
    client.setQueryData(key, detailFor(parent, []));
    const pendingDetail = deferred<ReturnType<typeof detailFor>>();
    const refetch = client
      .fetchQuery({ queryKey: key, queryFn: () => pendingDetail.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('fetching'));

    act(() => capturedHandler?.([deleteAction(child.id, child.identifier)]));
    await act(async () => {
      await Promise.resolve();
    });
    pendingDetail.resolve(detailFor(parent, [child]));
    await refetch;
    await Promise.resolve();

    expect(client.getQueryData<ReturnType<typeof detailFor>>(key)?.subIssues).toEqual([]);
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
