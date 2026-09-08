import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { InboxItem } from '@/features/inbox/data.ts';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';

const realRealtime = { ...(await import('@orbit/realtime-client/react')) };
let receive: (actions: readonly SyncAction[]) => void = () => undefined;
let resume: () => void = () => undefined;
mock.module('@orbit/realtime-client/react', () => ({
  ...realRealtime,
  useScopeSubscription: () => undefined,
  useDeltaHandler: (handler: typeof receive) => {
    receive = handler;
  },
  useResumeHandler: (handler: typeof resume) => {
    resume = handler;
  },
}));
const { InboxView } = await import('@/features/inbox/inbox-view.tsx');
const nativeFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = nativeFetch;
});
afterAll(() => {
  mock.module('@orbit/realtime-client/react', () => realRealtime);
});

const privateRow: InboxItem = {
  id: 'private-notification',
  type: 'comment_created',
  entityType: '',
  entityId: '',
  actorName: 'Author',
  title: 'Private discussion',
  body: 'Previously authorized body',
  bodyHtml: '<p>Previously authorized body</p>',
  url: '/inbox',
  externalUrl: null,
  read: false,
  snoozedUntil: null,
  createdAt: '2026-09-01T12:00:00.000Z',
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HotkeyProvider>
        <InboxView
          items={[privateRow]}
          unreadCount={1}
          unreadMentions={0}
          unreadActivity={1}
          nextCursor={null}
          userId="reader"
          canWriteDocs={false}
          canPublishDocs={false}
        />
      </HotkeyProvider>
    </QueryClientProvider>,
  );
}
function packet(): SyncAction {
  return {
    syncId: 10,
    organizationId: 'workspace',
    scopes: ['user:reader'],
    action: 'insert',
    model: 'notification',
    modelId: privateRow.id,
    data: { ...privateRow, body: 'REVOKED_PRIVATE_BODY', bodyHtml: '<p>REVOKED_PRIVATE_BODY</p>' },
    actor: { type: 'user', id: 'author' },
    at: privateRow.createdAt,
  };
}
function page(rows: InboxItem[]) {
  return {
    notifications: rows,
    nextCursor: null,
    counters: { unreadCount: rows.length, unreadActivityCount: rows.length, unreadMentionCount: 0 },
  };
}

describe('legacy realtime privacy', () => {
  it('clears cached content before refetching and never renders a queued body packet', async () => {
    let complete: (value: Response) => void = () => undefined;
    globalThis.fetch = mock(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    ) as unknown as typeof fetch;
    mount();
    expect(screen.getByText('Previously authorized body')).toBeVisible();
    act(() => {
      receive([packet()]);
    });
    expect(screen.queryByText('Previously authorized body')).toBeNull();
    expect(screen.queryByText('REVOKED_PRIVATE_BODY')).toBeNull();
    await act(() => {
      complete(Response.json(page([])));
    });
    await waitFor(() => {
      expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('0 unread');
    });
    expect(screen.queryByText('Private discussion')).toBeNull();
  });

  it('rejects an in-flight authorized response invalidated by a later access revocation', async () => {
    const pending: ((value: Response) => void)[] = [];
    globalThis.fetch = mock(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    ) as unknown as typeof fetch;
    mount();
    act(() => {
      receive([packet()]);
    });
    act(() => {
      receive([
        {
          ...packet(),
          model: 'notification_conversation',
          data: { id: 'conversation', visible: false },
        },
      ]);
    });
    await act(() => {
      pending[0]?.(Response.json(page([privateRow])));
    });
    expect(screen.queryByText('Previously authorized body')).toBeNull();
    await act(() => {
      pending[1]?.(Response.json(page([])));
    });
    expect(screen.queryByText('Private discussion')).toBeNull();
  });

  it('refreshes authorized content and exact counters when the socket resumes', async () => {
    const allowed = {
      ...privateRow,
      id: 'allowed',
      title: 'Public discussion',
      body: 'Allowed update',
      bodyHtml: '<p>Allowed update</p>',
    };
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json(page([allowed]))),
    ) as unknown as typeof fetch;
    mount();
    act(() => {
      resume();
    });
    await waitFor(() => {
      expect(screen.getByText('Allowed update')).toBeVisible();
    });
    expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('1 unread');
    expect(screen.queryByText('Previously authorized body')).toBeNull();
  });
});
