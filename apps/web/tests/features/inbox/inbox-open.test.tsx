import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InboxItem } from '@/features/inbox/data.ts';
import { InboxView } from '@/features/inbox/inbox-view.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

interface ReadCall {
  readonly notificationIds: string[];
  readonly read: boolean;
}

let calls: ReadCall[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = mock((_url: string, init: { body?: string }) => {
    if (init.body !== undefined) calls.push(JSON.parse(init.body) as ReadCall);
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
    type: 'mention',
    entityType: 'issue',
    entityId: 'issue_1',
    actorName: 'Ada',
    title: 'Mentioned you in ENG-3',
    body: 'Take a look',
    url: '/issue/ENG-3#comment-comment_9',
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
        <InboxView items={items} unreadCount={1} unreadMentions={1} userId="user_1" />
      </HotkeyProvider>
    </QueryClientProvider>,
  );
}

describe('opening a notification', () => {
  it('marks it read when the row is opened', async () => {
    const user = userEvent.setup();
    renderInbox([item()]);

    await user.click(screen.getByRole('button', { name: /Mentioned you in ENG-3/ }));

    await waitFor(() => {
      expect(calls).toEqual([{ notificationIds: ['notification_1'], read: true }]);
    });
    expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('0 unread');
  });

  it('marks it read when the deep link is followed', async () => {
    const user = userEvent.setup();
    renderInbox([item({ read: false })]);
    calls = [];

    await user.click(screen.getByTestId('inbox-open-link'));

    await waitFor(() => {
      expect(calls.at(-1)).toEqual({ notificationIds: ['notification_1'], read: true });
    });
  });

  it('keeps the deep link fragment so the reader lands on the comment', () => {
    renderInbox([item()]);
    expect(screen.getByTestId('inbox-open-link')).toHaveAttribute(
      'href',
      '/issue/ENG-3#comment-comment_9',
    );
  });

  it('does not call the server again for a notification already read', async () => {
    const user = userEvent.setup();
    renderInbox([item({ read: true })]);

    await user.click(screen.getByTestId('inbox-open-link'));
    await user.click(screen.getByRole('button', { name: /Mentioned you in ENG-3/ }));

    expect(calls).toEqual([]);
  });
});

describe('opening a notification in the Unread tab', () => {
  it('keeps the row selected after it is marked read', async () => {
    const user = userEvent.setup();
    renderInbox([
      item({ id: 'notification_1', title: 'First', url: '/issue/ENG-1' }),
      item({ id: 'notification_2', title: 'Second', url: '/issue/ENG-2' }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Unread' }));
    await user.click(screen.getByRole('button', { name: /Second/ }));

    await waitFor(() => {
      expect(screen.getByTestId('inbox-open-link')).toHaveAttribute('href', '/issue/ENG-2');
    });
  });
});

describe('when the server rejects the read', () => {
  it('puts the row back and says so', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    ) as unknown as typeof fetch;
    const user = userEvent.setup();
    renderInbox([item()]);

    await user.click(screen.getByTestId('inbox-open-link'));

    await waitFor(() => {
      expect(screen.getByTestId('inbox-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('1 unread');
  });
});
