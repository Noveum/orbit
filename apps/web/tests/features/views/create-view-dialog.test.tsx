import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ViewState } from '@orbit/shared/filters';
import { conditionsOf, viewStateSchema } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';

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

const { CreateViewDialog, parseViewScope, viewScopePage } = await import(
  '@/features/views/create-view-dialog.tsx'
);

function buildWorkspace(): WorkspaceData {
  return {
    ready: true,
    userId: 'user-1',
    teams: [{ id: 'team-eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#f95b6c' }],
    states: [
      {
        id: 'state-todo',
        teamId: 'team-eng',
        name: 'Todo',
        category: 'unstarted',
        color: '#5d6272',
        position: 1,
      },
    ],
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
      {
        id: 'user-2',
        name: 'Aditi Rao',
        email: 'aditi@noveum.ai',
        image: null,
        handle: 'aditi',
        role: 'member',
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
    stateById: new Map(),
    labelById: new Map(),
    memberById: new Map(),
    openQuickCreate: () => undefined,
  };
}

const realFetch = globalThis.fetch;
let bodies: Record<string, unknown>[] = [];

function stubCreate(): void {
  globalThis.fetch = mock((_url: string, init?: RequestInit) => {
    if (typeof init?.body === 'string') {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          view: {
            id: 'view-new',
            ownerId: 'user-1',
            name: 'Saved',
            filter: viewStateSchema.parse({}),
            layout: 'list',
            groupBy: 'state',
            shared: false,
            virtual: false,
            locked: false,
            favorite: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        }),
    });
  }) as unknown as typeof fetch;
}

function renderDialog(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <CreateViewDialog open onOpenChange={() => undefined} />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function sentState(): ViewState {
  const body = bodies.at(-1);
  if (body === undefined) throw new Error('nothing was posted');
  return viewStateSchema.parse(body['filter']);
}

beforeEach(() => {
  workspace = buildWorkspace();
  bodies = [];
  stubCreate();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('the scope a new view covers', () => {
  it('reads workspace, team and project scopes off one value', () => {
    expect(parseViewScope('workspace')).toEqual({ teamId: null, projectId: null });
    expect(parseViewScope('team:team-eng')).toEqual({ teamId: 'team-eng', projectId: null });
    expect(parseViewScope('project:project-atlas')).toEqual({
      teamId: null,
      projectId: 'project-atlas',
    });
  });

  it('offers the filters each scope can actually use', () => {
    expect(viewScopePage('workspace')).toBe('saved_view');
    expect(viewScopePage('team:team-eng')).toBe('team');
    expect(viewScopePage('project:project-atlas')).toBe('project');
  });
});

describe('building a view in the dialog', () => {
  it('keeps a new view workspace wide unless someone narrows it', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId('create-view-name'), 'Everything urgent');
    await user.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(sentState().teamId).toBeNull();
    expect(sentState().projectId).toBeNull();
    expect(bodies.at(-1)?.['layout']).toBe('list');
  });

  it('narrows a view to the team picked in the scope control', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId('create-view-name'), 'Engineering triage');
    await user.click(screen.getByTestId('create-view-scope'));
    await user.click(await screen.findByRole('option', { name: 'Engineering' }));
    await user.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(sentState().teamId).toBe('team-eng');
    expect(sentState().projectId).toBeNull();
  });

  it('saves the filter built with the shared filter builder', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId('create-view-name'), 'Aditi work');
    await user.click(screen.getByTestId('add-filter'));
    await user.click(await screen.findByTestId('filter-field-assignee'));
    await user.click(await screen.findByTestId('filter-value-user-2'));
    await user.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(conditionsOf(sentState().filter)).toEqual([
      {
        kind: 'condition',
        property: 'assignee',
        operator: 'in',
        values: ['user-2'],
        negate: false,
      },
    ]);
  });

  it('saves the layout and grouping chosen in the dialog', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId('create-view-name'), 'Board of work');
    await user.click(screen.getByTestId('layout-board'));
    await user.click(screen.getByTestId('display-menu-trigger'));
    await user.click(await screen.findByTestId('group-by-assignee'));
    await user.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(sentState().layout).toBe('board');
    expect(sentState().groupBy).toBe('assignee');
    expect(bodies.at(-1)?.['groupBy']).toBe('assignee');
  });

  it('shares a view with the workspace only when asked', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId('create-view-name'), 'Team triage');
    await user.click(screen.getByTestId('create-view-visibility-workspace'));
    await user.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(sentState().visibility).toBe('workspace');
    expect(bodies.at(-1)?.['shared']).toBe(true);
  });
});

describe('who a new view is shared with', () => {
  async function pickEngineering(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByTestId('create-view-scope'));
    await user.click(await screen.findByRole('option', { name: 'Engineering' }));
  }

  it('offers a team audience only once the view covers a team', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.queryByTestId('create-view-visibility-team')).not.toBeInTheDocument();

    await pickEngineering(user);

    const option = await screen.findByTestId('create-view-visibility-team');
    expect(option).toBeInTheDocument();
    expect(screen.getByLabelText('Everyone on Engineering')).toBe(option);
  });

  it('keeps a team view on the team that owns it', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId('create-view-name'), 'Engineering triage');
    await pickEngineering(user);
    await user.click(await screen.findByTestId('create-view-visibility-team'));
    await user.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(sentState().visibility).toBe('team');
    expect(sentState().teamId).toBe('team-eng');
    expect(bodies.at(-1)?.['shared']).toBe(true);
  });

  it('never leaves a team audience on a view that stopped covering a team', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId('create-view-name'), 'Everything urgent');
    await pickEngineering(user);
    await user.click(await screen.findByTestId('create-view-visibility-team'));

    await user.click(screen.getByTestId('create-view-scope'));
    await user.click(await screen.findByRole('option', { name: 'Everything in the workspace' }));
    await user.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(sentState().teamId).toBeNull();
    expect(sentState().visibility).toBe('private');
    expect(bodies.at(-1)?.['shared']).toBe(false);
  });
});
