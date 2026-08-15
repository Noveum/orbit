import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { NOTIFICATION_TYPES, STATUS_CHANGE_NOTIFICATION_TYPES } from '@orbit/shared/constants';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InboxItem } from '@/features/inbox/data.ts';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';

const realtimeReact = { ...(await import('@orbit/realtime-client/react')) };
mock.module('@orbit/realtime-client/react', () => ({
  ...realtimeReact,
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

const issueDetail = { ...(await import('@/features/issues/issue-detail.tsx')) };
mock.module('@/features/issues/issue-detail.tsx', () => ({
  ...issueDetail,
  IssueDetailView: ({ identifier }: { identifier: string }) => (
    <div data-testid="issue-detail">{identifier}</div>
  ),
}));

afterAll(() => {
  mock.module('@/features/issues/issue-detail.tsx', () => issueDetail);
  mock.module('@orbit/realtime-client/react', () => realtimeReact);
});

const { InboxView } = await import('@/features/inbox/inbox-view.tsx');

const realFetch = globalThis.fetch;
let failWrite = false;

beforeEach(() => {
  failWrite = false;
  globalThis.fetch = mock(() =>
    failWrite
      ? Promise.reject(new Error('network down'))
      : Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ unreadCount: 0 }),
        }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'notification_1',
    type: 'comment_created',
    entityType: 'issue',
    entityId: 'issue_1',
    actorName: 'Ada',
    title: 'New comment on ENG-3',
    body: '',
    bodyHtml: '',
    url: '/issue/ENG-3',
    externalUrl: null,
    read: true,
    snoozedUntil: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderInbox(items: readonly InboxItem[], unreadActivity = 0, unreadMentions = 0) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HotkeyProvider>
        <InboxView
          items={items}
          unreadCount={0}
          unreadMentions={unreadMentions}
          unreadActivity={unreadActivity}
          userId="user_1"
          nextCursor={null}
          canWriteDocs
          canPublishDocs
        />
      </HotkeyProvider>
    </QueryClientProvider>,
  );
}

function rowTitles(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '')
    .filter((text) => text.length > 0);
}

const statusMove = item({
  id: 'notification_status',
  type: 'issue_status_changed',
  title: 'ENG-3 moved to In Progress',
});
const assignment = item({
  id: 'notification_assigned',
  type: 'issue_assigned',
  title: 'ENG-4 assigned to you',
});
const comment = item({ id: 'notification_comment', title: 'New comment on ENG-3' });

describe('the Activity tab', () => {
  it('is the tab the inbox opens on', () => {
    renderInbox([comment]);

    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('leaves status moves and assignments out', () => {
    renderInbox([statusMove, assignment, comment]);

    const titles = rowTitles();
    expect(titles.some((text) => text.includes('New comment on ENG-3'))).toBe(true);
    expect(titles.some((text) => text.includes('moved to In Progress'))).toBe(false);
    expect(titles.some((text) => text.includes('assigned to you'))).toBe(false);
  });
});

describe('the Status tab', () => {
  it('shows the status moves and assignments the Activity tab left out', async () => {
    const user = userEvent.setup();
    renderInbox([statusMove, assignment, comment]);

    await user.click(screen.getByRole('button', { name: 'Status' }));

    const titles = rowTitles();
    expect(titles.some((text) => text.includes('moved to In Progress'))).toBe(true);
    expect(titles.some((text) => text.includes('assigned to you'))).toBe(true);
    expect(titles.some((text) => text.includes('New comment on ENG-3'))).toBe(false);
  });

  it('holds every notification the Activity tab does not, and nothing more', async () => {
    const user = userEvent.setup();
    const everyType = NOTIFICATION_TYPES.map((type, index) =>
      item({ id: `notification_${index}`, type, title: `Notification ${index}` }),
    );
    renderInbox(everyType);

    const activityCount = rowTitles().length;
    await user.click(screen.getByRole('button', { name: 'Status' }));
    const statusCount = rowTitles().length;

    expect(statusCount).toBe(STATUS_CHANGE_NOTIFICATION_TYPES.length);
    expect(activityCount + statusCount).toBe(NOTIFICATION_TYPES.length);
  });
});

describe('the Activity unread count', () => {
  it('shows how many unread notifications are real activity', () => {
    renderInbox([comment], 12);

    expect(screen.getByTestId('inbox-activity-count')).toHaveTextContent('12');
  });

  it('stays hidden when no activity is unread', () => {
    renderInbox([comment], 0);

    expect(screen.queryByTestId('inbox-activity-count')).toBeNull();
  });

  it('drops when an unread notification is snoozed out of the counters', async () => {
    const user = userEvent.setup();
    renderInbox([item({ id: 'notification_unread', read: false })], 1);
    expect(screen.getByTestId('inbox-activity-count')).toHaveTextContent('1');

    await user.keyboard('h');

    await waitFor(() => {
      expect(screen.queryByTestId('inbox-activity-count')).toBeNull();
    });
  });

  it('drops only once when the same notification is snoozed again', async () => {
    const user = userEvent.setup();
    renderInbox(
      [
        item({ id: 'notification_a', read: false }),
        item({ id: 'notification_b', read: false, title: 'Second comment on ENG-3' }),
      ],
      2,
    );

    await user.keyboard('h');
    await user.keyboard('h');

    expect(screen.getByTestId('inbox-activity-count')).toHaveTextContent('1');
  });

  it('ignores a read toggle on a notification already snoozed out of the counters', async () => {
    const user = userEvent.setup();
    renderInbox(
      [
        item({ id: 'notification_a', read: false, snoozedUntil: '2999-01-01T00:00:00.000Z' }),
        item({ id: 'notification_b', read: false, title: 'Second comment on ENG-3' }),
      ],
      1,
    );

    await user.keyboard('u');

    expect(screen.getByTestId('inbox-activity-count')).toHaveTextContent('1');
  });
});

describe('a write the server rejects', () => {
  it('puts the activity count back when the snooze does not save', async () => {
    const user = userEvent.setup();
    renderInbox([item({ id: 'notification_unread', read: false })], 1);
    failWrite = true;

    await user.keyboard('h');

    await waitFor(() => {
      expect(screen.getByTestId('inbox-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('inbox-activity-count')).toHaveTextContent('1');
  });

  it('puts the row and the activity count back when the delete does not save', async () => {
    const user = userEvent.setup();
    renderInbox([item({ id: 'notification_unread', read: false })], 1);
    failWrite = true;

    await user.keyboard('{Backspace}');

    await waitFor(() => {
      expect(screen.getByTestId('inbox-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('inbox-activity-count')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /New comment on ENG-3/ })).toBeInTheDocument();
  });
});

describe('overlapping snoozes on one row', () => {
  it('sends a single request however fast the key is pressed', async () => {
    const user = userEvent.setup();
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    renderInbox([item({ id: 'notification_unread', read: false })], 1);

    await user.keyboard('h');
    await user.keyboard('h');

    expect(calls).toBe(1);
  });
});

describe('the empty state', () => {
  it('does not claim inbox zero when the notifications are all on another tab', () => {
    renderInbox([statusMove, assignment]);

    expect(screen.queryByText('Inbox zero')).toBeNull();
    expect(screen.getByText('Nothing on this tab')).toBeVisible();
  });

  it('still claims inbox zero when there is genuinely nothing', () => {
    renderInbox([]);

    expect(screen.getByText('Inbox zero')).toBeVisible();
  });
});

describe('the mention count', () => {
  it('drops when an unread mention is snoozed out of the counters', async () => {
    const user = userEvent.setup();
    renderInbox([item({ id: 'notification_mention', type: 'mention', read: false })], 1, 1);
    expect(screen.getByTestId('inbox-mention-count')).toHaveTextContent('1');

    await user.keyboard('h');

    await waitFor(() => {
      expect(screen.queryByTestId('inbox-mention-count')).toBeNull();
    });
  });
});
