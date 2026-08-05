import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Issue } from './schemas.ts';

mock.module('@/components/ui/toast.tsx', () => ({ useToast: () => ({ toast: () => undefined }) }));

const { useColumnIssues, useMoveIssue } = await import('./use-issues.ts');

const TEAM = 'team_eng';
const originalFetch = globalThis.fetch;

const FILTER = {
  filter: {
    kind: 'group' as const,
    combinator: 'and' as const,
    children: [
      {
        kind: 'condition' as const,
        property: 'priority' as const,
        operator: 'is' as const,
        values: ['1'],
      },
    ],
  },
  orderBy: 'manual' as const,
};

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
    priority: 1,
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

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('audit: filtered board drag bounces back to the source column', () => {
  it('repaints the card in the column it left while the move is in flight', async () => {
    const card = issue({ id: 'a', identifier: 'ENG-A', stateId: 'todo' });
    let moved = false;
    let resolveMove: (value: Response) => void = () => undefined;

    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/move') && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveMove = resolve;
        });
      }
      const state = /stateId=([^&]+)/.exec(url)?.[1] ?? '';
      const live = moved ? { ...card, stateId: 'doing' } : card;
      const rows = live.stateId === state ? [live] : [];
      return Promise.resolve(
        new Response(JSON.stringify({ issues: rows, nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => ({
        todo: useColumnIssues(TEAM, FILTER, 'todo', true),
        doing: useColumnIssues(TEAM, FILTER, 'doing', true),
        move: useMoveIssue(TEAM),
      }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.todo.data).toHaveLength(1));
    expect(result.current.doing.data).toHaveLength(0);

    result.current.move.mutate({
      issue: card,
      stateId: 'doing',
      beforeId: null,
      afterId: null,
      beforeOrder: null,
      afterOrder: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    console.log(
      'mid-flight -> todo:',
      result.current.todo.data?.map((r) => r.id),
      'doing:',
      result.current.doing.data?.map((r) => r.id),
    );

    moved = true;
    resolveMove(
      new Response(JSON.stringify({ issue: { ...card, stateId: 'doing' }, rebalanced: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    console.log(
      'settled -> todo:',
      result.current.todo.data?.map((r) => r.id),
      'doing:',
      result.current.doing.data?.map((r) => r.id),
    );
  });
});
