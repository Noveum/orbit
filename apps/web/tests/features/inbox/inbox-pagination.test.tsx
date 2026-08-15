import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
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

function item(id: string, overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    type: 'comment_created',
    entityType: 'issue',
    entityId: 'issue_1',
    actorName: 'Ada',
    title: `Notification ${id}`,
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

function olderPage(ids: readonly string[], nextCursor: string | null) {
  return {
    notifications: ids.map((id) => ({
      id,
      type: 'comment_created',
      entityType: 'issue',
      entityId: 'issue_1',
      actorName: 'Ada',
      title: `Notification ${id}`,
      body: '',
      url: '/issue/ENG-3',
      read: true,
      snoozedUntil: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
    nextCursor,
  };
}

const realFetch = globalThis.fetch;
let requests: string[] = [];
let pages: Record<string, unknown> = {};
let failNext = false;
let failRead = false;

beforeEach(() => {
  requests = [];
  failNext = false;
  failRead = false;
  pages = { 'cursor-1': olderPage(['n51', 'n52'], null) };
  globalThis.fetch = mock((url: string) => {
    const path = String(url);
    requests.push(path);
    if (path.startsWith('/api/notifications?')) {
      if (failNext)
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      const cursor = new URL(path, 'http://localhost').searchParams.get('cursor') ?? '';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(pages[cursor] ?? olderPage([], null)),
      });
    }
    if (failRead) {
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
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

function renderInbox(items: readonly InboxItem[], nextCursor: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HotkeyProvider>
        <InboxView
          items={items}
          unreadCount={0}
          unreadMentions={0}
          unreadActivity={0}
          userId="user_1"
          nextCursor={nextCursor}
          canWriteDocs
          canPublishDocs
        />
      </HotkeyProvider>
    </QueryClientProvider>,
  );
}

describe('an inbox with more notifications than one page', () => {
  it('offers the older ones when the server said there are more', () => {
    renderInbox([item('n1')], 'cursor-1');
    expect(screen.getByTestId('inbox-load-more')).toBeInTheDocument();
  });

  it('says nothing when the first page was the whole inbox', () => {
    renderInbox([item('n1')], null);
    expect(screen.queryByTestId('inbox-load-more')).toBeNull();
  });

  it('appends the next page under the ones already read', async () => {
    const user = userEvent.setup();
    renderInbox([item('n1')], 'cursor-1');

    await user.click(screen.getByTestId('inbox-load-more'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Notification n51/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Notification n52/ })).toBeInTheDocument();

    const titles = screen
      .getAllByRole('button')
      .map((node) => node.textContent ?? '')
      .filter((text) => text.includes('Notification'));
    expect(titles[0]).toContain('Notification n1');
    expect(titles.at(-1)).toContain('Notification n52');
  });

  it('asks for the cursor the server handed back', async () => {
    const user = userEvent.setup();
    renderInbox([item('n1')], 'cursor-1');

    await user.click(screen.getByTestId('inbox-load-more'));

    await waitFor(() => {
      expect(requests.some((path) => path.includes('cursor=cursor-1'))).toBe(true);
    });
  });

  it('stops offering more once the last page comes back', async () => {
    const user = userEvent.setup();
    renderInbox([item('n1')], 'cursor-1');

    await user.click(screen.getByTestId('inbox-load-more'));

    await waitFor(() => {
      expect(screen.queryByTestId('inbox-load-more')).toBeNull();
    });
  });

  it('keeps paging while the server keeps handing back cursors', async () => {
    const user = userEvent.setup();
    pages = {
      'cursor-1': olderPage(['n51'], 'cursor-2'),
      'cursor-2': olderPage(['n101'], null),
    };
    renderInbox([item('n1')], 'cursor-1');

    await user.click(screen.getByTestId('inbox-load-more'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Notification n51/ })).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('inbox-load-more'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Notification n101/ })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('inbox-load-more')).toBeNull();
  });

  it('never lists the same notification twice when a page overlaps', async () => {
    const user = userEvent.setup();
    pages = { 'cursor-1': olderPage(['n1', 'n51'], null) };
    renderInbox([item('n1')], 'cursor-1');

    await user.click(screen.getByTestId('inbox-load-more'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Notification n51/ })).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: /Notification n1\b/ })).toHaveLength(1);
  });

  it('clears the complaint once a retry gets through', async () => {
    const user = userEvent.setup();
    failNext = true;
    renderInbox([item('n1')], 'cursor-1');

    await user.click(screen.getByTestId('inbox-load-more'));
    await waitFor(() => {
      expect(screen.getByTestId('inbox-paging-error')).toBeInTheDocument();
    });

    failNext = false;
    await user.click(screen.getByTestId('inbox-load-more'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Notification n51/ })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('inbox-paging-error')).toBeNull();
  });

  it('says so when the page cannot be fetched, and keeps the offer open', async () => {
    const user = userEvent.setup();
    failNext = true;
    renderInbox([item('n1')], 'cursor-1');

    await user.click(screen.getByTestId('inbox-load-more'));

    await waitFor(() => {
      expect(screen.getByTestId('inbox-paging-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('inbox-load-more')).toBeInTheDocument();
  });

  it('can still reach older pages when a filter matches nothing loaded yet', async () => {
    const user = userEvent.setup();
    pages = { 'cursor-1': olderPage(['n51'], null) };
    renderInbox([item('n1', { read: true })], 'cursor-1');

    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(screen.queryByRole('button', { name: /Notification n1/ })).toBeNull();

    const offer = screen.getByTestId('inbox-load-more');
    expect(offer).toBeInTheDocument();

    await user.click(offer);
    await waitFor(() => {
      expect(requests.some((path) => path.includes('cursor=cursor-1'))).toBe(true);
    });
  });

  it('shows the empty state only when there is nothing left to fetch', async () => {
    const user = userEvent.setup();
    renderInbox([item('n1', { read: true })], null);

    await user.click(screen.getByRole('button', { name: 'Unread' }));

    expect(screen.getByText('Nothing on this tab')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-load-more')).toBeNull();
  });

  it('leaves a failed save alone when a page loads, they are separate complaints', async () => {
    const user = userEvent.setup();
    renderInbox([item('n1', { read: false })], 'cursor-1');

    failRead = true;
    await user.click(screen.getByRole('button', { name: /Notification n1/ }));
    await waitFor(() => {
      expect(screen.getByTestId('inbox-error')).toBeInTheDocument();
    });

    failRead = false;
    await user.click(screen.getByTestId('inbox-load-more'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Notification n51/ })).toBeInTheDocument();
    });

    expect(screen.getByTestId('inbox-error')).toBeInTheDocument();
  });
});
