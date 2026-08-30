import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { defaultDisplayOptions, emptyFilterGroup } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { groupIssues } from '@/features/filters/grouping.ts';
import type { BoardColumnSource } from '@/features/issues/board.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { boardSearch } from '@/lib/query/issue-search.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { BoardPage, Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { seedBoardColumns } from '@/lib/query/use-issues.ts';

const push = mock();
const nativeFetch = globalThis.fetch;
const nativeGetBoundingClientRect = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getBoundingClientRect',
);
const nativeRequestAnimationFrame = window.requestAnimationFrame;
const nativeCancelAnimationFrame = window.cancelAnimationFrame;
beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: mock(async () => new Response('{}', { status: 200 })),
  });
});
afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: nativeFetch,
  });
  if (nativeGetBoundingClientRect === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
  } else {
    Object.defineProperty(
      HTMLElement.prototype,
      'getBoundingClientRect',
      nativeGetBoundingClientRect,
    );
  }
  window.requestAnimationFrame = nativeRequestAnimationFrame;
  window.cancelAnimationFrame = nativeCancelAnimationFrame;
});
mock.module('next/navigation', () => ({
  useRouter: () => ({ push, replace: mock(), refresh: mock() }),
  usePathname: () => '/team/eng/board',
  useSearchParams: () => new URLSearchParams(),
}));

mock.module('@/features/comments/viewer-presence.tsx', () => ({
  ViewerPresence: () => null,
}));

const todo: WorkflowState = {
  id: 'state_todo',
  teamId: 'team_1',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 1,
};

const doing: WorkflowState = {
  id: 'state_doing',
  teamId: 'team_1',
  name: 'In Progress',
  category: 'started',
  color: '#5a63c8',
  position: 2,
};

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Domain auto join',
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

function deferredResponse(): {
  readonly promise: Promise<Response>;
  readonly resolve: (response: Response) => void;
} {
  let resolvePromise: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) throw new Error('deferred response did not initialize');
  return { promise, resolve: resolvePromise };
}

function deferredSignal(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) throw new Error('deferred signal did not initialize');
  return { promise, resolve: resolvePromise };
}

function installBoardTestRects(): void {
  HTMLElement.prototype.getBoundingClientRect = function getBoardTestRect() {
    const inDoing = this.closest('[data-testid="board-column-In Progress"]') !== null;
    const card = this.matches('li');
    return new DOMRect(inDoing ? 320 : 0, card ? 80 : 0, card ? 260 : 280, card ? 72 : 500);
  };
}

const workspace: WorkspaceData = {
  ready: true,
  userId: 'user_1',
  role: 'admin',
  teams: [{ id: 'team_1', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
  states: [todo, doing],
  labels: [],
  members: [],
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: new Map([
    [todo.id, todo],
    [doing.id, doing],
  ]),
  labelById: new Map(),
  memberById: new Map(),
  openQuickCreate: () => undefined,
};

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { Board, boardVisibilityConfig, useBoardVisibilityHold } = await import(
  '@/features/issues/board.tsx'
);

describe('Board visibility during drag settlement', () => {
  it('does not remount a board for cosmetic card property changes', () => {
    const config = {
      filter: emptyFilterGroup(),
      groupBy: 'state' as const,
      subGroupBy: 'none' as const,
      orderBy: 'manual' as const,
      display: defaultDisplayOptions('board'),
    };
    const before = JSON.stringify(boardVisibilityConfig(config));
    const cosmetic = JSON.stringify(
      boardVisibilityConfig({
        ...config,
        display: { ...config.display, properties: ['priority'] },
      }),
    );
    const membership = JSON.stringify(
      boardVisibilityConfig({
        ...config,
        display: { ...config.display, showSubIssues: !config.display.showSubIssues },
      }),
    );

    expect(cosmetic).toBe(before);
    expect(membership).not.toBe(before);
  });

  it('keeps an emptied board mounted without retaining unrelated empty states', () => {
    const view = renderHook(({ contextKey, empty }) => useBoardVisibilityHold(contextKey, empty), {
      initialProps: { contextKey: 'first', empty: false },
    });
    const startActivity = () => {
      let end: (() => void) | undefined;
      act(() => {
        end = view.result.current.start();
      });
      if (end === undefined) throw new Error('visibility activity did not start');
      return end;
    };

    const firstEnd = startActivity();
    act(() => view.rerender({ contextKey: 'first', empty: true }));
    expect(view.result.current.held).toBe(true);

    const secondEnd = startActivity();
    act(() => firstEnd());
    expect(view.result.current.held).toBe(true);
    act(() => secondEnd());
    expect(view.result.current.held).toBe(true);

    act(() => view.rerender({ contextKey: 'first', empty: false }));
    expect(view.result.current.held).toBe(false);
    act(() => view.rerender({ contextKey: 'first', empty: true }));
    expect(view.result.current.held).toBe(false);

    const staleEnd = startActivity();
    act(() => view.rerender({ contextKey: 'second', empty: true }));
    expect(view.result.current.held).toBe(false);
    act(() => staleEnd());
    expect(view.result.current.held).toBe(false);
  });
});

const second = issue({
  id: 'issue_2',
  number: 2,
  identifier: 'ENG-2',
  sortOrder: 2048,
  title: 'Second task',
});

const third = issue({
  id: 'issue_3',
  number: 3,
  identifier: 'ENG-3',
  title: 'Third task',
  stateId: doing.id,
});

const ownedColumnSource: BoardColumnSource = {
  query: { filter: emptyFilterGroup(), orderBy: 'manual' },
  groupBy: 'state',
  scope: { teamId: 'team_1' },
  display: defaultDisplayOptions('board'),
};

function boardPage(rows: readonly Issue[]): BoardPage {
  const groups = [todo, doing].flatMap((state) => {
    const issues = rows.filter((row) => row.stateId === state.id);
    return issues.length === 0
      ? []
      : [{ id: state.id, total: issues.length, issues, nextCursor: null }];
  });
  return {
    groups,
    truncated: false,
  };
}

function renderBoard(
  draggable = false,
  rows: readonly Issue[] = [issue(), second],
  columnSource?: BoardColumnSource,
  showEmptyGroups = false,
  onVisibilityActivityStart?: () => () => void,
) {
  const makeGroups = (nextRows: readonly Issue[]) =>
    groupIssues(
      nextRows,
      'state',
      { states: [todo, doing], members: [], projects: [], cycles: [], labels: [] },
      { showEmptyGroups, ordering: 'manual' },
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  if (columnSource !== undefined) {
    const page = boardPage(rows);
    client.setQueryData(
      queryKeys.boardPage(
        boardSearch(columnSource.query, columnSource.groupBy, columnSource.scope),
      ),
      page,
    );
    seedBoardColumns(client, columnSource, page, Date.now());
  }
  const board = (nextRows: readonly Issue[], nextDraggable: boolean) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <HotkeyProvider>
            <Board
              groups={makeGroups(nextRows)}
              draggable={nextDraggable}
              {...(columnSource === undefined ? {} : { columnSource })}
              {...(onVisibilityActivityStart === undefined ? {} : { onVisibilityActivityStart })}
            />
          </HotkeyProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
  const rendered = render(board(rows, draggable));
  return {
    client,
    container: rendered.container,
    unmount: rendered.unmount,
    rerenderBoard(nextRows: readonly Issue[], nextDraggable = draggable) {
      rendered.rerender(board(nextRows, nextDraggable));
    },
  };
}

describe('Board card keyboard boundaries', () => {
  it('keeps the draggable wrapper a list item around nested controls', () => {
    renderBoard(true);
    const card = screen.getByTestId('issue-card-ENG-1');
    const item = card.closest('li');
    if (item === null) throw new Error('missing draggable list item');

    expect(item.getAttribute('role')).toBe('listitem');
    expect(screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' })).toBe(item);
    expect(within(card).getByRole('link', { name: 'Domain auto join' })).toBeInTheDocument();
  });

  it('leaves arrow keys on nested issue links untouched', () => {
    renderBoard(true);
    const link = cardLink('ENG-1', 'Domain auto join');
    link.focus();

    const allowed = fireEvent.keyDown(link, { key: 'ArrowRight', code: 'ArrowRight' });

    expect(allowed).toBe(true);
    expect(document.activeElement).toBe(link);
  });

  it('does not start a drag when Enter belongs to a nested issue link', () => {
    renderBoard(true);
    const link = cardLink('ENG-1', 'Domain auto join');
    link.focus();

    const allowed = fireEvent.keyDown(link, { key: 'Enter', code: 'Enter' });

    expect(allowed).toBe(true);
    expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(1);
  });

  it('keeps the drag overlay clone out of accessibility and tab navigation', async () => {
    renderBoard(true);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(2);
    });

    expect(screen.getAllByRole('link', { name: 'Domain auto join' })).toHaveLength(1);
    fireEvent.keyDown(card, { key: 'Escape', code: 'Escape' });
  });

  it('ends an active visibility activity when the board unmounts', async () => {
    const end = mock();
    const start = mock(() => end);
    const rendered = renderBoard(true, [issue()], undefined, false, start);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    rendered.unmount();

    expect(end).toHaveBeenCalledTimes(1);
  });

  it('ends an accepted pending visibility activity when the board unmounts', async () => {
    installBoardTestRects();
    const pending = deferredResponse();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? pending.promise
        : Promise.resolve(Response.json({ issues: [], nextCursor: null })),
    ) as unknown as typeof fetch;
    const end = mock();
    const start = mock(() => end);
    const rendered = renderBoard(true, [issue()], undefined, true, start);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(2));
    await act(async () => {
      await settleKeyboardSensor();
      fireEvent.keyDown(card, { key: 'ArrowRight', code: 'ArrowRight' });
      await settleKeyboardSensor();
    });
    await waitFor(() => expect(dndStatus()).toHaveTextContent('column In Progress'));
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(dndStatus()).toHaveTextContent('Dropping ENG-1'));
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();

    rendered.unmount();
    expect(end).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(
        Response.json({
          issue: issue({ stateId: doing.id, syncId: 2 }),
          rebalanced: [],
        }),
      );
      await pending.promise;
      await Promise.resolve();
    });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('promotes a keyboard drop fallback to the optimistic card after a delayed handoff', async () => {
    installBoardTestRects();
    const cancellation = deferredSignal();
    const pending = deferredResponse();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? pending.promise
        : Promise.resolve(Response.json({ issues: [], nextCursor: null })),
    ) as unknown as typeof fetch;
    const rendered = renderBoard(true, [issue()], ownedColumnSource, true);
    const cancelQueries = rendered.client.cancelQueries.bind(rendered.client);
    rendered.client.cancelQueries = mock(
      async (...args: Parameters<typeof rendered.client.cancelQueries>) => {
        await cancellation.promise;
        await cancelQueries(...args);
      },
    );
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await act(async () => {
      await settleKeyboardSensor();
      fireEvent.keyDown(card, { key: 'ArrowRight', code: 'ArrowRight' });
      await settleKeyboardSensor();
    });
    await waitFor(() => expect(dndStatus()).toHaveTextContent('column In Progress'));
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    const destination = screen.getByRole('list', { name: 'In Progress issues' });
    await waitFor(() => expect(document.activeElement === destination).toBe(true));

    await act(async () => {
      cancellation.resolve();
      await cancellation.promise;
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        within(destination).getByRole('listitem', { name: 'ENG-1: Domain auto join' }),
      ).toBeInTheDocument();
    });
    const optimistic = within(destination).getByRole('listitem', {
      name: 'ENG-1: Domain auto join',
    });
    expect(optimistic).toHaveAttribute('aria-disabled', 'true');
    await waitFor(() => expect(document.activeElement === optimistic).toBe(true));

    await act(async () => {
      pending.resolve(
        Response.json({
          issue: issue({ stateId: doing.id, syncId: 2 }),
          rebalanced: [],
        }),
      );
      await pending.promise;
      await Promise.resolve();
    });
  });

  it('does not promote a keyboard drop fallback after focus leaves the board position', async () => {
    installBoardTestRects();
    const cancellation = deferredSignal();
    const pending = deferredResponse();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? pending.promise
        : Promise.resolve(Response.json({ issues: [], nextCursor: null })),
    ) as unknown as typeof fetch;
    const rendered = renderBoard(true, [issue()], ownedColumnSource, true);
    const cancelQueries = rendered.client.cancelQueries.bind(rendered.client);
    rendered.client.cancelQueries = mock(
      async (...args: Parameters<typeof rendered.client.cancelQueries>) => {
        await cancellation.promise;
        await cancelQueries(...args);
      },
    );
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await act(async () => {
      await settleKeyboardSensor();
      fireEvent.keyDown(card, { key: 'ArrowRight', code: 'ArrowRight' });
      await settleKeyboardSensor();
    });
    await waitFor(() => expect(dndStatus()).toHaveTextContent('column In Progress'));
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    const destination = screen.getByRole('list', { name: 'In Progress issues' });
    await waitFor(() => expect(document.activeElement === destination).toBe(true));
    const alternate = screen.getByRole('button', { name: 'Create an issue in Todo' });
    alternate.focus();

    await act(async () => {
      cancellation.resolve();
      await cancellation.promise;
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        within(destination).getByRole('listitem', { name: 'ENG-1: Domain auto join' }),
      ).toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(alternate);

    await act(async () => {
      pending.resolve(
        Response.json({
          issue: issue({ stateId: doing.id, syncId: 2 }),
          rebalanced: [],
        }),
      );
      await pending.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(document.activeElement === alternate).toBe(true));
  });

  it('cancels a queued settlement frame when the board unmounts', async () => {
    installBoardTestRects();
    const pending = deferredResponse();
    globalThis.fetch = mock((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? pending.promise
        : Promise.resolve(Response.json({ issues: [], nextCursor: null })),
    ) as unknown as typeof fetch;
    const end = mock();
    const rendered = renderBoard(true, [issue()], undefined, true, () => end);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(2));
    await act(async () => {
      await settleKeyboardSensor();
      fireEvent.keyDown(card, { key: 'ArrowRight', code: 'ArrowRight' });
      await settleKeyboardSensor();
    });
    await waitFor(() => expect(dndStatus()).toHaveTextContent('column In Progress'));
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(dndStatus()).toHaveTextContent('Dropping ENG-1'));

    let frame: FrameRequestCallback | undefined;
    const requestFrame = mock((callback: FrameRequestCallback) => {
      frame = callback;
      return 700;
    });
    const cancelFrame = mock();
    window.requestAnimationFrame = requestFrame;
    window.cancelAnimationFrame = cancelFrame;
    await act(async () => {
      pending.resolve(
        Response.json({
          issue: issue({ stateId: doing.id, syncId: 2 }),
          rebalanced: [],
        }),
      );
      await pending.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(requestFrame).toHaveBeenCalledTimes(1));
    expect(end).not.toHaveBeenCalled();

    rendered.unmount();
    expect(cancelFrame).toHaveBeenCalledWith(700);
    expect(end).toHaveBeenCalledTimes(1);
    act(() => frame?.(0));
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('moves card focus with all four arrow keys before a drag starts', () => {
    renderBoard(true, [issue(), second, third]);
    const firstItem = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    const secondItem = screen.getByRole('listitem', { name: 'ENG-2: Second task' });
    const thirdItem = screen.getByRole('listitem', { name: 'ENG-3: Third task' });
    firstItem.focus();

    fireEvent.keyDown(firstItem, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(secondItem);
    fireEvent.keyDown(secondItem, { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(firstItem);
    fireEvent.keyDown(firstItem, { key: 'ArrowRight', code: 'ArrowRight' });
    expect(document.activeElement).toBe(thirdItem);
    fireEvent.keyDown(thirdItem, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(document.activeElement).toBe(firstItem);
  });

  it('moves from a focused column fallback to a card on the same board', () => {
    renderBoard(true, [issue(), second, third]);
    const todoColumn = screen.getByTestId('board-column-Todo').querySelector('ul');
    const doingColumn = screen.getByTestId('board-column-In Progress').querySelector('ul');
    if (todoColumn === null || doingColumn === null) throw new Error('missing board column list');
    const firstItem = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    const thirdItem = screen.getByRole('listitem', { name: 'ENG-3: Third task' });

    todoColumn.focus();
    fireEvent.keyDown(todoColumn, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement === firstItem).toBe(true);

    doingColumn.focus();
    fireEvent.keyDown(doingColumn, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(document.activeElement === firstItem).toBe(true);
    expect(document.activeElement === thirdItem).toBe(false);
  });

  it('moves from a card into an empty adjacent column fallback', () => {
    renderBoard(true, [issue()], undefined, true);
    const firstItem = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    const doingColumn = screen.getByTestId('board-column-In Progress').querySelector('ul');
    if (doingColumn === null) throw new Error('missing empty board column list');

    firstItem.focus();
    fireEvent.keyDown(firstItem, { key: 'ArrowRight', code: 'ArrowRight' });
    expect(document.activeElement).toBe(doingColumn);

    fireEvent.keyDown(doingColumn, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(document.activeElement).toBe(firstItem);
  });

  it('does not move focus into another board', () => {
    const firstBoard = renderBoard(true, [issue(), second, third]);
    renderBoard(true, [
      issue({ id: 'issue_4', number: 4, identifier: 'ENG-4', title: 'Another board task' }),
    ]);
    const firstDoingCard = within(firstBoard.container).getByRole('listitem', {
      name: 'ENG-3: Third task',
    });

    firstDoingCard.focus();
    fireEvent.keyDown(firstDoingCard, { key: 'ArrowRight', code: 'ArrowRight' });

    expect(document.activeElement === firstDoingCard).toBe(true);
  });

  it('clears an active keyboard session when dragging becomes unavailable', async () => {
    const rows = [issue(), second];
    const rendered = renderBoard(true, rows);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(2);

    await act(async () => {
      rendered.rerenderBoard(rows, false);
      await settleKeyboardSensor();
    });
    rendered.rerenderBoard(rows, true);

    expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(1);
    expect(dndStatus()).toBeEmptyDOMElement();
    const restarted = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    restarted.focus();
    fireEvent.keyDown(restarted, { key: 'Enter', code: 'Enter' });
    expect(dndStatus()).toHaveTextContent('Picked up ENG-1');
    expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(2);
    await act(async () => {
      await settleKeyboardSensor();
      fireEvent.keyDown(restarted, { key: 'Escape', code: 'Escape' });
    });
  });

  it('reconciles a background update without replacing the active drag announcement', async () => {
    const rendered = renderBoard(true);
    const card = screen.getByTestId('issue-card-ENG-1').closest('li');
    if (card === null) throw new Error('missing draggable card');
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    const dndStatus = screen.getByTestId('board-drag-status');
    expect(dndStatus).toHaveTextContent('Picked up ENG-1');
    const spokenStatuses = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-live="assertive"]'),
    ).filter((node) => node.textContent?.trim().length !== 0);
    expect(spokenStatuses).toEqual([dndStatus]);

    const updated = issue({
      syncId: 2,
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Updated domain auto join',
    });
    await act(async () => {
      rendered.rerenderBoard([updated, second]);
      await Promise.resolve();
    });

    expect(screen.getByTestId('board-drag-status')).toHaveTextContent(
      'Picked up ENG-1: Domain auto join in column Todo, position 1 of 2.',
    );
    await act(async () => {
      await settleKeyboardSensor();
      fireEvent.keyDown(card, { key: 'Escape', code: 'Escape' });
    });
  });

  it('cancels a drag when the held issue is reordered in the background', async () => {
    const rendered = renderBoard(true);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    await act(async () => {
      rendered.rerenderBoard([
        issue({ syncId: 2, sortOrder: 3072, updatedAt: '2026-01-02T00:00:00.000Z' }),
        second,
      ]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dndStatus()).toHaveTextContent(
        'ENG-1 moved in the background to column Todo, position 2 of 2. Drag cancelled.',
      );
    });
    expect(document.activeElement).toBe(
      screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' }),
    );
  });

  it('cancels cleanly when the held issue leaves the visible board', async () => {
    const rendered = renderBoard(true);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(dndStatus()).toHaveTextContent('Picked up ENG-1');

    rendered.rerenderBoard([second]);

    await waitFor(() => {
      expect(dndStatus()).toHaveTextContent('ENG-1 is no longer visible. Drag cancelled.');
    });
    expect(screen.queryAllByTestId('issue-card-ENG-1')).toHaveLength(0);
  });

  it('cancels a drag when the held issue is moved in the background', async () => {
    const rendered = renderBoard(true, [issue(), second, third]);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    const updated = issue({
      stateId: doing.id,
      syncId: 2,
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    rendered.rerenderBoard([updated, second, third]);
    await waitFor(() => {
      expect(dndStatus()).toHaveTextContent(
        'ENG-1 moved in the background to column In Progress, position 1 of 2. Drag cancelled.',
      );
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' }),
      );
    });
    expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(1);

    const relocated = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    await act(async () => {
      fireEvent.keyDown(relocated, { key: 'Enter', code: 'Enter' });
      await settleKeyboardSensor();
    });
    expect(dndStatus()).toHaveTextContent(
      'Picked up ENG-1: Domain auto join in column In Progress, position 1 of 2.',
    );
    expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(2);
    await act(async () => {
      fireEvent.keyDown(relocated, { key: 'Escape', code: 'Escape' });
      await Promise.resolve();
    });
    expect(dndStatus()).toHaveTextContent('Returned to column In Progress, position 1 of 2.');
    await waitFor(() => {
      expect(screen.getAllByTestId('issue-card-ENG-1')).toHaveLength(1);
    });
  });

  it('reconciles a background update from an owned column query', async () => {
    const rendered = renderBoard(true, [issue(), second], ownedColumnSource);
    const card = screen.getByTestId('issue-card-ENG-1').closest('li');
    if (card === null) throw new Error('missing draggable card');
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(dndStatus()).toHaveTextContent('Picked up ENG-1');

    const updated = issue({
      syncId: 2,
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Updated domain auto join',
    });
    await act(async () => {
      seedBoardColumns(
        rendered.client,
        ownedColumnSource,
        boardPage([updated, second]),
        Date.now() + 10_000,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByRole('listitem', { name: 'ENG-1: Updated domain auto join' }),
      ).toBeInTheDocument();
    });
    expect(dndStatus()).toHaveTextContent(
      'Picked up ENG-1: Domain auto join in column Todo, position 1 of 2.',
    );
    await act(async () => {
      await settleKeyboardSensor();
      fireEvent.keyDown(screen.getByRole('listitem', { name: 'ENG-1: Updated domain auto join' }), {
        key: 'Escape',
        code: 'Escape',
      });
    });
  });

  it('cancels when owned rows reorder around the same held issue object', async () => {
    const held = second;
    const first = issue();
    const rendered = renderBoard(true, [first, held], ownedColumnSource);
    const card = screen.getByRole('listitem', { name: 'ENG-2: Second task' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(dndStatus()).toHaveTextContent('Picked up ENG-2');
    await act(async () => {
      await settleKeyboardSensor();
    });

    await act(async () => {
      seedBoardColumns(
        rendered.client,
        ownedColumnSource,
        boardPage([held, first]),
        Date.now() + 10_000,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dndStatus()).toHaveTextContent(
        'ENG-2 moved in the background to column Todo, position 1 of 2. Drag cancelled.',
      );
    });
    expect(document.activeElement).toBe(
      screen.getByRole('listitem', { name: 'ENG-2: Second task' }),
    );
  });

  it('waits for an owned column handoff before cancelling a background regroup', async () => {
    const rendered = renderBoard(true, [issue(), second, third], ownedColumnSource);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    const updated = issue({
      stateId: doing.id,
      syncId: 2,
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Regrouped domain auto join',
    });
    await act(async () => {
      seedBoardColumns(
        rendered.client,
        ownedColumnSource,
        {
          groups: [{ id: todo.id, total: 2, issues: [updated, second], nextCursor: null }],
          truncated: false,
        },
        Date.now() + 10_000,
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByRole('listitem', { name: 'ENG-1: Regrouped domain auto join' }),
      ).toBeInTheDocument();
    });
    expect(dndStatus()).not.toHaveTextContent('updated in the background');

    await act(async () => {
      seedBoardColumns(
        rendered.client,
        ownedColumnSource,
        {
          groups: [{ id: todo.id, total: 1, issues: [second], nextCursor: null }],
          truncated: false,
        },
        Date.now() + 20_000,
      );
      await Promise.resolve();
    });
    await act(async () => {
      seedBoardColumns(
        rendered.client,
        ownedColumnSource,
        {
          groups: [{ id: doing.id, total: 2, issues: [updated, third], nextCursor: null }],
          truncated: false,
        },
        Date.now() + 30_000,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dndStatus().textContent).toBe(
        'ENG-1 moved in the background to column In Progress, position 1. Drag cancelled.',
      );
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('listitem', { name: 'ENG-1: Regrouped domain auto join' }),
      );
    });
  });

  it('uses the newest copy when a regroup briefly appears in both owned columns', async () => {
    const rendered = renderBoard(true, [issue(), second, third], ownedColumnSource);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    const updated = issue({
      stateId: doing.id,
      syncId: 2,
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Regrouped domain auto join',
    });
    await act(async () => {
      seedBoardColumns(
        rendered.client,
        ownedColumnSource,
        {
          groups: [{ id: doing.id, total: 2, issues: [updated, third], nextCursor: null }],
          truncated: false,
        },
        Date.now() + 10_000,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dndStatus().textContent).toBe(
        'ENG-1 moved in the background to column In Progress, position 1. Drag cancelled.',
      );
    });
    const movedCard = within(screen.getByTestId('board-column-In Progress')).getByRole('listitem', {
      name: 'ENG-1: Regrouped domain auto join',
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(movedCard);
    });

    await act(async () => {
      seedBoardColumns(
        rendered.client,
        ownedColumnSource,
        {
          groups: [{ id: todo.id, total: 1, issues: [second], nextCursor: null }],
          truncated: false,
        },
        Date.now() + 20_000,
      );
      await Promise.resolve();
    });
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
    expect(document.activeElement).toBe(movedCard);
  });

  it('uses a fresh parent regroup to cancel while the owned column mirror catches up', async () => {
    const rendered = renderBoard(true, [issue(), second, third], ownedColumnSource);
    const card = screen.getByRole('listitem', { name: 'ENG-1: Domain auto join' });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    rendered.rerenderBoard([
      issue({ stateId: doing.id, syncId: 2, updatedAt: '2026-01-02T00:00:00.000Z' }),
      second,
      third,
    ]);

    await waitFor(() => {
      expect(dndStatus()).toHaveTextContent(
        'ENG-1 moved in the background to column In Progress, position 1 of 2. Drag cancelled.',
      );
    });
  });
});

function cardLink(identifier: string, title: string): HTMLElement {
  const card = screen.getByTestId(`issue-card-${identifier}`);
  return within(card).getByRole('link', { name: title });
}

function dndStatus(): HTMLElement {
  return screen.getByTestId('board-drag-status');
}

async function settleKeyboardSensor(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

describe('Board peek', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('opens the peek on a plain card click instead of navigating', () => {
    renderBoard();
    expect(screen.queryByTestId('issue-peek')).toBeNull();

    act(() => {
      fireEvent.click(cardLink('ENG-1', 'Domain auto join'));
    });

    expect(screen.getByTestId('issue-peek')).toHaveAttribute('aria-label', 'Peek ENG-1');
    expect(push).not.toHaveBeenCalled();
  });

  it('paints the peeked issue straight away rather than a skeleton', () => {
    renderBoard();

    act(() => {
      fireEvent.click(cardLink('ENG-1', 'Domain auto join'));
    });

    const peek = within(screen.getByTestId('issue-peek'));
    expect(peek.getByTestId('issue-title')).toHaveValue('Domain auto join');
    expect(peek.getByTestId('issue-properties')).toBeTruthy();
  });

  it('lets a modified click fall through to the link without opening the peek', () => {
    renderBoard();

    act(() => {
      fireEvent.click(cardLink('ENG-1', 'Domain auto join'), { metaKey: true });
    });

    expect(screen.queryByTestId('issue-peek')).toBeNull();
  });

  it('switches the peeked issue when another card is clicked', () => {
    renderBoard();

    act(() => {
      fireEvent.click(cardLink('ENG-1', 'Domain auto join'));
    });
    expect(screen.getByTestId('issue-peek')).toHaveAttribute('aria-label', 'Peek ENG-1');

    act(() => {
      fireEvent.click(cardLink('ENG-2', 'Second task'));
    });
    expect(screen.getByTestId('issue-peek')).toHaveAttribute('aria-label', 'Peek ENG-2');
  });

  it('stays non-modal so the board behind it keeps its pointer events', () => {
    renderBoard();

    act(() => {
      fireEvent.click(cardLink('ENG-1', 'Domain auto join'));
    });

    expect(screen.getByTestId('issue-peek')).toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe('none');
    expect(screen.getByTestId('board-column-Todo')).toBeInTheDocument();
  });

  it('offers the full page as a real link rather than a scripted push', () => {
    renderBoard();

    act(() => {
      fireEvent.click(cardLink('ENG-1', 'Domain auto join'));
    });

    const open = within(screen.getByTestId('issue-peek')).getByRole('link', {
      name: 'Open full page',
    });
    expect(open).toHaveAttribute('href', '/issue/ENG-1');
  });

  it('renders a resize handle on the peek', () => {
    renderBoard();

    act(() => {
      fireEvent.click(cardLink('ENG-1', 'Domain auto join'));
    });

    expect(screen.getByRole('button', { name: 'Resize panel' })).toBeInTheDocument();
  });
});

type IntersectCallback = (entries: readonly { isIntersecting: boolean }[]) => void;
const windowObservers: IntersectCallback[] = [];
const realIntersectionObserver = globalThis.IntersectionObserver;

class WindowStubObserver {
  constructor(callback: IntersectCallback) {
    windowObservers.push(callback);
  }
  observe = mock();
  unobserve = mock();
  disconnect = mock();
  takeRecords = mock();
}

function manyIssues(count: number): Issue[] {
  return Array.from({ length: count }, (_, index) =>
    issue({
      id: `issue_w${index}`,
      number: index + 1,
      identifier: `ENG-${index + 1}`,
      title: `Windowed ${index + 1}`,
      sortOrder: (index + 1) * 1024,
    }),
  );
}

function renderWindowedBoard(count: number, onLoadMore?: () => void) {
  const groups = groupIssues(
    manyIssues(count),
    'state',
    { states: [todo], members: [], projects: [], cycles: [], labels: [] },
    { showEmptyGroups: false, ordering: 'manual' },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <HotkeyProvider>
            <Board
              groups={groups}
              draggable={false}
              hasMore={onLoadMore !== undefined}
              onLoadMore={onLoadMore}
            />
          </HotkeyProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function fireIntersection() {
  act(() => {
    for (const notify of windowObservers) notify([{ isIntersecting: true }]);
  });
}

describe('Board windowing', () => {
  beforeEach(() => {
    windowObservers.length = 0;
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: WindowStubObserver,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: realIntersectionObserver,
    });
  });

  it('caps the initial window and reveals more when the column scrolls', () => {
    renderWindowedBoard(20);
    expect(screen.getAllByTestId(/^issue-card-/)).toHaveLength(15);

    fireIntersection();

    expect(screen.getAllByTestId(/^issue-card-/)).toHaveLength(20);
  });

  it('only fetches the next page after the column has been scrolled', () => {
    const onLoadMore = mock();
    renderWindowedBoard(10, onLoadMore);

    fireIntersection();
    expect(onLoadMore).not.toHaveBeenCalled();

    fireEvent.scroll(screen.getByTestId('board-column-Todo').querySelector('ul') as HTMLElement);
    fireIntersection();
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('fetches without a scroll when the column is short enough to fit', () => {
    const onLoadMore = mock();
    renderWindowedBoard(10, onLoadMore);

    const column = screen.getByTestId('board-column-Todo').querySelector('ul') as HTMLElement;
    Object.defineProperty(column, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(column, 'clientHeight', { value: 800, configurable: true });

    fireIntersection();
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('waits for a scroll when the column is taller than the space it has', () => {
    const onLoadMore = mock();
    renderWindowedBoard(10, onLoadMore);

    const column = screen.getByTestId('board-column-Todo').querySelector('ul') as HTMLElement;
    Object.defineProperty(column, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(column, 'clientHeight', { value: 600, configurable: true });

    fireIntersection();
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
