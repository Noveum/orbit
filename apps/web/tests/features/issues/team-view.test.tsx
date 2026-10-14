import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { groupColumnSearch } from '@/lib/query/issue-search.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import type { IssuePages } from '@/lib/query/sync.ts';
import { DEFAULT_ISSUE_QUERY, issueSearch } from '@/lib/query/use-issues.ts';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile(['@/features/issues/workspace-provider.tsx']);

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock() }),
  usePathname: () => '/team/eng/board',
  useSearchParams: () => new URLSearchParams(),
}));

mock.module('@/features/comments/viewer-presence.tsx', () => ({
  ViewerPresence: () => null,
}));

const todo: WorkflowState = {
  id: 'state_todo',
  teamId: 'team_eng',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 1,
};

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: todo.teamId,
    number: 1,
    identifier: 'ENG-1',
    title: 'First task',
    description: '',
    stateId: todo.id,
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

const second = issue({
  id: 'issue_2',
  number: 2,
  identifier: 'ENG-2',
  title: 'Second task',
  sortOrder: 2048,
});

let workspace: WorkspaceData;
mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { TeamView } = await import('@/features/issues/team-view.tsx');

const nativeFetch = globalThis.fetch;
const nativeRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');

beforeEach(() => {
  workspace = {
    ready: true,
    userId: 'user_1',
    role: 'admin',
    teams: [{ id: todo.teamId, name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
    states: [todo],
    labels: [],
    members: [],
    projects: [],
    cycles: [],
    seedIssues: [],
    stateById: new Map([[todo.id, todo]]),
    labelById: new Map(),
    memberById: new Map(),
    openQuickCreate: mock(),
  };
  HTMLElement.prototype.getBoundingClientRect = function getTeamBoardRect() {
    const card = this.matches('li');
    const index = card ? Array.from(this.parentElement?.children ?? []).indexOf(this) : 0;
    return new DOMRect(0, card ? 80 + index * 90 : 60, card ? 260 : 280, card ? 72 : 500);
  };
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
  if (nativeRect === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
  } else {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', nativeRect);
  }
});

function deferredResponse() {
  let resolveResponse: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  if (resolveResponse === undefined) throw new Error('response was not initialized');
  return { promise, resolve: resolveResponse };
}

async function mountRestoredBoard() {
  const initialList = deferredResponse();
  const pendingMove = deferredResponse();
  const pendingBoard = deferredResponse();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listKey = queryKeys.issues(todo.teamId, issueSearch(todo.teamId, DEFAULT_ISSUE_QUERY));
  const columnKey = queryKeys.issues(
    todo.teamId,
    groupColumnSearch(DEFAULT_ISSUE_QUERY, 'state', todo.id, { teamId: todo.teamId }),
  );
  let listRequests = 0;
  let moves = 0;
  let listDenied = false;
  const moved = issue({ sortOrder: 3072, syncId: 2 });
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      moves += 1;
      return pendingMove.promise;
    }
    if (url.startsWith('/api/issues/board?')) return pendingBoard.promise;
    if (url.startsWith('/api/issues/summary?'))
      return Promise.resolve(Response.json({ total: 2, groupTotals: { [todo.id]: 2 } }));
    if (url.startsWith('/api/issues/facets?'))
      return Promise.resolve(Response.json({ scopeTotal: 2, facets: {} }));
    if (url.startsWith('/api/issues?')) {
      listRequests += 1;
      return listRequests === 1
        ? initialList.promise
        : Promise.resolve(
            listDenied
              ? Response.json(
                  { error: { code: 'FORBIDDEN', message: 'Access denied' } },
                  { status: 403 },
                )
              : Response.json({ issues: [second, moved], nextCursor: null }),
          );
    }
    return Promise.resolve(Response.json({ views: [] }));
  }) as unknown as typeof fetch;
  const element = (layout: 'board' | 'list' = 'board') => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <HotkeyProvider>
            <TeamView teamKey="eng" layout={layout} />
          </HotkeyProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
  const view = render(element());
  await waitFor(() => expect(client.getQueryState(listKey)?.fetchStatus).toBe('fetching'));
  expect(client.getQueryData(listKey)).toBeUndefined();
  expect(screen.getByTestId('list-skeleton')).toBeInTheDocument();
  expect(screen.queryByTestId('board-drag-status')).toBeNull();
  const restored = new QueryClient();
  const pages: IssuePages = {
    pages: [{ issues: [issue(), second], nextCursor: null }],
    pageParams: [null],
  };
  restored.setQueryData(listKey, pages);
  restored.setQueryData(columnKey, pages);
  await act(async () => {
    hydrate(client, dehydrate(restored));
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByTestId('issue-card-ENG-1')).toBeInTheDocument());
  return {
    client,
    listKey,
    columnKey,
    pendingMove,
    moved,
    moves: () => moves,
    denyList: () => {
      listDenied = true;
    },
    rerender: (layout: 'board' | 'list' = 'board') => view.rerender(element(layout)),
  };
}

async function dropFirstCard() {
  const card = screen.getByRole('listitem', { name: 'ENG-1: First task' });
  card.focus();
  await act(async () => {
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(2));
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fireEvent.keyDown(card, { key: 'ArrowDown', code: 'ArrowDown' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() =>
    expect(screen.getByTestId('board-drag-status')).toHaveTextContent('position 2 of 2'),
  );
  await act(async () => {
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('TeamView pending board moves', () => {
  it('keeps a restored board mounted when cancelling its initial list fetch removes cached data', async () => {
    const view = await mountRestoredBoard();
    const status = screen.getByTestId('board-drag-status');
    await dropFirstCard();
    await waitFor(() => expect(view.moves()).toBe(1));
    expect(view.client.getQueryData(view.listKey)).toBeUndefined();
    expect(view.client.getQueryState(view.listKey)?.status).toBe('pending');
    expect(status.isConnected).toBe(true);
    expect(status).toHaveTextContent('Dropping ENG-1');

    await act(async () => {
      view.pendingMove.resolve(Response.json({ issue: view.moved, rebalanced: [] }));
      await view.pendingMove.promise;
    });
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'Moved ENG-1 from column Todo, position 1 of 2 to column Todo, position 2 of 2.',
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('listitem', { name: 'ENG-1: First task' }),
      ),
    );
    expect(screen.getByTestId('board-drag-status')).toBe(status);
    const rows = view.client.getQueryData<IssuePages>(view.columnKey)?.pages[0]?.issues;
    expect(rows?.map((row) => row.identifier)).toEqual(['ENG-2', 'ENG-1']);
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: view.listKey, exact: true });
    });
    expect(view.client.getQueryState(view.listKey)?.status).toBe('success');
    expect(screen.getByTestId('board-drag-status')).toBe(status);
    expect(screen.queryByTestId('list-skeleton')).toBeNull();
  });

  it.each(['permission', 'layout', 'workspace', 'team'] as const)(
    'ends a pending board activity when the %s context is lost',
    async (context) => {
      const view = await mountRestoredBoard();
      const status = screen.getByTestId('board-drag-status');
      await dropFirstCard();
      await waitFor(() => expect(view.moves()).toBe(1));
      if (context === 'permission') workspace = { ...workspace, role: 'guest' };
      if (context === 'workspace') workspace = { ...workspace, ready: false };
      if (context === 'team') workspace = { ...workspace, teams: [] };
      view.rerender(context === 'layout' ? 'list' : 'board');
      expect(status.isConnected).toBe(false);
      expect(screen.queryByTestId('board-drag-status')).toBeNull();
      await act(async () => {
        view.pendingMove.resolve(Response.json({ issue: view.moved, rebalanced: [] }));
        await view.pendingMove.promise;
      });
      expect(screen.queryByTestId('board-drag-status')).toBeNull();
    },
  );

  it('unmounts a held board when the list reload is denied', async () => {
    const view = await mountRestoredBoard();
    const status = screen.getByTestId('board-drag-status');
    await dropFirstCard();
    await waitFor(() => expect(view.moves()).toBe(1));
    view.denyList();
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: view.listKey, exact: true });
    });
    await waitFor(() => expect(screen.getByTestId('retry-team-issues')).toBeInTheDocument());
    expect(status.isConnected).toBe(false);
    expect(screen.queryByTestId('board-drag-status')).toBeNull();
    await act(async () => {
      view.pendingMove.resolve(Response.json({ issue: view.moved, rebalanced: [] }));
      await view.pendingMove.promise;
    });
    expect(screen.getByTestId('retry-team-issues')).toBeInTheDocument();
    expect(screen.queryByTestId('board-drag-status')).toBeNull();
  });
});
