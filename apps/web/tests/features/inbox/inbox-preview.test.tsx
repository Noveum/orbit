import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InboxItem } from '@/features/inbox/data.ts';
import { issueIdentifierFromUrl } from '@/features/inbox/inbox-preview.tsx';
import { InboxView } from '@/features/inbox/inbox-view.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

const DETAIL = {
  issue: {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 3,
    identifier: 'ENG-3',
    title: 'Review the AutoFix pull requests',
    description: '',
    stateId: 'state_1',
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
  descriptionHtml:
    '<ul data-type="taskList">\n<li data-checked="false"><input disabled="" type="checkbox"> Establish what this means</li>\n</ul>\n',
  activity: [],
  activityCursor: null,
  subIssues: [],
  parent: null,
  subscribed: false,
};

const realFetch = globalThis.fetch;
let detailRequests: string[] = [];

beforeEach(() => {
  detailRequests = [];
  globalThis.fetch = mock((url: string) => {
    const path = String(url);
    if (path.includes('/api/issues/')) {
      detailRequests.push(path);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(DETAIL),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ unreadCount: 0 }),
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'notification_1',
    type: 'issue_status_changed',
    entityType: 'issue',
    entityId: 'issue_1',
    actorName: 'Ada',
    title: 'ENG-3 moved to Done',
    body: 'Review the AutoFix pull requests',
    url: '/issue/ENG-3',
    read: false,
    snoozedUntil: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderInbox(items: readonly InboxItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HotkeyProvider>
        <InboxView items={items} unreadCount={1} unreadMentions={0} userId="user_1" />
      </HotkeyProvider>
    </QueryClientProvider>,
  );
}

describe('reading the issue behind a notification', () => {
  it('shows the issue itself rather than only the notification line', async () => {
    renderInbox([item()]);

    const preview = await screen.findByTestId('inbox-preview');
    expect(preview).toHaveTextContent('ENG-3');
    expect(preview).toHaveTextContent('Review the AutoFix pull requests');
  });

  it('renders the description as markdown, checkboxes and all', async () => {
    renderInbox([item()]);

    await screen.findByTestId('inbox-preview');
    const body = screen.getByTestId('doc-body');
    expect(body.querySelector('ul[data-type=taskList]')).not.toBeNull();
    expect(body.querySelector('li[data-checked]')).not.toBeNull();
    expect(body).toHaveTextContent('Establish what this means');
  });

  it('asks the server for the issue the notification points at', async () => {
    renderInbox([item()]);

    await waitFor(() => {
      expect(detailRequests.some((path) => path.includes('ENG-3'))).toBe(true);
    });
  });

  it('follows the selection when another notification is opened', async () => {
    const user = userEvent.setup();
    renderInbox([
      item({ id: 'notification_1', title: 'First', url: '/issue/ENG-1' }),
      item({ id: 'notification_2', title: 'Second', url: '/issue/ENG-2' }),
    ]);

    await waitFor(() => {
      expect(detailRequests.some((path) => path.includes('ENG-1'))).toBe(true);
    });
    expect(detailRequests.some((path) => path.includes('ENG-2'))).toBe(false);

    await user.click(screen.getByRole('button', { name: /Second/ }));

    await waitFor(() => {
      expect(detailRequests.some((path) => path.includes('ENG-2'))).toBe(true);
    });
  });

  it('keeps a body the issue title does not already say, as a pull request one carries', async () => {
    renderInbox([
      item({
        type: 'pr_review_requested',
        title: 'Review requested on ENG-3',
        body: 'Noveum/orbit#412',
      }),
    ]);

    await screen.findByTestId('inbox-preview');
    expect(screen.getByTestId('inbox-preview-body')).toHaveTextContent('Noveum/orbit#412');
  });

  it('keeps the plain notification body when there is no issue to show', () => {
    renderInbox([item({ url: '/docs/doc_1', entityType: 'doc', body: 'Runbook changed' })]);

    expect(screen.queryByTestId('inbox-preview')).toBeNull();
    expect(screen.getByText('Runbook changed')).toBeInTheDocument();
  });

  it('keeps the comment itself, which the issue preview does not repeat', async () => {
    renderInbox([
      item({
        type: 'comment_created',
        entityType: 'comment',
        entityId: 'comment_9',
        title: 'Commented on ENG-3',
        body: 'This needs a second pair of eyes.',
        url: '/issue/ENG-3#comment-comment_9',
      }),
    ]);

    await screen.findByTestId('inbox-preview');
    expect(screen.getByText('This needs a second pair of eyes.')).toBeInTheDocument();
  });

  it('drops the body that only repeats the issue title the preview already shows', async () => {
    renderInbox([item({ body: 'Review the AutoFix pull requests' })]);

    await screen.findByTestId('inbox-preview');
    expect(screen.getAllByText('Review the AutoFix pull requests')).toHaveLength(1);
  });
});

describe('issueIdentifierFromUrl', () => {
  it('reads the identifier out of the links a notification carries', () => {
    expect(issueIdentifierFromUrl('/issue/ENG-3')).toBe('ENG-3');
    expect(issueIdentifierFromUrl('/issue/ENG-3#comment-comment_9')).toBe('ENG-3');
    expect(issueIdentifierFromUrl('/issue/ENG-3?tab=activity')).toBe('ENG-3');
  });

  it('answers null for anything that is not an issue', () => {
    expect(issueIdentifierFromUrl('/docs/doc_1')).toBeNull();
    expect(issueIdentifierFromUrl('/team/eng/board')).toBeNull();
    expect(issueIdentifierFromUrl('')).toBeNull();
  });

  it('refuses a path that only looks like one rather than guessing', () => {
    expect(issueIdentifierFromUrl('/issue/not-an-identifier')).toBeNull();
    expect(issueIdentifierFromUrl('/issue/TOOLONGKEY-3')).toBeNull();
    expect(issueIdentifierFromUrl('/issues/ENG-3')).toBeNull();
  });

  it('survives an escape sequence that would break a naive decode', () => {
    expect(() => issueIdentifierFromUrl('/issue/%E0%A4%A')).not.toThrow();
    expect(issueIdentifierFromUrl('/issue/%E0%A4%A')).toBeNull();
  });
});
