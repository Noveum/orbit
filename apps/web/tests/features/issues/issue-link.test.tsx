import { afterAll, describe, expect, it, mock } from 'bun:test';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { render, screen, within } from '@/test/render.tsx';
import type { WorkspaceData } from '../../../src/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '../../../src/features/issues/workspace-provider.tsx';

const realLink = await import('next/link');

interface LinkStubProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly prefetch?: boolean | 'auto' | null;
}

mock.module('next/link', () => ({
  __esModule: true,
  default: ({ href, prefetch, children, ...rest }: LinkStubProps) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), prefetch: mock() }),
  usePathname: () => '/team/eng/issues',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
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
    number: 7,
    identifier: 'ENG-7',
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

const results: readonly Issue[] = [issue({ id: 'issue_12', number: 12, identifier: 'ENG-12' })];

mock.module('@/lib/query/use-issue-search.ts', () => ({
  useIssueSearch: (term: string) => ({
    issues: term.trim().length === 0 ? [] : results,
    searching: false,
  }),
}));

const { IssueRow } = await import('../../../src/features/issues/issue-row.tsx');
const { IssueCard } = await import('../../../src/features/issues/issue-card.tsx');
const { CommandPalette } = await import('@/components/command-palette.tsx');
const { HotkeyProvider } = await import('@/lib/keyboard/index.ts');
const { buildNavigation } = await import('@/lib/navigation.ts');

afterAll(() => {
  mock.module('next/link', () => realLink);
});

function prefetchOf(link: HTMLElement): string | null {
  return link.getAttribute('data-prefetch');
}

describe('prefetching an issue link', () => {
  it('leaves a list row out of the viewport prefetch, so scrolling costs nothing', () => {
    render(
      <IssueRow
        issue={issue()}
        state={todo}
        labels={[]}
        assignee={undefined}
        active={false}
        selected={false}
        onOpen={mock()}
        onToggleSelected={mock()}
        onFocus={mock()}
      />,
    );

    const row = screen.getByTestId('issue-row-ENG-7');
    expect(prefetchOf(within(row).getByRole('link'))).toBe('false');
  });

  it('keeps a board card prefetching, because a column holds few enough cards', () => {
    render(<IssueCard issue={issue()} labels={[]} assignee={undefined} state={todo} />);

    const card = screen.getByTestId('issue-card-ENG-7');
    expect(prefetchOf(within(card).getByRole('link'))).not.toBe('false');
  });

  it('leaves a palette hit out of the prefetch, because every keystroke remounts it', async () => {
    render(
      <HotkeyProvider>
        <CommandPalette
          open
          onOpenChange={mock()}
          sections={buildNavigation([{ id: 'team_1', key: 'ENG', name: 'Engineering' }])}
          onToggleSidebar={() => undefined}
          onShowShortcuts={() => undefined}
        />
      </HotkeyProvider>,
    );

    await userEvent.setup().type(await screen.findByPlaceholderText(/Search issues/), 'domain');
    const hit = await screen.findByTestId('palette-issue-ENG-12');

    expect(prefetchOf(within(hit).getByRole('link'))).toBe('false');
  });
});
