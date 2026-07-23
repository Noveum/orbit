import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Issue } from './schemas.ts';

mock.module('@/components/ui/toast.tsx', () => ({ useToast: () => ({ toast: () => undefined }) }));

const { useIssues, useMoveIssue } = await import('./use-issues.ts');

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

afterEach(() => {
  globalThis.fetch = originalFetch;
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

    const move = renderHook(() => useMoveIssue(TEAM), { wrapper: wrapper(client) });
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
});
