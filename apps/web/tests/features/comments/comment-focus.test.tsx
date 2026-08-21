import { afterAll, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { Comment, Member } from '@/lib/query/schemas.ts';

const STUBBED = {
  '@/features/docs/editor/rich-text-editor.tsx': {
    RichTextEditor: ({ testId }: { testId?: string }) => <div data-testid={testId} />,
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
});

const { CommentThread, landOnFocusedComment } = await import(
  '@/features/comments/comment-thread.tsx'
);

const members: readonly Member[] = [
  {
    id: 'user_2',
    name: 'Aditi Rao',
    email: 'aditi@noveum.ai',
    image: null,
    handle: 'aditi',
    role: 'member',
  },
];

function comment(id: string, body: string): Comment {
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

function renderThread(comments: readonly Comment[], focusCommentId: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CommentThread
          issueId="issue_1"
          comments={comments}
          activity={[]}
          members={members}
          focusCommentId={focusCommentId}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('the comment a notification was opened for', () => {
  it('lands on it once the thread has mounted', () => {
    const scrollIntoView = mock(() => undefined);
    const targetById = mock((id: string) =>
      id === 'comment-comment_9' ? { scrollIntoView } : null,
    );

    const landed = landOnFocusedComment('comment_9', null, targetById);

    expect(landed).toBe('comment_9');
    expect(targetById).toHaveBeenCalledWith('comment-comment_9');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('stays put when a later comment arrives, rather than yanking the reader back', () => {
    const targetById = mock(() => ({ scrollIntoView: mock(() => undefined) }));

    const landed = landOnFocusedComment('comment_9', 'comment_9', targetById);

    expect(landed).toBe('comment_9');
    expect(targetById).not.toHaveBeenCalled();
  });

  it('waits for the focused comment to mount', () => {
    const missingTarget = mock(() => null);
    const scrollIntoView = mock(() => undefined);

    const waiting = landOnFocusedComment('comment_9', null, missingTarget);
    const landed = landOnFocusedComment('comment_9', waiting, () => ({ scrollIntoView }));

    expect(waiting).toBeNull();
    expect(landed).toBe('comment_9');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does not scroll at all when no comment was singled out', async () => {
    renderThread([comment('comment_8', 'Earlier')], null);

    await screen.findByTestId('comment-comment_8');
  });
});
