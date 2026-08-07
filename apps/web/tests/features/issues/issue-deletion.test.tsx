import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { OrgRole } from '@orbit/shared/constants';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShortcutsOverlay } from '@/components/shortcuts-overlay.tsx';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { groupIssues } from '@/features/filters/grouping.ts';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import type { WorkspaceData } from '../../../src/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '../../../src/features/issues/workspace-provider.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), prefetch: mock() }),
  usePathname: () => '/team/eng/issues',
}));

const realViewerPresence = { ...(await import('@/features/comments/viewer-presence.tsx')) };
mock.module('@/features/comments/viewer-presence.tsx', () => ({ ViewerPresence: () => null }));

afterAll(() => {
  mock.module('@/features/comments/viewer-presence.tsx', () => realViewerPresence);
});

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

const issues = [
  issue(),
  issue({ id: 'issue_2', number: 2, identifier: 'ENG-2', title: 'Board drag', sortOrder: 2048 }),
];

let role: OrgRole = 'admin';

function workspaceValue(): WorkspaceData {
  return {
    ready: true,
    userId: 'user_1',
    role,
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
}

mock.module('../../../src/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspaceValue(),
}));

const { IssueList } = await import('../../../src/features/issues/issue-list.tsx');
const { IssueCard } = await import('../../../src/features/issues/issue-card.tsx');
const { IssueDeletionProvider, describeDeletion } = await import(
  '../../../src/features/issues/issue-deletion.tsx'
);

const originalFetch = globalThis.fetch;
const deleted: string[] = [];

function stubFetch(): void {
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? 'GET') === 'DELETE') {
      deleted.push(url);
      const id = url.slice(url.lastIndexOf('/') + 1);
      return Promise.resolve(Response.json({ deleted: { id, identifier: 'ENG-1' } }));
    }
    return Promise.resolve(Response.json({ issues: [], nextCursor: null }));
  }) as unknown as typeof fetch;
}

const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600,
  });
});

afterAll(() => {
  if (realWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realWidth);
  }
  if (realHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight);
  }
});

beforeEach(() => {
  role = 'admin';
  deleted.length = 0;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function renderList(withShortcuts = false) {
  const groups = groupIssues(
    issues,
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
          <IssueDeletionProvider>
            {withShortcuts ? <ShortcutsOverlay open onOpenChange={() => undefined} /> : null}
            <IssueList states={[todo]} groups={groups} />
          </IssueDeletionProvider>
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const user = userEvent.setup({ pointerEventsCheck: 0 });

async function openRowMenu(identifier: string): Promise<void> {
  await user.click(await screen.findByTestId(`issue-actions-${identifier}`));
  await screen.findByTestId(`delete-issue-${identifier}`);
}

describe('the delete affordance on a list row', () => {
  it('asks before it deletes and names the issue it is about to destroy', async () => {
    renderList();
    await openRowMenu('ENG-2');

    await user.click(screen.getByTestId('delete-issue-ENG-2'));

    const dialog = await screen.findByTestId('delete-issue-dialog');
    expect(within(dialog).getByText('Delete ENG-2?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Board drag');
    expect(dialog.textContent).toContain('cannot be undone');
    expect(deleted).toEqual([]);
  });

  it('sends the delete only once the confirmation is accepted', async () => {
    renderList();
    await openRowMenu('ENG-2');
    await user.click(screen.getByTestId('delete-issue-ENG-2'));
    await screen.findByTestId('delete-issue-dialog');

    await user.click(screen.getByTestId('confirm-delete-issue'));

    await waitFor(() => expect(deleted).toEqual(['/api/issues/issue_2']));
    await waitFor(() =>
      expect(screen.queryByTestId('delete-issue-dialog')).not.toBeInTheDocument(),
    );
  });

  it('leaves the issue alone when the confirmation is dismissed', async () => {
    renderList();
    await openRowMenu('ENG-2');
    await user.click(screen.getByTestId('delete-issue-ENG-2'));
    await screen.findByTestId('delete-issue-dialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByTestId('delete-issue-dialog')).not.toBeInTheDocument(),
    );
    expect(deleted).toEqual([]);
    expect(screen.getByTestId('issue-row-ENG-2')).toBeInTheDocument();
  });
});

describe('the delete shortcut', () => {
  it('opens the confirmation for the active row', async () => {
    renderList();
    await screen.findByTestId('issue-row-ENG-1');

    await user.keyboard('{Meta>}{Shift>}{Backspace}{/Shift}{/Meta}');

    const dialog = await screen.findByTestId('delete-issue-dialog');
    expect(within(dialog).getByText('Delete ENG-1?')).toBeInTheDocument();
    expect(deleted).toEqual([]);
  });

  it('stays out of the way while an open menu owns the keyboard', async () => {
    renderList();
    await openRowMenu('ENG-2');

    await user.keyboard('{Meta>}{Shift>}{Backspace}{/Shift}{/Meta}');

    expect(screen.queryByTestId('delete-issue-dialog')).not.toBeInTheDocument();
  });

  it('is advertised in the shortcuts sheet', async () => {
    renderList(true);

    const sections = await screen.findByTestId('shortcuts-sections');
    expect(sections.textContent).toContain('Delete issue');
  });
});

describe('bulk delete from the selection bar', () => {
  it('confirms with the count and deletes every selected issue', async () => {
    renderList();
    await screen.findByTestId('issue-row-ENG-1');

    await user.keyboard('x');
    await user.keyboard('j');
    await user.keyboard('x');
    const bar = await screen.findByTestId('bulk-edit-bar');
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByTestId('bulk-delete-issues'));
    const dialog = await screen.findByTestId('delete-issue-dialog');
    expect(within(dialog).getByText('Delete 2 issues?')).toBeInTheDocument();
    expect(deleted).toEqual([]);

    await user.click(screen.getByTestId('confirm-delete-issue'));

    await waitFor(() => expect(deleted).toEqual(['/api/issues/issue_1', '/api/issues/issue_2']));
  });
});

describe('a role without issue:delete', () => {
  it('is offered no delete on a row, no bulk delete, and no shortcut', async () => {
    role = 'contributor';
    renderList();
    await screen.findByTestId('issue-row-ENG-1');

    expect(screen.queryByTestId('issue-actions-ENG-1')).not.toBeInTheDocument();

    await user.keyboard('x');
    await screen.findByTestId('bulk-edit-bar');
    expect(screen.queryByTestId('bulk-delete-issues')).not.toBeInTheDocument();

    await user.keyboard('{Meta>}{Shift>}{Backspace}{/Shift}{/Meta}');
    expect(screen.queryByTestId('delete-issue-dialog')).not.toBeInTheDocument();
    expect(deleted).toEqual([]);
  });
});

function renderCard(dragging: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <IssueDeletionProvider>
            <IssueCard
              issue={issue({ id: 'issue_2', identifier: 'ENG-2', title: 'Board drag' })}
              labels={[]}
              assignee={undefined}
              state={todo}
              dragging={dragging}
            />
          </IssueDeletionProvider>
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('the delete affordance on a board card', () => {
  it('offers delete from the card menu and confirms first', async () => {
    renderCard(false);

    await user.click(await screen.findByTestId('issue-actions-ENG-2'));
    await user.click(await screen.findByTestId('delete-issue-ENG-2'));

    const dialog = await screen.findByTestId('delete-issue-dialog');
    expect(within(dialog).getByText('Delete ENG-2?')).toBeInTheDocument();
    expect(deleted).toEqual([]);
  });

  it('keeps the menu off the card being dragged', () => {
    renderCard(true);

    expect(screen.queryByTestId('issue-actions-ENG-2')).not.toBeInTheDocument();
  });

  it('hides the card menu from a role that cannot delete', async () => {
    role = 'guest';
    renderCard(false);

    await screen.findByTestId('issue-card-ENG-2');
    expect(screen.queryByTestId('issue-actions-ENG-2')).not.toBeInTheDocument();
  });
});

describe('the confirmation copy', () => {
  it('names one issue and says the loss is permanent', () => {
    const copy = describeDeletion([issue({ identifier: 'ENG-9', title: 'Kill the flake' })]);
    expect(copy.title).toBe('Delete ENG-9?');
    expect(copy.body).toContain('Kill the flake');
    expect(copy.body).toContain('cannot be undone');
  });

  it('counts a bulk delete instead of naming one of them', () => {
    const copy = describeDeletion([issue(), issue({ id: 'issue_2' }), issue({ id: 'issue_3' })]);
    expect(copy.title).toBe('Delete 3 issues?');
    expect(copy.body).toContain('All 3 selected issues');
  });
});
