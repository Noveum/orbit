import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { defaultViewState, encodeFilter, inCondition } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue, View, WorkflowState } from '@/lib/query/schemas.ts';
import { emptyFacets } from '@/lib/query/schemas.ts';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/views/view-bugs',
  useSearchParams: () => new URLSearchParams(),
}));

let workspace: WorkspaceData;
mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { SavedViewPage } = await import('@/features/views/saved-view-page.tsx');

const todo: WorkflowState = {
  id: 'state-todo',
  teamId: 'team-eng',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 1,
};

const done: WorkflowState = {
  id: 'state-done',
  teamId: 'team-eng',
  name: 'Done',
  category: 'completed',
  color: '#2e9e68',
  position: 2,
};

function buildWorkspace(): WorkspaceData {
  return {
    ready: true,
    userId: 'user-1',
    role: 'admin',
    teams: [
      { id: 'team-ai', name: 'AI', key: 'AI', icon: 'circle', color: '#5b6cf9' },
      { id: 'team-eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#f95b6c' },
    ],
    states: [todo, done],
    labels: [],
    members: [
      {
        id: 'user-1',
        name: 'Pulkit Sharma',
        email: 'pulkit@noveum.ai',
        image: null,
        handle: 'pulkit',
        role: 'admin',
      },
    ],
    projects: [
      {
        id: 'project-atlas',
        name: 'Atlas',
        status: 'planned',
        color: '#5a63c8',
        icon: 'box',
        teamIds: [],
      },
    ],
    cycles: [],
    seedIssues: [],
    stateById: new Map([
      [todo.id, todo],
      [done.id, done],
    ]),
    labelById: new Map(),
    memberById: new Map(),
    openQuickCreate: () => undefined,
  };
}

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 'issue-1',
    organizationId: 'org-1',
    teamId: 'team-eng',
    number: 1,
    identifier: 'ENG-1',
    title: 'Untitled',
    description: '',
    stateId: todo.id,
    priority: 1,
    creatorId: 'user-1',
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

const URGENT_ONLY = {
  kind: 'group' as const,
  combinator: 'and' as const,
  children: [inCondition('priority', ['1'])],
};

function savedView(overrides: Partial<View> = {}): View {
  return {
    id: 'view-bugs',
    ownerId: 'user-1',
    name: 'Urgent bugs',
    filter: {
      ...defaultViewState('list'),
      filter: URGENT_ONLY,
      orderBy: 'updated',
      display: { ...defaultViewState('list').display, showCompleted: 'none' },
    },
    layout: 'list',
    groupBy: 'state',
    shared: false,
    virtual: false,
    locked: false,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const SERVER_ROWS: readonly Issue[] = [
  issue({ id: 'issue-open', identifier: 'ENG-1', title: 'Login screen crashes' }),
  issue({
    id: 'issue-done',
    identifier: 'ENG-2',
    title: 'Old crash already fixed',
    stateId: done.id,
    completedAt: '2026-01-02T00:00:00.000Z',
  }),
];

const realFetch = globalThis.fetch;
let requested: string[] = [];

function stubIssueApi(): void {
  globalThis.fetch = mock((url: string) => {
    requested.push(url);
    const body = (() => {
      if (url.startsWith('/api/issues/summary')) {
        return { total: SERVER_ROWS.length, byState: {}, groupTotals: {} };
      }
      if (url.startsWith('/api/issues/facets')) {
        return { scopeTotal: SERVER_ROWS.length, facets: emptyFacets() };
      }
      return { issues: SERVER_ROWS, nextCursor: null };
    })();
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

function issueListUrl(): string {
  const found = requested.find((url) => url.startsWith('/api/issues?'));
  if (found === undefined)
    throw new Error(`no issue list request was made: ${requested.join(' ')}`);
  return found;
}

function issueListParams(): URLSearchParams {
  return new URLSearchParams(issueListUrl().slice('/api/issues?'.length));
}

async function waitForIssueRequest(): Promise<void> {
  await waitFor(() => {
    issueListUrl();
  });
}

function renderView(views: readonly View[], viewId = 'view-bugs'): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.views(), views);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <SavedViewPage viewId={viewId} />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
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
  workspace = buildWorkspace();
  requested = [];
  stubIssueApi();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('opening a saved view', () => {
  it('asks the server for exactly the issues the view describes', async () => {
    renderView([savedView()]);

    await waitForIssueRequest();
    const params = issueListParams();
    expect(params.get('filter')).toBe(encodeFilter(URGENT_ONLY));
    expect(params.get('orderBy')).toBe('updated');
  });

  it('stays workspace wide instead of narrowing to one team', async () => {
    renderView([savedView()]);

    await waitForIssueRequest();
    expect(issueListParams().get('teamId')).toBeNull();
    expect(issueListParams().get('projectId')).toBeNull();
    expect(await screen.findByTestId('view-scope')).toHaveTextContent('Workspace');
  });

  it('narrows to the team a team view names', async () => {
    const teamView = savedView({
      id: 'view-team',
      filter: { ...savedView().filter, teamId: 'team-eng' },
    });
    renderView([teamView], 'view-team');

    await waitForIssueRequest();
    expect(issueListParams().get('teamId')).toBe('team-eng');
    expect(await screen.findByTestId('view-scope')).toHaveTextContent('Engineering');
  });

  it('narrows to the project a project view names', async () => {
    const projectView = savedView({
      id: 'view-project',
      filter: { ...savedView().filter, projectId: 'project-atlas' },
    });
    renderView([projectView], 'view-project');

    await waitForIssueRequest();
    expect(issueListParams().get('projectId')).toBe('project-atlas');
    expect(issueListParams().get('teamId')).toBeNull();
  });

  it('shows the issues it got back and honours the display options it stored', async () => {
    renderView([savedView()]);

    expect(await screen.findByText('Login screen crashes')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Urgent bugs' })).toBeInTheDocument();
    expect(screen.queryByText('Old crash already fixed')).toBeNull();
  });

  it('says so plainly when the view is gone', () => {
    renderView([savedView()], 'view-missing');

    expect(screen.getByText('No such view')).toBeInTheDocument();
  });
});
