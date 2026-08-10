import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { InboxItem } from '@/features/inbox/data.ts';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import type { Member, WorkflowState } from '@/lib/query/schemas.ts';

const realtimeReact = { ...(await import('@orbit/realtime-client/react')) };
mock.module('@orbit/realtime-client/react', () => ({
  ...realtimeReact,
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

const STUBBED = {
  'next/navigation': {
    useRouter: () => ({
      push: () => undefined,
      replace: () => undefined,
      refresh: () => undefined,
      prefetch: () => undefined,
    }),
    usePathname: () => '/inbox',
  },
  '@/features/docs/doc-surface.tsx': {
    DocSurface: ({
      docId,
      canWriteDocs,
      canPublish,
    }: {
      docId: string;
      canWriteDocs: boolean;
      canPublish: boolean;
    }) => (
      <div
        data-testid="doc-surface"
        data-doc-id={docId}
        data-can-write={String(canWriteDocs)}
        data-can-publish={String(canPublish)}
      />
    ),
  },
  '@/features/comments/viewer-presence.tsx': { ViewerPresence: () => null },
  '@/features/pulls/issue-pull-requests.tsx': { IssuePullRequests: () => null },
  '@/features/docs/editor/rich-text-editor.tsx': {
    RichTextEditor: ({ value, testId }: { value: string; testId?: string }) => (
      <div data-testid={testId}>{value}</div>
    ),
  },
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
  mock.module('@orbit/realtime-client/react', () => realtimeReact);
});

const todo: WorkflowState = {
  id: 'state_todo',
  teamId: 'team_1',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 1,
};

const ada: Member = {
  id: 'user_2',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  image: null,
  handle: 'ada',
  role: 'member',
};

const workspace: WorkspaceData = {
  ready: true,
  userId: 'user_1',
  role: 'admin',
  teams: [{ id: 'team_1', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
  states: [todo],
  labels: [],
  members: [ada],
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: new Map([[todo.id, todo]]),
  labelById: new Map(),
  memberById: new Map([[ada.id, ada]]),
  openQuickCreate: () => undefined,
};

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { InboxView } = await import('@/features/inbox/inbox-view.tsx');

const DETAIL = {
  issue: {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 3,
    identifier: 'ENG-3',
    title: 'Review the AutoFix pull requests',
    description: 'The rollout plan lives in the runbook.',
    stateId: 'state_todo',
    priority: 3,
    creatorId: 'user_2',
    assigneeId: null,
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 1,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    stateEnteredAt: '2026-01-01T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
  },
  descriptionHtml: '<p>The rollout plan lives in the runbook.</p>',
  activity: [],
  activityCursor: null,
  subIssues: [],
  parent: null,
  subscribed: false,
};

function comment(id: string, body: string) {
  return {
    comment: {
      id,
      issueId: 'issue_1',
      authorId: 'user_2',
      parentId: null,
      body,
      editedAt: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: null,
      syncId: 2,
    },
    bodyHtml: `<p>${body}</p>`,
    reactions: [],
  };
}

const COMMENTS = [
  comment('comment_8', 'Older note that is not what the notification is about.'),
  comment('comment_9', 'This needs a second pair of eyes.'),
];

function answerFor(path: string): unknown {
  if (path.includes('/api/comments')) return { comments: COMMENTS, nextCursor: null };
  if (path.includes('/api/issues/')) return DETAIL;
  return { unreadCount: 0 };
}

const realFetch = globalThis.fetch;
let requests: string[] = [];

beforeEach(() => {
  requests = [];
  globalThis.fetch = mock((url: string) => {
    const path = String(url);
    requests.push(path);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answerFor(path)) });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'notification_1',
    type: 'comment_created',
    entityType: 'comment',
    entityId: 'comment_9',
    actorName: 'Ada Lovelace',
    title: 'New comment on ENG-3',
    body: 'This needs a second pair of eyes.',
    url: '/issue/ENG-3#comment-comment_9',
    read: false,
    snoozedUntil: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function renderInbox(
  items: readonly InboxItem[],
  docAccess: { canWriteDocs: boolean; canPublishDocs: boolean } = {
    canWriteDocs: true,
    canPublishDocs: true,
  },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <HotkeyProvider>
            <InboxView
              items={items}
              unreadCount={1}
              unreadMentions={0}
              userId="user_1"
              canWriteDocs={docAccess.canWriteDocs}
              canPublishDocs={docAccess.canPublishDocs}
            />
          </HotkeyProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('reading a notification in the inbox', () => {
  it('shows the whole issue, not a trimmed preview of it', async () => {
    renderInbox([item()]);

    const detail = await screen.findByTestId('issue-detail');
    expect(await screen.findByTestId('issue-title')).toHaveValue(
      'Review the AutoFix pull requests',
    );
    expect(detail).toHaveTextContent('ENG-3');
    expect(detail).toHaveTextContent('Todo');
    expect(screen.getByTestId('issue-description')).toHaveTextContent(
      'The rollout plan lives in the runbook.',
    );
  });

  it('carries the properties sidebar the issue page shows', async () => {
    renderInbox([item()]);

    await screen.findByTestId('issue-detail');
    expect(await screen.findByTestId('property-status')).toBeInTheDocument();
    expect(screen.getByTestId('property-assignee')).toBeInTheDocument();
  });

  it('shows the comment itself, and who wrote it', async () => {
    renderInbox([item()]);

    const posted = await screen.findByTestId('comment-comment_9');
    expect(posted).toHaveTextContent('This needs a second pair of eyes.');
    expect(posted).toHaveTextContent('Ada Lovelace');
  });

  it('marks out the comment the notification is about', async () => {
    renderInbox([item()]);

    const posted = await screen.findByTestId('comment-comment_9');
    expect(posted).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('comment-comment_8')).not.toHaveAttribute('data-focused');
  });

  it('lets the reader reply without leaving the inbox', async () => {
    renderInbox([item()]);

    await screen.findByTestId('comment-thread');
    expect(screen.getByTestId('comment-composer')).toBeInTheDocument();
  });

  it('follows the selection when another notification is opened', async () => {
    const user = userEvent.setup();
    renderInbox([
      item({ id: 'notification_1', title: 'First', url: '/issue/ENG-1' }),
      item({ id: 'notification_2', title: 'Second', url: '/issue/ENG-2' }),
    ]);

    await waitFor(() => {
      expect(requests.some((path) => path.includes('ENG-1'))).toBe(true);
    });
    expect(requests.some((path) => path.includes('ENG-2'))).toBe(false);

    await user.click(screen.getByRole('button', { name: /Second/ }));

    await waitFor(() => {
      expect(requests.some((path) => path.includes('ENG-2'))).toBe(true);
    });
  });

  it('keeps the pull request a review was requested on, which the issue never names', async () => {
    renderInbox([
      item({
        type: 'pr_review_requested',
        entityType: 'issue',
        entityId: 'issue_1',
        title: 'Review requested on Fan out delta packets',
        body: 'Noveum/orbit#412',
        url: '/issue/ENG-3',
      }),
    ]);

    await screen.findByTestId('issue-detail');
    expect(screen.getByTestId('inbox-event-context')).toHaveTextContent('Noveum/orbit#412');
  });

  it('does not repeat a body the issue itself already says', async () => {
    renderInbox([
      item({
        type: 'issue_assigned',
        entityType: 'issue',
        entityId: 'issue_1',
        title: 'Assigned you ENG-3',
        body: 'Review the AutoFix pull requests',
        url: '/issue/ENG-3',
      }),
    ]);

    await screen.findByTestId('issue-detail');
    expect(screen.queryByTestId('inbox-event-context')).toBeNull();
    expect(screen.getAllByText('Review the AutoFix pull requests')).toHaveLength(1);
  });

  it('shows the doc itself when the notification is about one', () => {
    renderInbox([
      item({
        type: 'document_changed',
        entityType: 'doc',
        entityId: 'doc_1',
        url: '/docs/doc_1',
        body: 'Runbook changed',
      }),
    ]);

    expect(screen.queryByTestId('issue-detail')).toBeNull();
    const surface = screen.getByTestId('doc-surface');
    expect(surface).toHaveAttribute('data-doc-id', 'doc_1');
  });

  it('carries the reader own doc permissions rather than assuming them', () => {
    renderInbox(
      [
        item({
          type: 'document_changed',
          entityType: 'doc',
          entityId: 'doc_1',
          url: '/docs/doc_1',
        }),
      ],
      { canWriteDocs: true, canPublishDocs: false },
    );

    const surface = screen.getByTestId('doc-surface');
    expect(surface).toHaveAttribute('data-can-write', 'true');
    expect(surface).toHaveAttribute('data-can-publish', 'false');
  });

  it('refuses to write into a doc the reader may not edit', () => {
    renderInbox(
      [
        item({
          type: 'document_changed',
          entityType: 'doc',
          entityId: 'doc_1',
          url: '/docs/doc_1',
        }),
      ],
      { canWriteDocs: false, canPublishDocs: false },
    );

    expect(screen.getByTestId('doc-surface')).toHaveAttribute('data-can-write', 'false');
  });

  it('keeps the plain notification body when there is neither issue nor doc behind it', () => {
    renderInbox([
      item({
        type: 'member_joined',
        entityType: 'member',
        entityId: 'member_1',
        url: '/settings/members',
        body: 'Ada joined the workspace',
      }),
    ]);

    expect(screen.queryByTestId('issue-detail')).toBeNull();
    expect(screen.queryByTestId('doc-surface')).toBeNull();
    expect(screen.getByText('Ada joined the workspace')).toBeInTheDocument();
  });
});
