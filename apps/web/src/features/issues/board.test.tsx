import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { groupIssues } from '@/features/filters/grouping.ts';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import type { WorkspaceData } from './workspace-provider.tsx';
import * as workspaceProvider from './workspace-provider.tsx';

const push = mock();
mock.module('next/navigation', () => ({
  useRouter: () => ({ push, replace: mock(), refresh: mock() }),
  usePathname: () => '/team/eng/board',
  useSearchParams: () => new URLSearchParams(),
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

mock.module('./workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { Board } = await import('./board.tsx');

const second = issue({
  id: 'issue_2',
  number: 2,
  identifier: 'ENG-2',
  sortOrder: 2048,
  title: 'Second task',
});

function renderBoard() {
  const groups = groupIssues(
    [issue(), second],
    'state',
    { states: [todo], members: [], projects: [], cycles: [], labels: [] },
    { showEmptyGroups: false, ordering: 'manual' },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <Board teamId="team_1" groups={groups} draggable={false} />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function cardLink(identifier: string, title: string): HTMLElement {
  const card = screen.getByTestId(`issue-card-${identifier}`);
  return within(card).getByRole('link', { name: title });
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

  it('renders a resize handle on the peek', () => {
    renderBoard();

    act(() => {
      fireEvent.click(cardLink('ENG-1', 'Domain auto join'));
    });

    expect(screen.getByRole('button', { name: 'Resize panel' })).toBeInTheDocument();
  });
});
