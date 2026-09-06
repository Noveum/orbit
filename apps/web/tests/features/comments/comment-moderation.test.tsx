import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { OrgRole } from '@orbit/shared/constants';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import type { Comment, Member } from '@/lib/query/schemas.ts';
import { SessionProvider } from '@/lib/realtime/session.tsx';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile([
  '@/features/issues/workspace-provider.tsx',
  '@/features/docs/editor/rich-text-editor.tsx',
]);

const realUseWorkspace = workspaceProvider.useWorkspace;
let role: OrgRole = 'guest';

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => ({ ...realUseWorkspace(), role }),
}));
mock.module('@/features/docs/editor/rich-text-editor.tsx', () => ({
  RichTextEditor: ({ testId }: { testId?: string }) => <div data-testid={testId} />,
}));

const { CommentThread } = await import('@/features/comments/comment-thread.tsx');

const members: readonly Member[] = [
  {
    id: 'user_1',
    name: 'Ada Admin',
    email: 'ada@orbit.test',
    image: null,
    handle: 'ada',
    role: 'admin',
  },
  {
    id: 'user_2',
    name: 'Aditi Rao',
    email: 'aditi@orbit.test',
    image: null,
    handle: 'aditi',
    role: 'member',
  },
];

function comment(id: string, authorId: string): Comment {
  return {
    comment: {
      id,
      issueId: 'issue_1',
      authorId,
      parentId: null,
      body: 'A note',
      editedAt: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: null,
      syncId: 2,
    },
    bodyHtml: '<p>A note</p>',
    reactions: [],
  };
}

function show(entry: Comment) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionProvider userId="user_1">
          <CommentThread
            issueId="issue_1"
            comments={[entry]}
            activity={[]}
            members={members}
            focusCommentId={null}
          />
        </SessionProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return within(screen.getByTestId(`comment-${entry.comment.id}`));
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  role = 'guest';
  globalThis.fetch = originalFetch;
});

describe('deleting a comment somebody else wrote', () => {
  it('is offered to a member, without the edit that stays with the author', () => {
    role = 'member';
    const item = show(comment('c_1', 'user_2'));
    expect(item.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(item.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('is offered to an admin', () => {
    role = 'admin';
    const item = show(comment('c_1', 'user_2'));
    expect(item.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(item.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('is withheld from a guest and a contributor', () => {
    role = 'contributor';
    const item = show(comment('c_1', 'user_2'));
    expect(item.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(item.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('never takes edit and delete away from the author, whatever the role', () => {
    role = 'guest';
    const item = show(comment('c_1', 'user_1'));
    expect(item.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(item.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('sends the delete of somebody else comment to the server', async () => {
    role = 'admin';
    const requests: { url: string; method: string }[] = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET' });
      return Promise.resolve(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    const item = show(comment('c_1', 'user_2'));

    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(item.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(requests).toContainEqual({ url: '/api/comments/c_1', method: 'DELETE' }),
    );
  });
});
