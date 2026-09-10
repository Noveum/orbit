import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import type { Issue, Member, WorkflowState } from '@/lib/query/schemas.ts';
import { emptyFacets } from '@/lib/query/schemas.ts';
import type { WorkspaceData } from '../../../src/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '../../../src/features/issues/workspace-provider.tsx';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile(['@/features/issues/workspace-provider.tsx']);

let search = '';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/standup',
  useSearchParams: () => new URLSearchParams(search),
}));

mock.module('@/features/comments/viewer-presence.tsx', () => ({
  ViewerPresence: () => null,
}));

let workspace: WorkspaceData;
mock.module('../../../src/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { StandupBoard, standupBoardOptions } = await import(
  '../../../src/features/standup/standup-board.tsx'
);

const todo: WorkflowState = {
  id: 'state_todo',
  teamId: 'team_eng',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 1,
};

const doing: WorkflowState = {
  id: 'state_doing',
  teamId: 'team_eng',
  name: 'In Progress',
  category: 'started',
  color: '#f2c94c',
  position: 2,
};

function member(id: string, name: string): Member {
  return { id, name, email: `${id}@orbit.test`, image: null, handle: null, role: 'member' };
}

const ada = member('user_ada', 'Ada Lovelace');
const bo = member('user_bo', 'Bo Chen');

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_eng',
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship the board',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    creatorId: 'user_ada',
    assigneeId: 'user_ada',
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

const ADA_ISSUE = issue({
  id: 'issue_ada',
  identifier: 'ENG-1',
  assigneeId: ada.id,
  reviewerIds: [bo.id],
});
const BO_ISSUE = issue({
  id: 'issue_bo',
  identifier: 'ENG-2',
  number: 2,
  title: 'Fix the socket',
  stateId: doing.id,
  assigneeId: bo.id,
  creatorId: bo.id,
});
const ORPHAN_ISSUE = issue({
  id: 'issue_orphan',
  identifier: 'ENG-3',
  number: 3,
  title: 'Nobody owns this',
  assigneeId: null,
});

function buildWorkspace(): WorkspaceData {
  return {
    ready: true,
    userId: ada.id,
    role: 'admin',
    teams: [{ id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5b6cf9' }],
    states: [todo, doing],
    labels: [],
    members: [ada, bo],
    projects: [],
    cycles: [],
    seedIssues: [],
    stateById: new Map([
      [todo.id, todo],
      [doing.id, doing],
    ]),
    labelById: new Map(),
    memberById: new Map([
      [ada.id, ada],
      [bo.id, bo],
    ]),
    openQuickCreate: () => undefined,
  };
}

const originalFetch = globalThis.fetch;

function participantIdIn(url: string): string | null {
  return new URL(url, 'http://localhost:3000').searchParams.get('participantId');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Served {
  readonly listUrls: string[];
  readonly facetUrls: string[];
  readonly rosterUrls: string[];
}

const ISSUES = [ADA_ISSUE, BO_ISSUE, ORPHAN_ISSUE];

function involving(participant: string | null): readonly Issue[] {
  if (participant === null) return ISSUES;
  if (participant === 'none') return ISSUES.filter((row) => row.assigneeId === null);
  return ISSUES.filter(
    (row) => row.assigneeId === participant || (row.reviewerIds ?? []).includes(participant),
  );
}

function serve(options: { failList?: boolean; failRoster?: boolean } = {}): Served {
  const listUrls: string[] = [];
  const facetUrls: string[] = [];
  const rosterUrls: string[] = [];

  globalThis.fetch = mock((input: string | URL | Request) => {
    const url = String(input);
    const path = url.split('?')[0] ?? url;
    const params = new URL(url, 'http://localhost:3000').searchParams;
    const participant = participantIdIn(url);

    if (path === '/api/issues/facets') {
      facetUrls.push(url);
      const counts = participant === null ? { [ada.id]: 5, [bo.id]: 3 } : { [participant]: 7 };
      return Promise.resolve(
        json({ scopeTotal: 8, facets: { ...emptyFacets(), assignee: counts } }),
      );
    }

    if (path === '/api/issues/summary') {
      if (params.get('groupBy') === 'participant') {
        rosterUrls.push(url);
        if (options.failRoster === true) {
          return Promise.resolve(json({ error: { code: 'internal', message: 'nope' } }, 500));
        }
        return Promise.resolve(
          json({
            total: 8,
            byState: {},
            groupTotals: { [ada.id]: 5, [bo.id]: 3, none: 1 },
          }),
        );
      }
      return Promise.resolve(
        json({ total: involving(participant).length, byState: {}, groupTotals: {} }),
      );
    }

    if (path === '/api/issues') {
      listUrls.push(url);
      if (options.failList === true) {
        return Promise.resolve(json({ error: { code: 'internal', message: 'nope' } }, 500));
      }
      return Promise.resolve(json({ issues: involving(participant), nextCursor: null }));
    }

    return Promise.resolve(json({}));
  }) as unknown as typeof fetch;

  return { listUrls, facetUrls, rosterUrls };
}

function mountBoard(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <StandupBoard />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function cardShown(identifier: string): boolean {
  return screen.queryByTestId(`issue-card-${identifier}`) !== null;
}

function cardHref(identifier: string): string | null {
  const card = screen.queryByTestId(`issue-card-${identifier}`);
  return card === null ? null : (card.querySelector('a')?.getAttribute('href') ?? null);
}

function tileCount(userId: string): string | null {
  return screen.queryByTestId(`standup-tile-count-${userId}`)?.textContent ?? null;
}

const PRIORITY_FILTER = JSON.stringify({
  kind: 'group',
  combinator: 'and',
  children: [{ kind: 'condition', property: 'priority', operator: 'in', values: ['1'] }],
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  search = '';
  window.history.replaceState(null, '', '/standup');
});

describe('StandupBoard', () => {
  it('opens on the whole workspace, asking the server for nobody in particular', async () => {
    workspace = buildWorkspace();
    const served = serve();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));

    expect(served.listUrls.length).toBe(1);
    expect(participantIdIn(served.listUrls[0] ?? '')).toBeNull();
    expect(served.facetUrls.every((url) => participantIdIn(url) === null)).toBe(true);
  });

  it('shows every person work side by side, not one person at a time', async () => {
    workspace = buildWorkspace();
    serve();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));

    expect(cardShown('ENG-1')).toBe(true);
    expect(cardShown('ENG-2')).toBe(true);
  });

  it('gives every card a real link to its own issue page', async () => {
    workspace = buildWorkspace();
    serve();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));

    expect(cardHref('ENG-1')).toBe('/issue/ENG-1');
    expect(cardHref('ENG-2')).toBe('/issue/ENG-2');
  });

  it('narrows on the server when a person is picked, never in the browser', async () => {
    workspace = buildWorkspace();
    const served = serve();
    const user = userEvent.setup();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));
    await user.click(screen.getByTestId(`standup-tile-${bo.id}`));
    await user.click(screen.getByTestId('standup-members'));

    await waitFor(() => {
      expect(served.listUrls.some((url) => participantIdIn(url) === bo.id)).toBe(true);
    });
    expect(cardShown('ENG-1')).toBe(true);
    expect(cardShown('ENG-2')).toBe(true);
  });

  it('keeps the tile counts on the whole workspace once a person is picked', async () => {
    workspace = buildWorkspace();
    serve();
    const user = userEvent.setup();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));
    expect(tileCount(ada.id)).toBe('5');

    await user.click(screen.getByTestId(`standup-tile-${bo.id}`));
    await user.click(screen.getByTestId('standup-members'));

    await waitFor(() => {
      expect(screen.getByTestId(`standup-tile-${bo.id}`)).toHaveAttribute('aria-pressed', 'true');
    });
    expect(tileCount(ada.id)).toBe('5');
    expect(tileCount(bo.id)).toBe('3');
  });

  it('marks the tile counts unknown when the roster lookup fails, not zero', async () => {
    workspace = buildWorkspace();
    serve({ failRoster: true });
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));

    await waitFor(() => {
      expect(tileCount(ada.id)).toBe('?');
    });
    expect(tileCount(bo.id)).toBe('?');
  });

  it('offers a retry rather than an empty board when the request fails', async () => {
    workspace = buildWorkspace();
    serve({ failList: true });
    mountBoard();

    await screen.findByTestId('retry-standup');

    expect(screen.queryByTestId('standup-kanban')).toBeNull();
  });

  it('counts the roster under the filters in force, not the whole workspace', async () => {
    workspace = buildWorkspace();
    search = `filter=${encodeURIComponent(PRIORITY_FILTER)}`;
    const served = serve();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));

    expect(served.rosterUrls.length).toBeGreaterThan(0);
    expect(served.rosterUrls.every((url) => url.includes('filter='))).toBe(true);
    expect(served.rosterUrls.every((url) => participantIdIn(url) === null)).toBe(true);
  });

  it('offers the issues nobody owns as their own tile', async () => {
    workspace = buildWorkspace();
    const served = serve();
    const user = userEvent.setup();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));
    expect(tileCount('none')).toBe('1');

    await user.click(screen.getByTestId('standup-tile-none'));

    await waitFor(() => {
      expect(served.listUrls.some((url) => participantIdIn(url) === 'none')).toBe(true);
    });
    await waitFor(() => {
      expect(cardShown('ENG-3')).toBe(true);
    });
    expect(cardShown('ENG-1')).toBe(false);
  });

  it('writes the picked person into the url so a reload keeps them', async () => {
    workspace = buildWorkspace();
    serve();
    const user = userEvent.setup();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));
    await user.click(screen.getByTestId(`standup-tile-${bo.id}`));
    await user.click(screen.getByTestId('standup-members'));

    await waitFor(() => {
      expect(window.location.search).toContain(`person=${bo.id}`);
    });

    await user.click(screen.getByTestId(`standup-tile-${bo.id}`));
    await user.click(screen.getByTestId('standup-members'));

    await waitFor(() => {
      expect(window.location.search).not.toContain('person=');
    });
  });

  it('opens on the person the url names', async () => {
    workspace = buildWorkspace();
    search = `person=${bo.id}`;
    const served = serve();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));

    expect(served.listUrls.every((url) => participantIdIn(url) === bo.id)).toBe(true);
    expect(screen.getByTestId(`standup-tile-${bo.id}`).getAttribute('aria-pressed')).toBe('true');
    expect(cardShown('ENG-1')).toBe(true);
    expect(cardShown('ENG-2')).toBe(true);
  });

  it('falls back to everyone when the url names somebody who is not a member', async () => {
    workspace = buildWorkspace();
    search = 'person=user_ghost';
    const served = serve();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));

    expect(served.listUrls.every((url) => participantIdIn(url) === null)).toBe(true);
    expect(screen.getByTestId('standup-tile-everyone').getAttribute('aria-pressed')).toBe('true');
  });

  it('gives the board the same filter bar every other issue view has', async () => {
    workspace = buildWorkspace();
    serve();
    mountBoard();

    await screen.findByTestId('standup-kanban');
    await userEvent.setup().click(screen.getByTestId('standup-members'));

    expect(screen.getByTestId('filter-bar')).toBeTruthy();
    expect(screen.getByTestId('add-filter')).toBeTruthy();
    expect(screen.queryByTestId('save-view')).toBeNull();
  });

  it('regroups by the chosen field without assigning manual positions in a sorted view', () => {
    expect(standupBoardOptions('member', 'assignee', 'updated')).toEqual({
      draggable: true,
      groupBy: 'assignee',
      reorderable: false,
    });
    expect(standupBoardOptions('member', 'project', 'manual')).toEqual({
      draggable: true,
      groupBy: 'project',
      reorderable: true,
    });
  });

  it('removes drag affordances from guests and non-regroupable boards', () => {
    expect(standupBoardOptions('guest', 'state', 'manual').draggable).toBe(false);
    expect(standupBoardOptions('member', 'label', 'manual').draggable).toBe(false);
  });
});

describe('standup compact controls', () => {
  it('opens only the member button until clicked and switches immediately while Option is held', async () => {
    workspace = buildWorkspace();
    serve();
    mountBoard();
    await screen.findByTestId('standup-kanban');
    expect(screen.queryByTestId('standup-tile-user_ada')).toBeNull();
    fireEvent.keyDown(window, { key: 'Tab', altKey: true });
    await screen.findByTestId('standup-tile-user_ada');
    expect(window.location.search).toContain('person=user_ada');
    fireEvent.keyDown(window, { key: 'Tab', altKey: true });
    expect(window.location.search).toContain('person=user_bo');
    fireEvent.keyDown(window, { key: 'Tab', altKey: true, shiftKey: true });
    expect(window.location.search).toContain('person=user_ada');
    fireEvent.keyUp(window, { key: 'Tab', altKey: true });
    expect(screen.queryByTestId('standup-tile-user_ada')).not.toBeNull();
    fireEvent.keyUp(window, { key: 'Alt' });
    await waitFor(() => expect(screen.queryByTestId('standup-tile-user_ada')).toBeNull());
  });
  it('wraps backwards and closes on loss of focus', async () => {
    workspace = buildWorkspace();
    serve();
    mountBoard();
    await screen.findByTestId('standup-kanban');
    fireEvent.keyDown(window, { key: 'Tab', altKey: true, shiftKey: true });
    expect(window.location.search).toContain('person=none');
    await screen.findByTestId('standup-tile-none');
    fireEvent.blur(window);
    await waitFor(() => expect(screen.queryByTestId('standup-tile-none')).toBeNull());
  });
  it('sends combined AI and work type scopes to lists, facets and roster counts', async () => {
    workspace = buildWorkspace();
    search = 'aiOnly=true&workType=reviewing&person=user_ada';
    const served = serve();
    mountBoard();
    await screen.findByTestId('standup-kanban');
    for (const url of [...served.listUrls, ...served.facetUrls, ...served.rosterUrls]) {
      const params = new URL(url, 'http://localhost').searchParams;
      expect(params.get('aiOnly')).toBe('true');
      expect(params.get('workType')).toBe('reviewing');
    }
    expect(served.rosterUrls.every((url) => participantIdIn(url) === null)).toBe(true);
  });
});

describe('standup filter interactions', () => {
  it('combines the AI toggle and work type dropdown without clearing the member', async () => {
    workspace = buildWorkspace();
    search = `person=${bo.id}`;
    window.history.replaceState(null, '', `/standup?${search}`);
    const served = serve();
    mountBoard();
    await screen.findByTestId('standup-kanban');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'AI only' }));
    await user.click(screen.getByRole('button', { name: 'Work type: All work' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'To review' }));
    await waitFor(() =>
      expect(
        served.listUrls.some((url) => {
          const params = new URL(url, 'http://localhost').searchParams;
          return (
            params.get('aiOnly') === 'true' &&
            params.get('workType') === 'reviewing' &&
            params.get('participantId') === bo.id
          );
        }),
      ).toBe(true),
    );
    expect(window.location.search).toContain('workType=reviewing');
    expect(window.location.search).toContain(`person=${bo.id}`);
    await user.click(screen.getByRole('button', { name: 'AI only' }));
    expect(window.location.search).not.toContain('aiOnly=');
  });

  it('leaves ordinary Tab and editable fields alone and preserves focus during switching', async () => {
    workspace = buildWorkspace();
    serve();
    mountBoard();
    await screen.findByTestId('standup-kanban');
    const button = screen.getByRole('button', { name: 'AI only' });
    button.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.queryByTestId('standup-tiles')).toBeNull();
    fireEvent.keyDown(window, { key: 'Tab', altKey: true });
    await screen.findByTestId('standup-tiles');
    fireEvent.keyUp(window, { key: 'Alt' });
    await waitFor(() => expect(screen.queryByTestId('standup-tiles')).toBeNull());
    expect(document.activeElement).toBe(button);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', altKey: true });
    expect(screen.queryByTestId('standup-tiles')).toBeNull();
    input.remove();
  });
});
