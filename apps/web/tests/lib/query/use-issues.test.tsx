import { afterEach, describe, expect, it, mock } from 'bun:test';
import { inCondition } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  recordIssueCacheReset,
  recordIssueDeletions,
  recordIssueListRevisions,
  recordIssueRevisions,
} from '@/lib/query/issue-cache-generation.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import type { IssuePages } from '@/lib/query/sync.ts';
import { flattenIssuePages, mapIssuePages } from '@/lib/query/sync.ts';
import type { IssueMoveSettlement } from '@/lib/query/use-issues.ts';

const toasts: { readonly title: string }[] = [];

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: (input: { readonly title: string }) => toasts.push(input) }),
}));

const {
  authoritativeCachedIssue,
  DEFAULT_ISSUE_QUERY,
  useAssignedIssues,
  useColumnIssues,
  useDeleteIssues,
  useIssues,
  useMoveIssue,
  useUpdateIssue,
} = await import('@/lib/query/use-issues.ts');
const { ISSUE_ROOT, ISSUES_ROOT, queryKeys } = await import('@/lib/query/keys.ts');

const TEAM = 'team_eng';
const originalFetch = globalThis.fetch;

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: TEAM,
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship the board',
    description: '',
    stateId: 'state_todo',
    priority: 0,
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
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

function page(ids: readonly string[], nextCursor: string | null) {
  return {
    issues: ids.map((id) => issue({ id, identifier: `ENG-${id}` })),
    nextCursor,
  };
}

interface FetchLog {
  readonly urls: string[];
  readonly methods: string[];
}

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

function stubFetch(handler: (url: string, init: RequestInit | undefined) => unknown): FetchLog {
  const log: FetchLog = { urls: [], methods: [] };
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    log.urls.push(url);
    log.methods.push(init?.method ?? 'GET');
    return Promise.resolve(
      new Response(JSON.stringify(handler(url, init)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return log;
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function cachedIssue(client: QueryClient, issueId = 'issue_1'): Issue | undefined {
  for (const [, pages] of client.getQueriesData<IssuePages>({
    queryKey: queryKeys.issueTeam(TEAM),
  })) {
    const found = issueFromPagesForTest(pages, issueId);
    if (found !== undefined) return found;
  }
  return undefined;
}

function issuePages(issues: readonly Issue[]): IssuePages {
  return { pages: [{ issues: [...issues], nextCursor: null }], pageParams: [null] };
}

function issueFromPagesForTest(pages: IssuePages | undefined, issueId: string): Issue | undefined {
  return pages === undefined
    ? undefined
    : flattenIssuePages(pages).find((row) => row.id === issueId);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  toasts.length = 0;
});

describe('useIssues', () => {
  it('paints the first page from one request and leaves the rest to the scroller', async () => {
    const log = stubFetch((url) =>
      url.includes('cursor=') ? page(['3', '4'], null) : page(['1', '2'], 'cursor-1'),
    );
    const client = newClient();

    const { result } = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(log.urls).toHaveLength(1);
    expect(result.current.data?.map((row) => row.id)).toEqual(['1', '2']);
    expect(result.current.hasNextPage).toBe(true);

    result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data).toHaveLength(4));

    expect(log.urls).toHaveLength(2);
    expect(log.urls[1]).toContain('cursor=cursor-1');
    expect(result.current.hasNextPage).toBe(false);
  });

  it('asks for one bounded page rather than an unbounded drain', async () => {
    const log = stubFetch(() => page(['1'], null));
    const client = newClient();

    const { result } = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(log.urls[0]).toContain('limit=100');
  });
});

describe('issue mutations patch the cache without a refetch drain', () => {
  it('does not roll back an update across an issue cache reset', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH' ? pending.promise : Promise.resolve(Response.json(page([], null))),
    ) as unknown as typeof fetch;
    const client = newClient();
    const listKey = queryKeys.issues(TEAM);
    const detailKey = queryKeys.issue('ENG-1');
    client.setQueryData(listKey, issuePages([issue()]));
    client.setQueryData(detailKey, detailFor(issue(), []));
    const update = renderHook(() => useUpdateIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = update.result.current
        .mutateAsync({ issue: issue(), patch: { title: 'Optimistic title' } })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing update promise');
    await waitFor(() => expect(cachedIssue(client)?.title).toBe('Optimistic title'));

    const authoritative = issue({ title: 'After reconnect', syncId: 3 });
    act(() => {
      recordIssueCacheReset(client);
      client.setQueryData(listKey, issuePages([authoritative]));
      client.setQueryData(detailKey, detailFor(authoritative, []));
    });

    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'forbidden', message: 'The update failed.' } },
          { status: 403 },
        ),
      );
      expect(await result).toBe('error');
    });

    expect(cachedIssue(client)).toEqual(authoritative);
    expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue).toEqual(
      authoritative,
    );
    await waitFor(() => expect(update.result.current.isError).toBe(true));
  });

  it('does not roll back an update after its committed echo arrives', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH' ? pending.promise : Promise.resolve(Response.json(page([], null))),
    ) as unknown as typeof fetch;
    const client = newClient();
    const listKey = queryKeys.issues(TEAM);
    const detailKey = queryKeys.issue('ENG-1');
    client.setQueryData(listKey, issuePages([issue()]));
    client.setQueryData(detailKey, detailFor(issue(), []));
    const update = renderHook(() => useUpdateIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = update.result.current
        .mutateAsync({ issue: issue(), patch: { title: 'Committed title' } })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing update promise');
    await waitFor(() => expect(cachedIssue(client)?.title).toBe('Committed title'));
    act(() => recordIssueRevisions(client, ['issue_1']));

    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'network_error', message: 'The response was lost.' } },
          { status: 500 },
        ),
      );
      expect(await result).toBe('error');
    });

    expect(cachedIssue(client)?.title).toBe('Committed title');
    expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue.title).toBe(
      'Committed title',
    );
    await waitFor(() => expect(update.result.current.isError).toBe(true));
  });

  it('does not restore an old detail over a newer detail fetch', async () => {
    const pendingUpdate = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? pendingUpdate.promise
        : Promise.resolve(Response.json(page([], null))),
    ) as unknown as typeof fetch;
    const client = newClient();
    const listKey = queryKeys.issues(TEAM);
    const detailKey = queryKeys.issue('ENG-1');
    client.setQueryData(listKey, issuePages([issue()]));
    client.setQueryData(detailKey, detailFor(issue(), []));
    const update = renderHook(() => useUpdateIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = update.result.current
        .mutateAsync({ issue: issue(), patch: { title: 'Optimistic title' } })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing update promise');
    await waitFor(() =>
      expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue.title).toBe(
        'Optimistic title',
      ),
    );

    const fetched = detailFor(issue({ title: 'Fetched title', syncId: 3 }), []);
    await client.fetchQuery({ queryKey: detailKey, queryFn: () => Promise.resolve(fetched) });
    expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)).toEqual(fetched);

    await act(async () => {
      pendingUpdate.resolve(
        Response.json(
          { error: { code: 'network_error', message: 'The response was lost.' } },
          { status: 500 },
        ),
      );
      expect(await result).toBe('error');
    });

    expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)).toEqual(fetched);
    expect(cachedIssue(client)?.title).toBe('Optimistic title');
    await waitFor(() => expect(update.result.current.isError).toBe(true));
  });

  it('does not let an older update response replace a newer detail', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let requests = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return Promise.resolve(Response.json(page([], null)));
      requests += 1;
      return requests === 1 ? first.promise : second.promise;
    }) as unknown as typeof fetch;
    const client = newClient();
    const listKey = queryKeys.issues(TEAM);
    const detailKey = queryKeys.issue('ENG-1');
    client.setQueryData(listKey, issuePages([issue()]));
    client.setQueryData(detailKey, detailFor(issue(), []));
    const firstUpdate = renderHook(() => useUpdateIssue(), { wrapper: wrapper(client) });
    const secondUpdate = renderHook(() => useUpdateIssue(), { wrapper: wrapper(client) });

    let firstResult: Promise<Issue> | undefined;
    await act(async () => {
      firstResult = firstUpdate.result.current.mutateAsync({
        issue: issue(),
        patch: { title: 'First optimistic title' },
      });
      await Promise.resolve();
    });
    if (firstResult === undefined) throw new Error('missing first update promise');
    await waitFor(() => expect(requests).toBe(1));

    let secondResult: Promise<Issue> | undefined;
    await act(async () => {
      secondResult = secondUpdate.result.current.mutateAsync({
        issue: issue({ title: 'First optimistic title' }),
        patch: { title: 'Second optimistic title' },
      });
      await Promise.resolve();
    });
    if (secondResult === undefined) throw new Error('missing second update promise');
    await waitFor(() => expect(requests).toBe(2));

    const newer = issue({ title: 'Second confirmed title', syncId: 3 });
    await act(async () => {
      second.resolve(Response.json({ issue: newer }));
      await secondResult;
    });
    const older = issue({ title: 'First confirmed title', syncId: 2 });
    await act(async () => {
      first.resolve(Response.json({ issue: older }));
      await firstResult;
    });
    await waitFor(() => expect(firstUpdate.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(secondUpdate.result.current.isSuccess).toBe(true));

    expect(cachedIssue(client)).toEqual(newer);
    expect(client.getQueryData<ReturnType<typeof detailFor>>(detailKey)?.issue).toEqual(newer);
  });

  it('sends one write and converges the cached row with zero list refetches', async () => {
    const log = stubFetch((_url, init) => {
      if (init?.method === 'POST') {
        return { issue: issue({ stateId: 'state_doing', syncId: 2 }), rebalanced: [] };
      }
      return page(['issue_1'], null);
    });
    const client = newClient();

    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    expect(log.urls).toHaveLength(1);

    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });
    move.result.current.mutate({
      issue: issue(),
      stateId: 'state_doing',
      beforeId: null,
      afterId: null,
      beforeOrder: null,
      afterOrder: null,
    });

    await waitFor(() => expect(list.result.current.data?.[0]?.stateId).toBe('state_doing'));
    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));

    expect(log.methods.filter((method) => method === 'POST')).toHaveLength(1);
    expect(log.methods.filter((method) => method === 'GET')).toHaveLength(1);
  });

  it('continues a move when list cancellation rejects after canceling', async () => {
    const log = stubFetch((_url, init) =>
      init?.method === 'POST'
        ? { issue: issue({ stateId: 'state_doing', syncId: 2 }), rebalanced: [] }
        : page([], null),
    );
    const client = newClient();
    client.setQueryData(queryKeys.issues(TEAM), issuePages([issue()]));
    const originalCancel = client.cancelQueries.bind(client);
    client.cancelQueries = (filters, options) => {
      const cancellation = originalCancel(filters, options);
      if (filters?.queryKey?.[0] !== ISSUES_ROOT) return cancellation;
      return cancellation.then(() => Promise.reject(new Error('list cancellation failed')));
    };
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    try {
      const settlement = { status: 'pending' as 'pending' | 'success' | 'error' };
      await act(async () => {
        settlement.status = await move.result.current
          .mutateAsync({
            issue: issue(),
            stateId: 'state_doing',
            beforeId: null,
            afterId: null,
            beforeOrder: null,
            afterOrder: null,
          })
          .then(
            () => 'success' as const,
            () => 'error' as const,
          );
      });

      await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
      expect(settlement.status).toBe('success');
      expect(cachedIssue(client)?.stateId).toBe('state_doing');
      expect(log.methods.filter((method) => method === 'POST')).toHaveLength(1);
    } finally {
      client.cancelQueries = originalCancel;
    }
  });

  it('waits for filtered lists to converge before a successful move settles', async () => {
    const pendingRefresh = deferred<Response>();
    let listRequests = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json({
            issue: issue({ stateId: 'state_doing', syncId: 2 }),
            rebalanced: [],
          }),
        );
      }
      listRequests += 1;
      if (listRequests === 1) return Promise.resolve(Response.json(page(['issue_1'], null)));
      return pendingRefresh.promise;
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(
      () =>
        useIssues(TEAM, undefined, {
          filter: {
            kind: 'group',
            combinator: 'and',
            children: [inCondition('state', ['state_todo'])],
          },
          orderBy: 'manual',
        }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });
    const settlement = { status: 'pending' as 'pending' | 'success' | 'error' };
    let issueWasDeleted: boolean | undefined;

    await act(async () => {
      move.result.current
        .mutateAsync({
          issue: issue(),
          stateId: 'state_doing',
          beforeId: null,
          afterId: null,
          beforeOrder: null,
          afterOrder: null,
        })
        .then(
          (result) => {
            issueWasDeleted = result.issueWasDeletedDuringSettlement;
            settlement.status = 'success';
          },
          () => {
            settlement.status = 'error';
          },
        );
      await Promise.resolve();
    });

    await waitFor(() => expect(listRequests).toBe(2));
    expect(settlement.status).toBe('pending');

    act(() => {
      pendingRefresh.resolve(Response.json(page([], null)));
    });
    await waitFor(() => expect(settlement.status).toBe('success'));
    expect(issueWasDeleted).toBe(false);
    await waitFor(() => expect(list.result.current.data).toHaveLength(0));
  });

  it('does not let a filtered settlement refetch resurrect a confirmed deletion', async () => {
    const pendingRefresh = deferred<Response>();
    let listRequests = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json({
            issue: issue({ syncId: 2 }),
            rebalanced: [],
          }),
        );
      }
      listRequests += 1;
      if (listRequests === 1) return Promise.resolve(Response.json(page(['issue_1'], null)));
      return pendingRefresh.promise;
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(
      () =>
        useIssues(TEAM, undefined, {
          filter: {
            kind: 'group',
            combinator: 'and',
            children: [inCondition('state', ['state_todo'])],
          },
          orderBy: 'manual',
        }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<IssueMoveSettlement> | undefined;
    await act(async () => {
      result = move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_todo',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(listRequests).toBe(2));

    act(() => {
      recordIssueDeletions(client, ['issue_1']);
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) => issues.filter((row) => row.id !== 'issue_1')),
      );
    });
    await waitFor(() => expect(list.result.current.data).toHaveLength(0));

    let settlement: IssueMoveSettlement | undefined;
    await act(async () => {
      pendingRefresh.resolve(Response.json({ issues: [issue({ syncId: 2 })], nextCursor: null }));
      settlement = await result;
    });

    expect(settlement?.issueWasDeletedDuringSettlement).toBe(true);
    await waitFor(() => expect(list.result.current.data).toHaveLength(0));
    expect(authoritativeCachedIssue(client, 'issue_1')).toEqual({ kind: 'missing' });
  });

  it('retries a filtered settlement refetch that overwrites a newer revision', async () => {
    const staleRefresh = deferred<Response>();
    let listRequests = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json({
            issue: issue({ syncId: 2 }),
            rebalanced: [],
          }),
        );
      }
      listRequests += 1;
      if (listRequests === 1) return Promise.resolve(Response.json(page(['issue_1'], null)));
      if (listRequests === 2) return staleRefresh.promise;
      return Promise.resolve(
        Response.json({
          issues: [issue({ title: 'Updated elsewhere', syncId: 3 })],
          nextCursor: null,
        }),
      );
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(
      () =>
        useIssues(TEAM, undefined, {
          filter: {
            kind: 'group',
            combinator: 'and',
            children: [inCondition('state', ['state_todo'])],
          },
          orderBy: 'manual',
        }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<IssueMoveSettlement> | undefined;
    await act(async () => {
      result = move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_todo',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(listRequests).toBe(2));

    act(() => {
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) =>
              issues.map((row) =>
                row.id === 'issue_1' ? issue({ title: 'Updated elsewhere', syncId: 3 }) : row,
              ),
            ),
      );
      recordIssueRevisions(client, ['issue_1']);
    });
    await waitFor(() => expect(list.result.current.data?.[0]?.syncId).toBe(3));

    await act(async () => {
      staleRefresh.resolve(Response.json({ issues: [issue({ syncId: 2 })], nextCursor: null }));
      await result;
    });

    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(listRequests).toBe(3);
    expect(cachedIssue(client)).toMatchObject({ title: 'Updated elsewhere', syncId: 3 });
  });

  it('retries a filtered settlement refetch that overwrites an unrelated deletion', async () => {
    const staleRefresh = deferred<Response>();
    let listRequests = 0;
    const deleted = issue({ id: 'issue_2', identifier: 'ENG-2' });
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json({
            issue: issue({ syncId: 2 }),
            rebalanced: [],
          }),
        );
      }
      listRequests += 1;
      if (listRequests === 1) {
        return Promise.resolve(Response.json({ issues: [issue(), deleted], nextCursor: null }));
      }
      if (listRequests === 2) return staleRefresh.promise;
      return Promise.resolve(Response.json({ issues: [issue({ syncId: 2 })], nextCursor: null }));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(
      () =>
        useIssues(TEAM, undefined, {
          filter: {
            kind: 'group',
            combinator: 'and',
            children: [inCondition('state', ['state_todo'])],
          },
          orderBy: 'manual',
        }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(list.result.current.data).toHaveLength(2));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<IssueMoveSettlement> | undefined;
    await act(async () => {
      result = move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_todo',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(listRequests).toBe(2));

    act(() => {
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) => issues.filter((row) => row.id !== deleted.id)),
      );
      recordIssueDeletions(client, [deleted.id]);
      recordIssueListRevisions(
        client,
        client
          .getQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) })
          .map(([key]) => key),
      );
    });
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));

    await act(async () => {
      staleRefresh.resolve(
        Response.json({ issues: [issue({ syncId: 2 }), deleted], nextCursor: null }),
      );
      await result;
    });

    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(listRequests).toBe(3);
    expect(cachedIssue(client, deleted.id)).toBeUndefined();
  });

  it('does not retry a filtered settlement for an unrelated list revision', async () => {
    const staleRefresh = deferred<Response>();
    let listRequests = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json({
            issue: issue({ syncId: 2 }),
            rebalanced: [],
          }),
        );
      }
      listRequests += 1;
      if (listRequests === 1) return Promise.resolve(Response.json(page(['issue_1'], null)));
      if (listRequests === 2) return staleRefresh.promise;
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(
      () =>
        useIssues(TEAM, undefined, {
          filter: {
            kind: 'group',
            combinator: 'and',
            children: [inCondition('state', ['state_todo'])],
          },
          orderBy: 'manual',
        }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<IssueMoveSettlement> | undefined;
    await act(async () => {
      result = move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_todo',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(listRequests).toBe(2));

    act(() => recordIssueRevisions(client, ['issue_on_another_team']));
    await act(async () => {
      staleRefresh.resolve(Response.json({ issues: [issue({ syncId: 2 })], nextCursor: null }));
      await result;
    });

    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(listRequests).toBe(2);
  });

  it('bounds filtered settlement retries during continuous issue revisions', async () => {
    let client: QueryClient | undefined;
    let listRequests = 0;
    let revisions = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json({
            issue: issue({ syncId: 2 }),
            rebalanced: [],
          }),
        );
      }
      listRequests += 1;
      if (listRequests > 1 && revisions < 5) {
        if (client === undefined) throw new Error('missing query client');
        recordIssueRevisions(client, ['issue_1']);
        revisions += 1;
      }
      return Promise.resolve(Response.json({ issues: [issue({ syncId: 2 })], nextCursor: null }));
    }) as unknown as typeof fetch;
    client = newClient();
    const list = renderHook(
      () =>
        useIssues(TEAM, undefined, {
          filter: {
            kind: 'group',
            combinator: 'and',
            children: [inCondition('state', ['state_todo'])],
          },
          orderBy: 'manual',
        }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    await act(async () => {
      await move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_todo',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
    });

    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(listRequests).toBeLessThanOrEqual(5);
  });

  it('does not roll back a move after its committed echo arrives', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST' ? pending.promise : Promise.resolve(Response.json(page([], null))),
    ) as unknown as typeof fetch;
    const client = newClient();
    const key = queryKeys.issues(TEAM);
    client.setQueryData(key, issuePages([issue()]));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = move.result.current
        .mutateAsync({
          issue: issue(),
          stateId: 'state_doing',
          beforeId: null,
          afterId: null,
          beforeOrder: null,
          afterOrder: null,
        })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(cachedIssue(client)?.stateId).toBe('state_doing'));
    act(() => recordIssueRevisions(client, ['issue_1']));

    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'network_error', message: 'The response was lost.' } },
          { status: 500 },
        ),
      );
      expect(await result).toBe('error');
    });

    expect(cachedIssue(client)?.stateId).toBe('state_doing');
    await waitFor(() => expect(move.result.current.isError).toBe(true));
  });

  it('does not roll back a move across an issue cache reset', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST' ? pending.promise : Promise.reject(new Error('list unavailable')),
    ) as unknown as typeof fetch;
    const client = newClient();
    const key = queryKeys.issues(TEAM);
    client.setQueryData(key, issuePages([issue()]));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = move.result.current
        .mutateAsync({
          issue: issue(),
          stateId: 'state_doing',
          beforeId: null,
          afterId: null,
          beforeOrder: null,
          afterOrder: null,
        })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(cachedIssue(client)?.stateId).toBe('state_doing'));
    act(() => recordIssueCacheReset(client));
    await client.resetQueries({ queryKey: key, exact: true });

    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'move_failed', message: 'The move failed.' } },
          { status: 500 },
        ),
      );
      expect(await result).toBe('error');
    });

    expect(cachedIssue(client)).toBeUndefined();
    await waitFor(() => expect(move.result.current.isError).toBe(true));
  });

  it('does not let a failed move roll back a newer cached issue', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return pending.promise;
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = move.result.current
        .mutateAsync({
          issue: issue(),
          stateId: 'state_doing',
          beforeId: null,
          afterId: null,
          beforeOrder: null,
          afterOrder: null,
        })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(list.result.current.data?.[0]?.stateId).toBe('state_doing'));
    act(() => {
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) =>
              issues.map((row) =>
                row.id === 'issue_1' ? issue({ stateId: 'state_done', syncId: 3 }) : row,
              ),
            ),
      );
    });
    await waitFor(() => expect(list.result.current.data?.[0]?.stateId).toBe('state_done'));

    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'move_failed', message: 'The move failed.' } },
          { status: 500 },
        ),
      );
      expect(await result).toBe('error');
    });
    await waitFor(() => expect(move.result.current.isError).toBe(true));
    expect(cachedIssue(client)).toMatchObject({ stateId: 'state_done', syncId: 3 });
  });

  it('does not roll back an equal-head intervening cache write', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return pending.promise;
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = move.result.current
        .mutateAsync({
          issue: issue(),
          stateId: 'state_doing',
          beforeId: null,
          afterId: null,
          beforeOrder: null,
          afterOrder: null,
        })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(list.result.current.data?.[0]?.stateId).toBe('state_doing'));
    act(() => {
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) =>
              issues.map((row) => (row.id === 'issue_1' ? issue({ stateId: 'state_done' }) : row)),
            ),
      );
    });
    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'move_failed', message: 'The move failed.' } },
          { status: 500 },
        ),
      );
      expect(await result).toBe('error');
    });
    await waitFor(() => expect(move.result.current.isError).toBe(true));
    expect(cachedIssue(client)).toMatchObject({ stateId: 'state_done', syncId: 1 });
  });

  it('rolls back a failed move without overwriting a newer sibling', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return pending.promise;
      return Promise.resolve(Response.json(page(['issue_1', 'issue_2'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toHaveLength(2));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = move.result.current
        .mutateAsync({
          issue: issue(),
          stateId: 'state_doing',
          beforeId: null,
          afterId: null,
          beforeOrder: null,
          afterOrder: null,
        })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(list.result.current.data?.[0]?.stateId).toBe('state_doing'));

    act(() => {
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) =>
              issues.map((row) =>
                row.id === 'issue_2' ? { ...row, title: 'Updated sibling', syncId: 3 } : row,
              ),
            ),
      );
    });
    await waitFor(() =>
      expect(list.result.current.data?.find((row) => row.id === 'issue_2')).toMatchObject({
        title: 'Updated sibling',
        syncId: 3,
      }),
    );

    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'move_failed', message: 'The move failed.' } },
          { status: 500 },
        ),
      );
      expect(await result).toBe('error');
    });
    await waitFor(() =>
      expect(list.result.current.data?.find((row) => row.id === 'issue_1')).toMatchObject({
        stateId: 'state_todo',
      }),
    );
    expect(list.result.current.data?.find((row) => row.id === 'issue_2')).toMatchObject({
      title: 'Updated sibling',
      syncId: 3,
    });
  });

  for (const scenario of [
    {
      name: 'waits for canonical restoration when a failed move leaves no optimistic cache occurrence',
      refreshed: page(['issue_1'], null),
      expectedIds: ['issue_1'],
    },
    {
      name: 'does not resurrect an intervening delete when a failed move leaves no optimistic cache occurrence',
      refreshed: page([], null),
      expectedIds: [],
    },
  ] as const) {
    it(scenario.name, async () => {
      const pendingMove = deferred<Response>();
      const pendingRefresh = deferred<Response>();
      let listRequests = 0;
      globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'POST') return pendingMove.promise;
        listRequests += 1;
        if (listRequests === 1) {
          return Promise.resolve(Response.json(page(['issue_1'], null)));
        }
        return pendingRefresh.promise;
      }) as unknown as typeof fetch;
      const client = newClient();
      const column = {
        query: DEFAULT_ISSUE_QUERY,
        groupBy: 'state',
        scope: { teamId: TEAM },
      };
      const source = renderHook(() => useColumnIssues(column, 'state_todo', true), {
        wrapper: wrapper(client),
      });
      await waitFor(() =>
        expect(source.result.current.data?.map((row) => row.id)).toEqual(['issue_1']),
      );
      const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });
      const settlement = { status: 'pending' as 'pending' | 'success' | 'error' };

      let result: Promise<'success' | 'error'> | undefined;
      await act(async () => {
        result = move.result.current
          .mutateAsync({
            issue: issue(),
            stateId: 'state_doing',
            beforeId: null,
            afterId: null,
            beforeOrder: null,
            afterOrder: null,
          })
          .then(
            () => {
              settlement.status = 'success';
              return 'success' as const;
            },
            () => {
              settlement.status = 'error';
              return 'error' as const;
            },
          );
        await Promise.resolve();
      });
      if (result === undefined) throw new Error('missing move promise');
      await waitFor(() => expect(source.result.current.data).toHaveLength(0));

      await act(async () => {
        pendingMove.resolve(
          Response.json(
            { error: { code: 'move_failed', message: 'The move failed.' } },
            { status: 500 },
          ),
        );
        await Promise.resolve();
      });
      await waitFor(() => expect(listRequests).toBe(2));
      expect(settlement.status).toBe('pending');
      expect(source.result.current.data).toHaveLength(0);
      expect(toasts.map((entry) => entry.title)).toEqual(['Could not move that issue']);

      await act(async () => {
        pendingRefresh.resolve(Response.json(scenario.refreshed));
        expect(await result).toBe('error');
      });
      await waitFor(() => expect(move.result.current.isError).toBe(true));
      await waitFor(() =>
        expect(source.result.current.data?.map((row) => row.id)).toEqual([...scenario.expectedIds]),
      );
    });
  }

  it('restores the source snapshot when failed-move canonical refresh is unavailable', async () => {
    let listRequests = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json(
            { error: { code: 'move_failed', message: 'The move failed.' } },
            { status: 500 },
          ),
        );
      }
      listRequests += 1;
      return listRequests === 1
        ? Promise.resolve(Response.json(page(['issue_1'], null)))
        : Promise.resolve(
            Response.json(
              { error: { code: 'offline', message: 'Canonical refresh unavailable.' } },
              { status: 503 },
            ),
          );
    }) as unknown as typeof fetch;
    const client = newClient();
    const column = {
      query: DEFAULT_ISSUE_QUERY,
      groupBy: 'state',
      scope: { teamId: TEAM },
    };
    const source = renderHook(() => useColumnIssues(column, 'state_todo', true), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(source.result.current.data?.map((row) => row.id)).toEqual(['issue_1']),
    );
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    await act(async () => {
      await move.result.current
        .mutateAsync({
          issue: issue(),
          stateId: 'state_doing',
          beforeId: null,
          afterId: null,
          beforeOrder: null,
          afterOrder: null,
        })
        .catch(() => undefined);
    });

    await waitFor(() => expect(move.result.current.isError).toBe(true));
    expect(listRequests).toBe(2);
    expect(source.result.current.data?.map((row) => row.id)).toEqual(['issue_1']);
  });

  for (const scenario of [
    {
      name: 'a deletion generation',
      intervene: (client: QueryClient) => recordIssueDeletions(client, ['issue_1']),
    },
    {
      name: 'a newer issue revision',
      intervene: (client: QueryClient) => recordIssueRevisions(client, ['issue_1']),
    },
    {
      name: 'a newer list revision',
      intervene: (client: QueryClient) =>
        recordIssueListRevisions(
          client,
          client
            .getQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) })
            .map(([key]) => key),
        ),
    },
  ] as const) {
    it(`does not restore a failed-move snapshot after ${scenario.name}`, async () => {
      const pendingMove = deferred<Response>();
      let listRequests = 0;
      globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'POST') return pendingMove.promise;
        listRequests += 1;
        return listRequests === 1
          ? Promise.resolve(Response.json(page(['issue_1'], null)))
          : Promise.resolve(
              Response.json(
                { error: { code: 'offline', message: 'Canonical refresh unavailable.' } },
                { status: 503 },
              ),
            );
      }) as unknown as typeof fetch;
      const client = newClient();
      const column = {
        query: DEFAULT_ISSUE_QUERY,
        groupBy: 'state',
        scope: { teamId: TEAM },
      };
      const source = renderHook(() => useColumnIssues(column, 'state_todo', true), {
        wrapper: wrapper(client),
      });
      await waitFor(() =>
        expect(source.result.current.data?.map((row) => row.id)).toEqual(['issue_1']),
      );
      const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

      let result: Promise<unknown> | undefined;
      await act(async () => {
        result = move.result.current
          .mutateAsync({
            issue: issue(),
            stateId: 'state_doing',
            beforeId: null,
            afterId: null,
            beforeOrder: null,
            afterOrder: null,
          })
          .catch(() => undefined);
        await Promise.resolve();
      });
      if (result === undefined) throw new Error('missing move promise');
      await waitFor(() => expect(source.result.current.data).toHaveLength(0));
      act(() => scenario.intervene(client));

      await act(async () => {
        pendingMove.resolve(
          Response.json(
            { error: { code: 'move_failed', message: 'The move failed.' } },
            { status: 500 },
          ),
        );
        await result;
      });

      await waitFor(() => expect(move.result.current.isError).toBe(true));
      expect(listRequests).toBe(2);
      expect(source.result.current.data).toHaveLength(0);
    });
  }

  it('retries a failed-move refresh that overwrites a newer revision', async () => {
    const pendingMove = deferred<Response>();
    const staleRefresh = deferred<Response>();
    let listRequests = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return pendingMove.promise;
      listRequests += 1;
      if (listRequests === 1) return Promise.resolve(Response.json(page(['issue_1'], null)));
      if (listRequests === 2) return staleRefresh.promise;
      return Promise.resolve(
        Response.json({
          issues: [issue({ title: 'Updated elsewhere', syncId: 3 })],
          nextCursor: null,
        }),
      );
    }) as unknown as typeof fetch;
    const client = newClient();
    const column = {
      query: DEFAULT_ISSUE_QUERY,
      groupBy: 'state',
      scope: { teamId: TEAM },
    };
    const source = renderHook(() => useColumnIssues(column, 'state_todo', true), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(source.result.current.data).toHaveLength(1));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = move.result.current
        .mutateAsync({
          issue: issue(),
          stateId: 'state_doing',
          beforeId: null,
          afterId: null,
          beforeOrder: null,
          afterOrder: null,
        })
        .then(
          () => 'success' as const,
          () => 'error' as const,
        );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(source.result.current.data).toHaveLength(0));

    await act(async () => {
      pendingMove.resolve(
        Response.json(
          { error: { code: 'move_failed', message: 'The move failed.' } },
          { status: 500 },
        ),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(listRequests).toBe(2));

    act(() => {
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, () => [issue({ title: 'Updated elsewhere', syncId: 3 })]),
      );
      recordIssueRevisions(client, ['issue_1']);
    });
    await waitFor(() => expect(source.result.current.data?.[0]?.syncId).toBe(3));

    await act(async () => {
      staleRefresh.resolve(Response.json({ issues: [issue({ syncId: 2 })], nextCursor: null }));
      expect(await result).toBe('error');
    });

    await waitFor(() => expect(move.result.current.isError).toBe(true));
    expect(listRequests).toBe(3);
    expect(cachedIssue(client)).toMatchObject({ title: 'Updated elsewhere', syncId: 3 });
  });

  it('does not let a stale move response replace a newer cached issue', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return pending.promise;
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<IssueMoveSettlement> | undefined;
    await act(async () => {
      result = move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_doing',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(list.result.current.data?.[0]?.stateId).toBe('state_doing'));

    act(() => {
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) =>
              issues.map((row) =>
                row.id === 'issue_1' ? issue({ stateId: 'state_done', syncId: 3 }) : row,
              ),
            ),
      );
    });
    await waitFor(() => expect(list.result.current.data?.[0]?.stateId).toBe('state_done'));

    await act(async () => {
      pending.resolve(
        Response.json({ issue: issue({ stateId: 'state_doing', syncId: 2 }), rebalanced: [] }),
      );
      await result;
    });
    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(cachedIssue(client)).toMatchObject({ stateId: 'state_done', syncId: 3 });
    expect(authoritativeCachedIssue(client, 'issue_1')).toMatchObject({
      kind: 'found',
      issue: { stateId: 'state_done', syncId: 3 },
    });
  });

  it('does not resurrect an issue deleted while a successful move response is in flight', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return pending.promise;
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<IssueMoveSettlement> | undefined;
    await act(async () => {
      result = move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_doing',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() => expect(list.result.current.data?.[0]?.stateId).toBe('state_doing'));

    act(() => {
      recordIssueDeletions(client, ['issue_1']);
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) => issues.filter((row) => row.id !== 'issue_1')),
      );
    });
    await waitFor(() => expect(list.result.current.data).toHaveLength(0));

    let settlement: Awaited<typeof result> | undefined;
    await act(async () => {
      pending.resolve(
        Response.json({ issue: issue({ stateId: 'state_doing', syncId: 2 }), rebalanced: [] }),
      );
      settlement = await result;
    });
    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(settlement?.issueWasDeletedDuringSettlement).toBe(true);
    expect(authoritativeCachedIssue(client, 'issue_1')).toEqual({ kind: 'missing' });
    await waitFor(() => expect(list.result.current.data).toHaveLength(0));
  });

  it('does not resurrect a deleted sibling from a move rebalance response', async () => {
    const pending = deferred<Response>();
    const sibling = issue({ id: 'issue_2', identifier: 'ENG-2', number: 2, sortOrder: 2048 });
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return pending.promise;
      return Promise.resolve(Response.json({ issues: [issue(), sibling], nextCursor: null }));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toHaveLength(2));
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<IssueMoveSettlement> | undefined;
    await act(async () => {
      result = move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_doing',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');

    act(() => {
      recordIssueDeletions(client, [sibling.id]);
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) => issues.filter((row) => row.id !== sibling.id)),
      );
    });
    await waitFor(() => expect(cachedIssue(client, sibling.id)).toBeUndefined());

    await act(async () => {
      pending.resolve(
        Response.json({
          issue: issue({ stateId: 'state_doing', syncId: 2 }),
          rebalanced: [{ ...sibling, sortOrder: 3072, syncId: 2 }],
        }),
      );
      await result;
    });

    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(cachedIssue(client, sibling.id)).toBeUndefined();
  });

  it('keeps observing a confirmed deletion after a successful move settles', async () => {
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json({
            issue: issue({ stateId: 'state_doing', syncId: 2 }),
            rebalanced: [],
          }),
        );
      }
      if (init?.method === 'DELETE') {
        return Promise.resolve(Response.json({ deleted: { id: 'issue_1', identifier: 'ENG-1' } }));
      }
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    let settlement: IssueMoveSettlement | undefined;
    await act(async () => {
      settlement = await move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_doing',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
    });
    expect(settlement).toMatchObject({ issueWasDeletedDuringSettlement: false });

    await act(async () => {
      await remove.result.current.mutateAsync([issue({ stateId: 'state_doing', syncId: 2 })]);
    });

    expect(settlement?.issueWasDeletedDuringSettlement).toBe(true);
  });

  it('captures deletion generation before optimistic query cancellation', async () => {
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          Response.json({
            issue: issue({ stateId: 'state_doing', syncId: 2 }),
            rebalanced: [],
          }),
        );
      }
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    client.setQueryData(queryKeys.issues(TEAM), issuePages([issue()]));
    const cancelQueries = client.cancelQueries.bind(client);
    client.cancelQueries = (filters, options) => {
      recordIssueDeletions(client, ['issue_1']);
      return cancelQueries(filters, options);
    };
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let settlement: IssueMoveSettlement | undefined;
    await act(async () => {
      settlement = await move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_doing',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
    });

    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(settlement?.issueWasDeletedDuringSettlement).toBe(true);
  });

  it('does not re-admit a stale move response into an old group column', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return pending.promise;
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const doingKey = queryKeys.issues(TEAM, `teamId=${TEAM}&stateId=state_doing`);
    client.setQueryData(doingKey, issuePages([]));
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const move = renderHook(() => useMoveIssue(), { wrapper: wrapper(client) });

    let result: Promise<IssueMoveSettlement> | undefined;
    await act(async () => {
      result = move.result.current.mutateAsync({
        issue: issue(),
        stateId: 'state_doing',
        beforeId: null,
        afterId: null,
        beforeOrder: null,
        afterOrder: null,
      });
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing move promise');
    await waitFor(() =>
      expect(
        issueFromPagesForTest(client.getQueryData<IssuePages>(doingKey), 'issue_1'),
      ).toMatchObject({ stateId: 'state_doing' }),
    );

    act(() => {
      client.setQueryData<IssuePages>(doingKey, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) => issues.filter((row) => row.id !== 'issue_1')),
      );
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) =>
              issues.map((row) =>
                row.id === 'issue_1' ? issue({ stateId: 'state_done', syncId: 3 }) : row,
              ),
            ),
      );
    });

    await act(async () => {
      pending.resolve(
        Response.json({ issue: issue({ stateId: 'state_doing', syncId: 2 }), rebalanced: [] }),
      );
      await result;
    });
    await waitFor(() => expect(move.result.current.isSuccess).toBe(true));
    expect(
      issueFromPagesForTest(client.getQueryData<IssuePages>(doingKey), 'issue_1'),
    ).toBeUndefined();
    expect(authoritativeCachedIssue(client, 'issue_1')).toMatchObject({
      kind: 'found',
      issue: { stateId: 'state_done', syncId: 3 },
    });
  });

  it('treats equal-head cache disagreement as ambiguous', () => {
    const client = newClient();
    client.setQueryData(
      queryKeys.issues(TEAM, 'first'),
      issuePages([issue({ stateId: 'state_todo', syncId: 2 })]),
    );
    client.setQueryData(
      queryKeys.issues(TEAM, 'second'),
      issuePages([issue({ stateId: 'state_done', syncId: 2 })]),
    );

    expect(authoritativeCachedIssue(client, 'issue_1').kind).toBe('ambiguous');
  });

  it('treats equal-head values with different property insertion order as one issue', () => {
    const client = newClient();
    const canonical = issue({ syncId: 2 });
    const reordered = Object.fromEntries(Object.entries(canonical).reverse()) as Issue;
    client.setQueryData(queryKeys.issues(TEAM, 'first'), issuePages([canonical]));
    client.setQueryData(queryKeys.issues(TEAM, 'second'), issuePages([reordered]));

    expect(authoritativeCachedIssue(client, 'issue_1')).toMatchObject({
      kind: 'found',
      issue: canonical,
    });
  });

  it('treats full and list-shaped copies of one cache head as one issue', () => {
    const client = newClient();
    const canonical = issue({
      organizationId: 'org_1',
      description: 'Full detail',
      stateEnteredAt: '2026-01-01T00:00:00.000Z',
      syncId: 2,
    });
    const listShaped = {
      ...canonical,
      organizationId: '',
      description: '',
      stateEnteredAt: '',
    };
    client.setQueryData(queryKeys.issues(TEAM, 'full'), issuePages([canonical]));
    client.setQueryData(queryKeys.issues(TEAM, 'list'), issuePages([listShaped]));

    expect(authoritativeCachedIssue(client, 'issue_1')).toMatchObject({
      kind: 'found',
      issue: canonical,
    });
  });

  it('treats reviewer and label ordering as set-equivalent in one cache head', () => {
    const client = newClient();
    const canonical = issue({
      reviewerIds: ['user_1', 'user_2'],
      labelIds: ['label_1', 'label_2'],
      syncId: 2,
    });
    const permuted = issue({
      reviewerIds: ['user_2', 'user_1'],
      labelIds: ['label_2', 'label_1'],
      syncId: 2,
    });
    client.setQueryData(queryKeys.issues(TEAM, 'first'), issuePages([canonical]));
    client.setQueryData(queryKeys.issues(TEAM, 'second'), issuePages([permuted]));

    expect(authoritativeCachedIssue(client, 'issue_1')).toMatchObject({
      kind: 'found',
      issue: canonical,
    });
  });
});

function stubDeletes(refuse: boolean): FetchLog {
  const log: FetchLog = { urls: [], methods: [] };
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    log.urls.push(url);
    log.methods.push(method);
    if (method !== 'DELETE') {
      return Promise.resolve(
        Response.json({
          issues: [
            issue({ id: 'issue_parent', identifier: 'ENG-1' }),
            issue({
              id: 'issue_child',
              identifier: 'ENG-2',
              parentId: 'issue_parent',
              sortOrder: 2048,
            }),
          ],
          nextCursor: null,
        }),
      );
    }
    if (refuse) {
      return Promise.resolve(
        Response.json(
          { error: { code: 'forbidden', message: 'Your role cannot issue delete.' } },
          { status: 403 },
        ),
      );
    }
    const id = url.slice(url.lastIndexOf('/') + 1);
    return Promise.resolve(Response.json({ deleted: { id, identifier: 'ENG-1' } }));
  }) as unknown as typeof fetch;
  return log;
}

async function mountLists(client: QueryClient) {
  const team = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
  const mine = renderHook(() => useAssignedIssues('user_1'), { wrapper: wrapper(client) });
  await waitFor(() => expect(team.result.current.data).toBeDefined());
  await waitFor(() => expect(mine.result.current.data).toBeDefined());
  return { team, mine };
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

describe('deleting an issue', () => {
  it('takes the row out of every cached list before the server answers', async () => {
    stubDeletes(false);
    const client = newClient();
    const { team, mine } = await mountLists(client);
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    remove.result.current.mutate([issue({ id: 'issue_child', identifier: 'ENG-2' })]);

    await waitFor(() =>
      expect(team.result.current.data?.map((row) => row.id)).toEqual(['issue_parent']),
    );
    expect(mine.result.current.data?.map((row) => row.id)).toEqual(['issue_parent']);
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
  });

  it('commits a successful delete when list cancellation rejects after canceling', async () => {
    const log = stubDeletes(false);
    const client = newClient();
    const removed = issue({ id: 'issue_child', identifier: 'ENG-2' });
    client.setQueryData(queryKeys.issues(TEAM), issuePages([removed]));
    client.setQueryData(queryKeys.issue(removed.identifier), detailFor(removed, []));
    const originalCancel = client.cancelQueries.bind(client);
    client.cancelQueries = (filters, options) => {
      const cancellation = originalCancel(filters, options);
      if (filters?.queryKey?.[0] !== ISSUES_ROOT) return cancellation;
      return cancellation.then(() => Promise.reject(new Error('list cancellation failed')));
    };
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    try {
      const settlement = { status: 'pending' as 'pending' | 'success' | 'error' };
      await act(async () => {
        settlement.status = await remove.result.current.mutateAsync([removed]).then(
          () => 'success' as const,
          () => 'error' as const,
        );
      });

      await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
      expect(settlement.status).toBe('success');
      expect(cachedIssue(client, removed.id)).toBeUndefined();
      expect(client.getQueryData(queryKeys.issue(removed.identifier))).toBeUndefined();
      expect(log.methods.filter((method) => method === 'DELETE')).toHaveLength(1);
    } finally {
      client.cancelQueries = originalCancel;
    }
  });

  it('purges details when detail cancellation rejects after canceling', async () => {
    stubDeletes(false);
    const client = newClient();
    const parent = issue({ id: 'issue_parent', identifier: 'ENG-1' });
    const child = issue({ id: 'issue_child', identifier: 'ENG-2', parentId: parent.id });
    const parentKey = queryKeys.issue(parent.identifier);
    client.setQueryData(queryKeys.issues(TEAM), issuePages([parent, child]));
    client.setQueryData(parentKey, detailFor(parent, [child]));
    const pendingDetail = deferred<ReturnType<typeof detailFor>>();
    const refetch = client
      .fetchQuery({ queryKey: parentKey, queryFn: () => pendingDetail.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(parentKey)?.fetchStatus).toBe('fetching'));
    const originalCancel = client.cancelQueries.bind(client);
    client.cancelQueries = (filters, options) => {
      const cancellation = originalCancel(filters, options);
      if (filters?.queryKey?.[0] !== ISSUE_ROOT) return cancellation;
      return cancellation.then(() => Promise.reject(new Error('detail cancellation failed')));
    };
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    try {
      const settlement = { status: 'pending' as 'pending' | 'success' | 'error' };
      await act(async () => {
        settlement.status = await remove.result.current.mutateAsync([child]).then(
          () => 'success' as const,
          () => 'error' as const,
        );
      });

      await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
      expect(settlement.status).toBe('success');
      expect(client.getQueryData<ReturnType<typeof detailFor>>(parentKey)?.subIssues).toEqual([]);
    } finally {
      client.cancelQueries = originalCancel;
      pendingDetail.resolve(detailFor(parent, []));
      await refetch;
    }
  });

  it('handles a rejected detail reset after a successful delete', async () => {
    stubDeletes(false);
    const client = newClient();
    const removed = issue({ id: 'issue_child', identifier: 'ENG-2' });
    const detailKey = queryKeys.issue(removed.identifier);
    client.setQueryData(queryKeys.issues(TEAM), issuePages([removed]));
    client.setQueryData(detailKey, detailFor(removed, []));
    const originalReset = client.resetQueries.bind(client);
    client.resetQueries = (filters, options) =>
      originalReset(filters, options).then(() => Promise.reject(new Error('detail reset failed')));
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    try {
      const settlement = { status: 'pending' as 'pending' | 'success' | 'error' };
      await act(async () => {
        settlement.status = await remove.result.current.mutateAsync([removed]).then(
          () => 'success' as const,
          () => 'error' as const,
        );
        await Promise.resolve();
      });

      await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
      expect(settlement.status).toBe('success');
      expect(client.getQueryData(detailKey)).toBeUndefined();
    } finally {
      client.resetQueries = originalReset;
    }
  });

  it('puts every list back exactly as it was when the server refuses', async () => {
    stubDeletes(true);
    const client = newClient();
    const { team, mine } = await mountLists(client);
    const before = team.result.current.data?.map((row) => row.id);
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    remove.result.current.mutate([issue({ id: 'issue_child', identifier: 'ENG-2' })]);

    await waitFor(() => expect(remove.result.current.isError).toBe(true));
    expect(team.result.current.data?.map((row) => row.id)).toEqual(before ?? []);
    expect(mine.result.current.data?.map((row) => row.id)).toEqual(['issue_parent', 'issue_child']);
  });

  it('does not restore a delete after its committed echo arrives', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'DELETE' ? pending.promise : Promise.resolve(Response.json(page([], null))),
    ) as unknown as typeof fetch;
    const client = newClient();
    const key = queryKeys.issues(TEAM);
    client.setQueryData(key, issuePages([issue()]));
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = remove.result.current.mutateAsync([issue()]).then(
        () => 'success' as const,
        () => 'error' as const,
      );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing delete promise');
    await waitFor(() => expect(cachedIssue(client)).toBeUndefined());
    act(() => recordIssueDeletions(client, ['issue_1']));

    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'network_error', message: 'The response was lost.' } },
          { status: 500 },
        ),
      );
      expect(await result).toBe('error');
    });

    expect(cachedIssue(client)).toBeUndefined();
    await waitFor(() => expect(remove.result.current.isError).toBe(true));
  });

  it('does not restore a delete across an issue cache reset', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'DELETE' ? pending.promise : Promise.resolve(Response.json(page([], null))),
    ) as unknown as typeof fetch;
    const client = newClient();
    const key = queryKeys.issues(TEAM);
    client.setQueryData(key, issuePages([issue()]));
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    let result: Promise<'success' | 'error'> | undefined;
    await act(async () => {
      result = remove.result.current.mutateAsync([issue()]).then(
        () => 'success' as const,
        () => 'error' as const,
      );
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing delete promise');
    await waitFor(() => expect(cachedIssue(client)).toBeUndefined());
    act(() => recordIssueCacheReset(client));
    await client.resetQueries({ queryKey: key, exact: true });

    await act(async () => {
      pending.resolve(
        Response.json(
          { error: { code: 'forbidden', message: 'The delete failed.' } },
          { status: 403 },
        ),
      );
      expect(await result).toBe('error');
    });

    expect(cachedIssue(client)).toBeUndefined();
    await waitFor(() => expect(remove.result.current.isError).toBe(true));
  });

  it('restores a refused delete without overwriting a realtime sibling update', async () => {
    const pendingDelete = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? pendingDelete.promise
        : Promise.resolve(Response.json(page([], null))),
    ) as unknown as typeof fetch;
    const client = newClient();
    const key = queryKeys.issues(TEAM);
    const removed = issue({ id: 'issue_removed', identifier: 'ENG-1' });
    const sibling = issue({ id: 'issue_sibling', identifier: 'ENG-2', number: 2 });
    client.setQueryData(key, issuePages([removed, sibling]));
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    let result: Promise<readonly Issue[]> | undefined;
    await act(async () => {
      result = remove.result.current.mutateAsync([removed]);
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing delete promise');
    await waitFor(() =>
      expect(
        issueFromPagesForTest(client.getQueryData<IssuePages>(key), removed.id),
      ).toBeUndefined(),
    );

    act(() => {
      client.setQueryData<IssuePages>(key, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) =>
              issues.map((row) =>
                row.id === sibling.id
                  ? { ...row, title: 'Realtime sibling title', syncId: row.syncId + 1 }
                  : row,
              ),
            ),
      );
      recordIssueRevisions(client, [sibling.id]);
    });

    await act(async () => {
      pendingDelete.resolve(
        Response.json(
          { error: { code: 'forbidden', message: 'Your role cannot issue delete.' } },
          { status: 403 },
        ),
      );
      await result?.catch(() => undefined);
    });
    await waitFor(() => expect(remove.result.current.isError).toBe(true));

    expect(issueFromPagesForTest(client.getQueryData<IssuePages>(key), removed.id)).toEqual(
      removed,
    );
    expect(issueFromPagesForTest(client.getQueryData<IssuePages>(key), sibling.id)).toMatchObject({
      title: 'Realtime sibling title',
      syncId: 2,
    });
  });

  it('resorts multiple pages after restoring around a realtime sibling move', async () => {
    const pendingDelete = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? pendingDelete.promise
        : Promise.resolve(Response.json(page([], null))),
    ) as unknown as typeof fetch;
    const client = newClient();
    const key = queryKeys.issues(TEAM);
    const removed = issue({ id: 'issue_removed', identifier: 'ENG-1', sortOrder: 1 });
    const sibling = issue({ id: 'issue_sibling', identifier: 'ENG-2', number: 2, sortOrder: 2 });
    client.setQueryData<IssuePages>(key, {
      pages: [
        { issues: [removed], nextCursor: 'next' },
        { issues: [sibling], nextCursor: null },
      ],
      pageParams: [null, 'next'],
    });
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    let result: Promise<readonly Issue[]> | undefined;
    await act(async () => {
      result = remove.result.current.mutateAsync([removed]);
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing delete promise');
    await waitFor(() =>
      expect(
        issueFromPagesForTest(client.getQueryData<IssuePages>(key), removed.id),
      ).toBeUndefined(),
    );

    act(() => {
      client.setQueryData<IssuePages>(key, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) =>
              issues.map((row) =>
                row.id === sibling.id ? { ...row, sortOrder: 0, syncId: row.syncId + 1 } : row,
              ),
            ),
      );
      recordIssueRevisions(client, [sibling.id]);
    });

    await act(async () => {
      pendingDelete.resolve(
        Response.json(
          { error: { code: 'forbidden', message: 'Your role cannot issue delete.' } },
          { status: 403 },
        ),
      );
      await result?.catch(() => undefined);
    });
    await waitFor(() => expect(remove.result.current.isError).toBe(true));

    const restored = client.getQueryData<IssuePages>(key);
    expect(restored === undefined ? [] : flattenIssuePages(restored).map((row) => row.id)).toEqual([
      sibling.id,
      removed.id,
    ]);
    expect(issueFromPagesForTest(restored, sibling.id)).toMatchObject({ sortOrder: 0, syncId: 2 });
  });

  it('drops a row again when a stale list result lands before deletion confirms', async () => {
    const pendingDelete = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'DELETE') return pendingDelete.promise;
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const list = renderHook(() => useIssues(TEAM, undefined), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    let result: Promise<readonly Issue[]> | undefined;
    await act(async () => {
      result = remove.result.current.mutateAsync([issue()]);
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing delete promise');
    await waitFor(() => expect(list.result.current.data).toHaveLength(0));

    act(() => {
      client.setQueriesData<IssuePages>({ queryKey: queryKeys.issueTeam(TEAM) }, (current) =>
        current === undefined
          ? current
          : mapIssuePages(current, (issues) => [...issues, issue({ syncId: 1 })]),
      );
    });
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));

    await act(async () => {
      pendingDelete.resolve(Response.json({ deleted: { id: 'issue_1', identifier: 'ENG-1' } }));
      await result;
    });

    await waitFor(() => expect(list.result.current.data).toHaveLength(0));
  });

  it('cancels a stale list result that is still pending when deletion confirms', async () => {
    const pendingDelete = deferred<Response>();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'DELETE') return pendingDelete.promise;
      return Promise.resolve(Response.json(page(['issue_1'], null)));
    }) as unknown as typeof fetch;
    const client = newClient();
    const key = queryKeys.issues(TEAM);
    client.setQueryData(key, issuePages([issue()]));
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    let result: Promise<readonly Issue[]> | undefined;
    await act(async () => {
      result = remove.result.current.mutateAsync([issue()]);
      await Promise.resolve();
    });
    if (result === undefined) throw new Error('missing delete promise');
    expect(issueFromPagesForTest(client.getQueryData<IssuePages>(key), 'issue_1')).toBeUndefined();
    const pendingRefresh = deferred<IssuePages>();
    const refetch = client
      .fetchQuery({ queryKey: key, queryFn: () => pendingRefresh.promise })
      .catch(() => undefined);

    await act(async () => {
      pendingDelete.resolve(Response.json({ deleted: { id: 'issue_1', identifier: 'ENG-1' } }));
      await result;
    });
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(issueFromPagesForTest(client.getQueryData<IssuePages>(key), 'issue_1')).toBeUndefined();

    await act(async () => {
      pendingRefresh.resolve(issuePages([issue()]));
      await refetch;
    });
    expect(issueFromPagesForTest(client.getQueryData<IssuePages>(key), 'issue_1')).toBeUndefined();
  });

  it('frees a cached child rather than leaving it pointing at a row that is gone', async () => {
    stubDeletes(false);
    const client = newClient();
    const { team } = await mountLists(client);
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    remove.result.current.mutate([issue({ id: 'issue_parent', identifier: 'ENG-1' })]);

    await waitFor(() =>
      expect(team.result.current.data?.map((row) => row.id)).toEqual(['issue_child']),
    );
    expect(team.result.current.data?.[0]?.parentId).toBeNull();
  });

  it('orphans a cached child detail when its parent is deleted', async () => {
    stubDeletes(false);
    const client = newClient();
    await mountLists(client);
    const parent = issue({ id: 'issue_parent', identifier: 'ENG-1' });
    const child = issue({ id: 'issue_child', identifier: 'ENG-2', parentId: parent.id });
    client.setQueryData(queryKeys.issue(child.identifier), {
      ...detailFor(child, []),
      parent,
    });
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    remove.result.current.mutate([parent]);

    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    const detail = client.getQueryData<ReturnType<typeof detailFor>>(
      queryKeys.issue(child.identifier),
    );
    expect(detail?.issue.parentId).toBeNull();
    expect(detail?.parent).toBeNull();
  });

  it('forgets the detail the deleted issue owned and trims it out of its parent', async () => {
    stubDeletes(false);
    const client = newClient();
    await mountLists(client);
    const child = issue({ id: 'issue_child', identifier: 'ENG-2', parentId: 'issue_parent' });
    client.setQueryData(queryKeys.issue('ENG-2'), detailFor(child, []));
    client.setQueryData(
      queryKeys.issue('ENG-1'),
      detailFor(issue({ id: 'issue_parent', identifier: 'ENG-1' }), [child]),
    );
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    remove.result.current.mutate([child]);

    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(client.getQueryData(queryKeys.issue('ENG-2'))).toBeUndefined();
    const parent = client.getQueryData<{ subIssues: readonly Issue[] }>(queryKeys.issue('ENG-1'));
    expect(parent?.subIssues).toEqual([]);
  });

  it('cancels a pending parent detail before a deleted child can reappear', async () => {
    stubDeletes(false);
    const client = newClient();
    await mountLists(client);
    const parent = issue({ id: 'issue_parent', identifier: 'ENG-1' });
    const child = issue({ id: 'issue_child', identifier: 'ENG-2', parentId: parent.id });
    const key = queryKeys.issue(parent.identifier);
    client.setQueryData(key, detailFor(parent, []));
    const pendingDetail = deferred<ReturnType<typeof detailFor>>();
    const refetch = client
      .fetchQuery({ queryKey: key, queryFn: () => pendingDetail.promise })
      .catch(() => undefined);
    await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('fetching'));
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    remove.result.current.mutate([child]);

    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    pendingDetail.resolve(detailFor(parent, [child]));
    await refetch;
    await Promise.resolve();
    expect(client.getQueryData<ReturnType<typeof detailFor>>(key)?.subIssues).toEqual([]);
  });

  it('keeps the issues that really went when a bulk delete is refused half way', async () => {
    const log: FetchLog = { urls: [], methods: [] };
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      log.urls.push(url);
      log.methods.push(method);
      if (method !== 'DELETE') {
        return Promise.resolve(
          Response.json({
            issues: [
              issue({ id: 'issue_parent', identifier: 'ENG-1' }),
              issue({ id: 'issue_child', identifier: 'ENG-2' }),
            ],
            nextCursor: null,
          }),
        );
      }
      if (url.endsWith('issue_child')) {
        return Promise.resolve(
          Response.json(
            { error: { code: 'forbidden', message: 'Your role cannot issue delete.' } },
            { status: 403 },
          ),
        );
      }
      return Promise.resolve(
        Response.json({ deleted: { id: 'issue_parent', identifier: 'ENG-1' } }),
      );
    }) as unknown as typeof fetch;

    const client = newClient();
    const { team } = await mountLists(client);
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    remove.result.current.mutate([
      issue({ id: 'issue_parent', identifier: 'ENG-1' }),
      issue({ id: 'issue_child', identifier: 'ENG-2' }),
    ]);

    await waitFor(() => expect(remove.result.current.isError).toBe(true));
    expect(team.result.current.data?.map((row) => row.id)).toEqual(['issue_child']);
  });

  it('finishes partial-delete recovery when list cancellation rejects after canceling', async () => {
    let deletes = 0;
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'DELETE') return Promise.resolve(Response.json(page([], null)));
      deletes += 1;
      if (deletes === 1) {
        return Promise.resolve(
          Response.json({ deleted: { id: 'issue_parent', identifier: 'ENG-1' } }),
        );
      }
      return Promise.resolve(
        Response.json(
          { error: { code: 'forbidden', message: 'Your role cannot issue delete.' } },
          { status: 403 },
        ),
      );
    }) as unknown as typeof fetch;
    const client = newClient();
    const parent = issue({ id: 'issue_parent', identifier: 'ENG-1' });
    const child = issue({ id: 'issue_child', identifier: 'ENG-2', parentId: parent.id });
    client.setQueryData(queryKeys.issues(TEAM), issuePages([parent, child]));
    client.setQueryData(queryKeys.issue(parent.identifier), detailFor(parent, [child]));
    client.setQueryData(queryKeys.issue(child.identifier), {
      ...detailFor(child, []),
      parent,
    });
    const originalCancel = client.cancelQueries.bind(client);
    let listCancellations = 0;
    client.cancelQueries = (filters, options) => {
      const cancellation = originalCancel(filters, options);
      if (filters?.queryKey?.[0] !== ISSUES_ROOT) return cancellation;
      listCancellations += 1;
      return listCancellations === 1
        ? cancellation
        : cancellation.then(() => Promise.reject(new Error('list cancellation failed')));
    };
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    try {
      await act(async () => {
        await remove.result.current.mutateAsync([parent, child]).catch(() => undefined);
      });

      await waitFor(() => expect(remove.result.current.isError).toBe(true));
      expect(cachedIssue(client, parent.id)).toBeUndefined();
      expect(cachedIssue(client, child.id)).toMatchObject({ id: child.id, parentId: null });
      expect(client.getQueryData(queryKeys.issue(parent.identifier))).toBeUndefined();
      expect(
        client.getQueryData<ReturnType<typeof detailFor>>(queryKeys.issue(child.identifier)),
      ).toMatchObject({ issue: { parentId: null }, parent: null });
      expect(toasts.map((toast) => toast.title)).toContain('Could not delete');
    } finally {
      client.cancelQueries = originalCancel;
    }
  });

  it('sends one delete per selected issue when the bar deletes in bulk', async () => {
    const log = stubDeletes(false);
    const client = newClient();
    await mountLists(client);
    const remove = renderHook(() => useDeleteIssues(), { wrapper: wrapper(client) });

    remove.result.current.mutate([
      issue({ id: 'issue_parent', identifier: 'ENG-1' }),
      issue({ id: 'issue_child', identifier: 'ENG-2' }),
    ]);

    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    const deletes = log.urls.filter((_url, index) => log.methods[index] === 'DELETE');
    expect(deletes).toEqual(['/api/issues/issue_parent', '/api/issues/issue_child']);
  });
});
