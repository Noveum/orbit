import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue, IssueDetail, WorkflowState } from '@/lib/query/schemas.ts';
import type { WorkspaceData } from '../../../src/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '../../../src/features/issues/workspace-provider.tsx';

const pushed: string[] = [];

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: (path: string) => pushed.push(path),
    replace: () => undefined,
    refresh: () => undefined,
    prefetch: () => undefined,
  }),
  usePathname: () => '/issue/ENG-1',
}));

const STUBBED = {
  '@/features/comments/viewer-presence.tsx': { ViewerPresence: () => null },
  '@/features/comments/comment-thread.tsx': { CommentThread: () => null },
  '@/features/pulls/issue-pull-requests.tsx': { IssuePullRequests: () => null },
  '@/features/issues/issue-properties.tsx': { IssueProperties: () => null },
  '@/features/docs/editor/rich-text-editor.tsx': { RichTextEditor: () => null },
  '@/lib/query/use-comments.ts': { useComments: () => ({ data: [] }) },
} as const;

const originals = new Map<string, Record<string, unknown>>();
for (const specifier of Object.keys(STUBBED)) {
  originals.set(specifier, { ...(await import(specifier)) });
}
for (const [specifier, stub] of Object.entries(STUBBED)) {
  mock.module(specifier, () => stub);
}

afterAll(() => {
  for (const [specifier, real] of originals) mock.module(specifier, () => real);
});

const todo: WorkflowState = {
  id: 'state_todo',
  teamId: 'team_1',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 1,
};

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

const { IssueDetailView, teamIssuesPath } = await import(
  '../../../src/features/issues/issue-detail.tsx'
);
const { IssueDeletionProvider } = await import('../../../src/features/issues/issue-deletion.tsx');

const issue: Issue = {
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
};

const detail: IssueDetail = {
  issue,
  descriptionHtml: '',
  activity: [],
  activityCursor: null,
  subIssues: [],
  subscribed: false,
};

const originalFetch = globalThis.fetch;
const deleted: string[] = [];

function stubFetch(): void {
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? 'GET') === 'DELETE') {
      deleted.push(url);
      return Promise.resolve(Response.json({ deleted: { id: 'issue_1', identifier: 'ENG-1' } }));
    }
    return Promise.resolve(Response.json(detail));
  }) as unknown as typeof fetch;
}

function mountDetail(onDeleted?: () => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.issue('ENG-1'), detail);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <IssueDeletionProvider>
            <IssueDetailView identifier="ENG-1" onDeleted={onDeleted} />
          </IssueDeletionProvider>
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const user = userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  pushed.length = 0;
  deleted.length = 0;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('deleting from the issue detail surface', () => {
  it('offers delete in the header menu and confirms before it fires', async () => {
    mountDetail();

    await user.click(await screen.findByTestId('issue-actions-ENG-1'));
    await user.click(await screen.findByTestId('delete-issue-ENG-1'));

    const dialog = await screen.findByTestId('delete-issue-dialog');
    expect(dialog.textContent).toContain('Delete ENG-1?');
    expect(deleted).toEqual([]);

    await user.click(screen.getByTestId('confirm-delete-issue'));
    await waitFor(() => expect(deleted).toEqual(['/api/issues/issue_1']));
  });

  it('sends the page back to the team list once the issue is gone', async () => {
    mountDetail();

    await user.click(await screen.findByTestId('issue-actions-ENG-1'));
    await user.click(await screen.findByTestId('delete-issue-ENG-1'));
    await screen.findByTestId('delete-issue-dialog');
    await user.click(screen.getByTestId('confirm-delete-issue'));

    await waitFor(() => expect(pushed).toEqual(['/team/eng/issues']));
  });

  it('closes the peek instead of navigating when the peek owns the view', async () => {
    const closed: string[] = [];
    mountDetail(() => closed.push('closed'));

    await user.click(await screen.findByTestId('issue-actions-ENG-1'));
    await user.click(await screen.findByTestId('delete-issue-ENG-1'));
    await screen.findByTestId('delete-issue-dialog');
    await user.click(screen.getByTestId('confirm-delete-issue'));

    await waitFor(() => expect(closed).toEqual(['closed']));
    expect(pushed).toEqual([]);
  });

  it('answers the same shortcut the list uses', async () => {
    mountDetail();
    await screen.findByTestId('issue-detail');

    await user.keyboard('{Meta>}{Shift>}{Backspace}{/Shift}{/Meta}');

    expect((await screen.findByTestId('delete-issue-dialog')).textContent).toContain(
      'Delete ENG-1?',
    );
    expect(deleted).toEqual([]);
  });
});

describe('teamIssuesPath', () => {
  it('routes back to the team the issue belonged to', () => {
    expect(teamIssuesPath(workspace.teams, 'team_1')).toBe('/team/eng/issues');
  });

  it('falls back to my issues when the team is not in reach', () => {
    expect(teamIssuesPath(workspace.teams, 'team_missing')).toBe('/my-issues');
  });
});
