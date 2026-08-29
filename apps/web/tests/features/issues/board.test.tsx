import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { defaultDisplayOptions, emptyFilterGroup } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { groupIssues } from '@/features/filters/grouping.ts';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { boardSearch } from '@/lib/query/issue-search.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { BoardPage, Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { seedBoardColumns } from '@/lib/query/use-issues.ts';
import type { BoardColumnSource } from '../../../src/features/issues/board.tsx';
import type { WorkspaceData } from '../../../src/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '../../../src/features/issues/workspace-provider.tsx';

const push = mock();
const nativeFetch = globalThis.fetch;
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

const workspace: WorkspaceData = {
  ready: true,
  userId: 'user_1',
  role: 'admin',
  teams: [{ id: 'team_1', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
  states: [todo],
  labels: [],
  members: [],
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: new Map([[todo.id, todo]]),
  labelById: new Map(),
  memberById: new Map(),
  openQuickCreate: () => undefined,
};

mock.module('../../../src/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { Board } = await import('../../../src/features/issues/board.tsx');

const second = issue({
  id: 'issue_2',
  number: 2,
  identifier: 'ENG-2',
  sortOrder: 2048,
  title: 'Second task',
});

const ownedColumnSource: BoardColumnSource = {
  query: { filter: emptyFilterGroup(), orderBy: 'manual' },
  groupBy: 'state',
  scope: { teamId: 'team_1' },
  display: defaultDisplayOptions('board'),
};

function boardPage(rows: readonly Issue[]): BoardPage {
  return {
    groups: [{ id: todo.id, total: rows.length, issues: [...rows], nextCursor: null }],
    truncated: false,
  };
}

function renderBoard(
  draggable = false,
  rows: readonly Issue[] = [issue(), second],
  columnSource?: BoardColumnSource,
) {
  const makeGroups = (nextRows: readonly Issue[]) =>
    groupIssues(
      nextRows,
      'state',
      { states: [todo], members: [], projects: [], cycles: [], labels: [] },
      { showEmptyGroups: false, ordering: 'manual' },
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
  const board = (nextRows: readonly Issue[]) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <HotkeyProvider>
            <Board
              groups={makeGroups(nextRows)}
              draggable={draggable}
              {...(columnSource === undefined ? {} : { columnSource })}
            />
          </HotkeyProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
  const rendered = render(board(rows));
  return {
    client,
    rerenderBoard(nextRows: readonly Issue[]) {
      rendered.rerender(board(nextRows));
    },
  };
}

describe('Board card keyboard boundaries', () => {
  it('keeps the draggable wrapper a list item around nested controls', () => {
    renderBoard(true);
    const card = screen.getByTestId('issue-card-ENG-1');
    const item = card.closest('li');

    expect(item?.getAttribute('role')).toBe('listitem');
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

  it('reconciles a background update without replacing the active drag announcement', () => {
    const rendered = renderBoard(true);
    const card = screen.getByTestId('issue-card-ENG-1').closest('li');
    if (card === null) throw new Error('missing draggable card');
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    const dndStatus = document.querySelector<HTMLElement>(
      '[id^="DndLiveRegion-"][aria-live="assertive"]',
    );
    if (dndStatus === null) throw new Error('missing drag status');
    expect(dndStatus).toHaveTextContent('Picked up ENG-1');

    const updated = issue({
      syncId: 2,
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Updated domain auto join',
    });
    rendered.rerenderBoard([updated, second]);

    expect(dndStatus).not.toHaveTextContent('updated in the background');
    expect(screen.getByTestId('board-drag-status')).toHaveTextContent(
      'ENG-1 was updated in the background. Still holding it in column Todo, position 1 of 2.',
    );
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

    expect(dndStatus()).not.toHaveTextContent('updated in the background');
    await waitFor(() => {
      expect(screen.getByTestId('board-drag-status')).toHaveTextContent(
        'ENG-1 was updated in the background. Still holding it in column Todo, position 1 of 2.',
      );
    });
  });
});

function cardLink(identifier: string, title: string): HTMLElement {
  const card = screen.getByTestId(`issue-card-${identifier}`);
  return within(card).getByRole('link', { name: title });
}

function dndStatus(): HTMLElement {
  const status = document.querySelector<HTMLElement>(
    '[id^="DndLiveRegion-"][aria-live="assertive"]',
  );
  if (status === null) throw new Error('missing drag status');
  return status;
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
