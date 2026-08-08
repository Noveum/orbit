import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { defaultViewState, virtualViewState } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { View } from '@/lib/query/schemas.ts';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/views',
  useSearchParams: () => new URLSearchParams(),
}));

let workspace: WorkspaceData;
mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { ViewsPage } = await import('@/features/views/views-page.tsx');

function buildWorkspace(): WorkspaceData {
  return {
    ready: true,
    userId: 'user-1',
    role: 'admin',
    teams: [
      { id: 'team-ai', name: 'AI', key: 'AI', icon: 'circle', color: '#5b6cf9' },
      { id: 'team-eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#f95b6c' },
    ],
    states: [],
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
        slug: 'atlas',
        name: 'Atlas',
        status: 'planned',
        color: '#5a63c8',
        icon: 'box',
        teamIds: [],
      },
    ],
    cycles: [],
    seedIssues: [],
    stateById: new Map(),
    labelById: new Map(),
    memberById: new Map(),
    openQuickCreate: () => undefined,
  };
}

function builtInView(id: 'virtual:all' | 'virtual:unassigned', name: string): View {
  return {
    id,
    ownerId: 'user-1',
    name,
    filter: virtualViewState(id, 'user-1'),
    layout: 'list',
    groupBy: 'state',
    shared: false,
    virtual: true,
    locked: true,
    favorite: false,
    readable: true,
    createdAt: '1970-01-01T00:00:00.000Z',
  };
}

const realFetch = globalThis.fetch;
let posted: { url: string; body: Record<string, unknown> }[] = [];

function stubCreateView(view: View): void {
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    posted.push({
      url,
      body:
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : ({} as Record<string, unknown>),
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ view }),
    });
  }) as unknown as typeof fetch;
}

function renderPage(views: readonly View[]): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.views(), views);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <ViewsPage />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  workspace = buildWorkspace();
  posted = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('the views page', () => {
  it('sends a workspace wide built-in to a workspace destination, never to a team', () => {
    renderPage([builtInView('virtual:all', 'All issues')]);

    const link = screen.getByTestId('open-All issues');
    expect(link).toHaveAttribute('href', '/views/virtual%3Aall');
    expect(link.getAttribute('href')).not.toContain('/team/');
  });

  it('does not tell people a built-in view is visible only to them', () => {
    renderPage([builtInView('virtual:all', 'All issues')]);

    const row = screen.getByTestId('view-All issues');
    expect(within(row).queryByText('Only me')).toBeNull();
    expect(within(row).getByText('Everyone')).toBeInTheDocument();
  });

  it('offers a way to make a view instead of hiding it behind a keystroke', () => {
    renderPage([builtInView('virtual:all', 'All issues')]);

    expect(screen.getByTestId('new-view')).toBeInTheDocument();
    expect(screen.getByTestId('no-saved-views')).toBeInTheDocument();
  });

  it('creates a view from the dialog and lists it straight away', async () => {
    const created: View = {
      id: 'view-new',
      ownerId: 'user-1',
      name: 'High priority bugs',
      filter: defaultViewState('list'),
      layout: 'list',
      groupBy: 'state',
      shared: false,
      virtual: false,
      locked: false,
      favorite: false,
      readable: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    stubCreateView(created);
    const user = userEvent.setup();
    renderPage([builtInView('virtual:all', 'All issues')]);

    expect(screen.queryByTestId('view-High priority bugs')).toBeNull();

    await user.click(screen.getByTestId('new-view'));
    await user.type(await screen.findByTestId('create-view-name'), 'High priority bugs');
    await user.click(screen.getByTestId('create-view-submit'));

    const row = await screen.findByTestId('view-High priority bugs');
    expect(within(row).getByTestId('open-High priority bugs')).toHaveAttribute(
      'href',
      '/views/view-new',
    );
    expect(screen.queryByTestId('no-saved-views')).toBeNull();

    const call = posted.at(-1);
    expect(call?.url).toBe('/api/views');
    expect(call?.body['name']).toBe('High priority bugs');
    expect(call?.body['shared']).toBe(false);
  });

  it('refuses to create a view with no name', async () => {
    stubCreateView(builtInView('virtual:all', 'All issues'));
    const user = userEvent.setup();
    renderPage([]);

    await user.click(screen.getByTestId('new-view'));
    expect(await screen.findByTestId('create-view-submit')).toBeDisabled();
    expect(posted).toHaveLength(0);
  });

  it('names the team a team view is shared with, rather than the workspace', () => {
    const teamView: View = {
      id: 'view-team',
      ownerId: 'user-2',
      name: 'Engineering triage',
      filter: { ...defaultViewState('list'), teamId: 'team-eng', visibility: 'team' },
      layout: 'list',
      groupBy: 'state',
      shared: true,
      virtual: false,
      locked: false,
      favorite: false,
      readable: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    renderPage([teamView]);

    const row = screen.getByTestId('view-Engineering triage');
    expect(within(row).getByText('Everyone on Engineering')).toBeInTheDocument();
    expect(within(row).queryByText('Everyone in the workspace')).toBeNull();
  });

  it('says a view whose stored settings could not be read shows the defaults', () => {
    const unreadable: View = {
      id: 'view-legacy',
      ownerId: 'user-1',
      name: 'Legacy view',
      filter: defaultViewState('list'),
      layout: 'list',
      groupBy: 'state',
      shared: false,
      virtual: false,
      locked: false,
      favorite: false,
      readable: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    renderPage([unreadable]);

    const row = screen.getByTestId('view-Legacy view');
    expect(within(row).getByTestId('unreadable-Legacy view')).toBeInTheDocument();
    expect(within(row).queryByText('No filters')).toBeNull();
  });

  it('opens the same dialog from Alt+V so the old keystroke still works', async () => {
    const user = userEvent.setup();
    renderPage([]);

    expect(screen.queryByTestId('create-view-dialog')).toBeNull();
    await user.keyboard('{Alt>}v{/Alt}');

    await waitFor(() => expect(screen.getByTestId('create-view-dialog')).toBeInTheDocument());
  });
});
