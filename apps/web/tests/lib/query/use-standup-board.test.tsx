import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { queryKeys } from '../../../src/lib/query/keys.ts';
import type { Issue } from '../../../src/lib/query/schemas.ts';
import { useStandupBoard } from '../../../src/lib/query/use-standup-board.ts';

const originalFetch = globalThis.fetch;

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_eng',
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship the board',
    description: '',
    stateId: 'state_doing',
    priority: 0,
    creatorId: 'user_1',
    assigneeId: 'user_1',
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
    stateEnteredAt: '2026-06-08T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

const SINCE = new Date('2026-06-08T07:00:00.000Z');

function stubFetch(body: unknown, status = 200): string[] {
  const urls: string[] = [];
  globalThis.fetch = mock((input: string | URL | Request) => {
    urls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return urls;
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

describe('useStandupBoard', () => {
  it('reads the whole board in one request keyed by the window start', async () => {
    const urls = stubFetch({
      since: SINCE.toISOString(),
      issues: [issue()],
      workload: [{ userId: 'user_1', open: 4, inProgress: 1, completedSince: 2 }],
    });
    const client = newClient();

    const { result } = renderHook(() => useStandupBoard(SINCE), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(urls).toEqual([`/api/standup/board?since=${encodeURIComponent(SINCE.toISOString())}`]);
    expect(result.current.data?.issues).toHaveLength(1);
    expect(result.current.data?.workload[0]).toEqual({
      userId: 'user_1',
      open: 4,
      inProgress: 1,
      completedSince: 2,
    });
  });

  it('caches under the standup board key so the realtime root reaches it', async () => {
    stubFetch({ since: SINCE.toISOString(), issues: [], workload: [] });
    const client = newClient();

    const { result } = renderHook(() => useStandupBoard(SINCE), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(queryKeys.standupBoard(SINCE.toISOString()))).toBeDefined();
    expect(queryKeys.standupBoard(SINCE.toISOString())[0]).toBe('standup');
  });

  it('keeps the previous board on screen while a newer one loads', async () => {
    stubFetch({ since: SINCE.toISOString(), issues: [issue()], workload: [] });
    const client = newClient();

    const { result, rerender } = renderHook(
      ({ since }: { since: Date }) => useStandupBoard(since),
      {
        wrapper: wrapper(client),
        initialProps: { since: SINCE },
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ since: new Date('2026-06-05T07:00:00.000Z') });

    expect(result.current.data?.issues).toHaveLength(1);
    expect(result.current.isPending).toBe(false);
  });

  it('surfaces a failed board rather than pretending it is empty', async () => {
    stubFetch({ error: { code: 'internal', message: 'boom' } }, 500);
    const client = newClient();

    const { result } = renderHook(() => useStandupBoard(SINCE), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
