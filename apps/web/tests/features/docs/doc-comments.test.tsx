import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { buildDocAnchor } from '@orbit/shared/utils';
import type { DocCommentAnchor } from '@orbit/shared/validators';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useSyncExternalStore } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { DocComment, Member } from '@/lib/query/schemas.ts';
import { SessionProvider } from '@/lib/realtime/session.tsx';

let store: readonly DocComment[] = [];
const listeners = new Set<() => void>();

function setStore(next: readonly DocComment[]): void {
  store = next;
  for (const listener of listeners) listener();
}

const createMutate = mock(
  (input: { body: string; parentId: string | null; anchor?: DocCommentAnchor | null }) => {
    setStore([
      ...store,
      {
        comment: {
          id: `pending-${store.length}`,
          docId: 'doc_1',
          authorId: 'user_1',
          parentId: input.parentId,
          body: input.body,
          anchor: input.anchor ?? null,
          editedAt: null,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          deletedAt: null,
          syncId: 0,
        },
        bodyHtml: '',
      },
    ]);
  },
);

mock.module('@/lib/query/use-doc-comments.ts', () => ({
  useDocComments: () => ({
    data: useSyncExternalStore(
      (onChange: () => void) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
      () => store,
      () => store,
    ),
  }),
  useCreateDocComment: () => ({ mutate: createMutate, isPending: false }),
  useUpdateDocComment: () => ({ mutate: mock() }),
  useDeleteDocComment: () => ({ mutate: mock() }),
}));

const { DocComments } = await import('../../../src/features/docs/doc-comments.tsx');

const members: readonly Member[] = [
  { id: 'user_1', name: 'Ada', email: 'ada@orbit.test', image: null, handle: 'ada', role: 'admin' },
];

function docComment(
  id: string,
  body: string,
  parentId: string | null = null,
  anchor: DocCommentAnchor | null = null,
): DocComment {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    comment: {
      id,
      docId: 'doc_1',
      authorId: 'user_1',
      parentId,
      body,
      anchor,
      editedAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      syncId: 1,
    },
    bodyHtml: `<p>${body}</p>`,
  };
}

const docText = 'Launch plan\nThe launch is blocked on the migration.\nWe meet on Thursday.';
const passage = 'blocked on the migration';
const passageAnchor = buildDocAnchor(
  docText,
  docText.indexOf(passage),
  docText.indexOf(passage) + passage.length,
);

function wrap(node: ReactNode): ReactNode {
  return (
    <ToastProvider>
      <SessionProvider userId="user_1">{node}</SessionProvider>
    </ToastProvider>
  );
}

beforeEach(() => {
  setStore([]);
  createMutate.mockClear();
});

describe('DocComments', () => {
  it('renders the thread and nests a reply under its parent', () => {
    setStore([docComment('c_root', 'Root note'), docComment('c_reply', 'A reply', 'c_root')]);

    render(wrap(<DocComments docId="doc_1" members={members} />));

    expect(screen.getByText('Root note')).toBeInTheDocument();
    expect(screen.getByText('A reply')).toBeInTheDocument();

    const rootItem = screen.getByTestId('doc-comment-c_root').closest('li');
    expect(rootItem).not.toBeNull();
    if (rootItem !== null) {
      expect(within(rootItem).getByTestId('doc-comment-c_reply')).toBeInTheDocument();
    }
  });

  it('shows a posted comment optimistically through the create hook', () => {
    render(wrap(<DocComments docId="doc_1" members={members} />));
    expect(screen.getByTestId('doc-comment-composer')).toBeInTheDocument();

    act(() => createMutate({ body: 'Looks solid', parentId: null }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Looks solid')).toBeInTheDocument();
    expect(document.querySelector('[data-testid^="doc-comment-pending-"]')).not.toBeNull();
  });
});

describe('DocComments anchored to a passage', () => {
  it('quotes the passage for an anchored comment and leaves an old comment plain', () => {
    setStore([
      docComment('c_plain', 'About the whole page'),
      docComment('c_anchored', 'Which migration?', null, passageAnchor),
    ]);

    render(wrap(<DocComments docId="doc_1" members={members} anchorText={docText} />));

    expect(screen.getByTestId('doc-comment-quote-c_anchored')).toHaveTextContent(passage);
    expect(screen.queryByTestId('doc-comment-quote-c_plain')).toBeNull();
    expect(screen.getByText('About the whole page')).toBeInTheDocument();
  });

  it('keeps the quote and calls the comment orphaned once the passage is edited away', () => {
    setStore([docComment('c_anchored', 'Which migration?', null, passageAnchor)]);

    render(
      wrap(
        <DocComments
          docId="doc_1"
          members={members}
          anchorText={'Launch plan\nThe launch is on track.\nWe meet on Thursday.'}
        />,
      ),
    );

    expect(screen.getByTestId('doc-comment-quote-c_anchored')).toHaveTextContent(passage);
    expect(screen.getByTestId('doc-comment-orphan-c_anchored')).toBeInTheDocument();
    expect(screen.getByText('Which migration?')).toBeInTheDocument();
  });

  it('says nothing about orphaning while the document text is still unknown', () => {
    setStore([docComment('c_anchored', 'Which migration?', null, passageAnchor)]);

    render(wrap(<DocComments docId="doc_1" members={members} anchorText={null} />));

    expect(screen.queryByTestId('doc-comment-orphan-c_anchored')).toBeNull();
  });

  it('asks the surface to reveal the passage when the quote is clicked', async () => {
    const reveal = mock((_commentId: string) => undefined);
    setStore([docComment('c_anchored', 'Which migration?', null, passageAnchor)]);

    render(
      wrap(
        <DocComments
          docId="doc_1"
          members={members}
          anchorText={docText}
          onRevealPassage={reveal}
        />,
      ),
    );

    await userEvent.click(screen.getByTestId('doc-comment-quote-c_anchored'));

    expect(reveal).toHaveBeenCalledWith('c_anchored');
  });

  it('marks the comment whose passage the reader clicked in the document', () => {
    setStore([docComment('c_anchored', 'Which migration?', null, passageAnchor)]);

    render(
      wrap(
        <DocComments
          docId="doc_1"
          members={members}
          anchorText={docText}
          focusedCommentId="c_anchored"
        />,
      ),
    );

    expect(screen.getByTestId('doc-comment-c_anchored')).toHaveAttribute('data-focused', 'true');
  });

  it('shows the selected passage above the composer and posts it as the anchor', async () => {
    const change = mock((_anchor: DocCommentAnchor | null) => undefined);

    render(
      wrap(
        <DocComments
          docId="doc_1"
          members={members}
          anchorText={docText}
          pendingAnchor={passageAnchor}
          onPendingAnchorChange={change}
        />,
      ),
    );

    expect(screen.getByTestId('doc-comment-pending-anchor')).toHaveTextContent(passage);

    const user = userEvent.setup();
    const surface = screen.getByTestId('doc-comment-composer').querySelector('.ProseMirror');
    expect(surface).not.toBeNull();
    if (surface !== null) await user.click(surface as HTMLElement);
    await user.paste('Which migration?');
    await user.click(screen.getByTestId('doc-comment-composer-submit'));

    expect(createMutate).toHaveBeenCalledWith({
      body: 'Which migration?',
      parentId: null,
      anchor: passageAnchor,
    });
    expect(change).toHaveBeenCalledWith(null);
  });

  it('drops the pending passage when the reader dismisses it', async () => {
    const change = mock((_anchor: DocCommentAnchor | null) => undefined);

    render(
      wrap(
        <DocComments
          docId="doc_1"
          members={members}
          anchorText={docText}
          pendingAnchor={passageAnchor}
          onPendingAnchorChange={change}
        />,
      ),
    );

    await userEvent.click(screen.getByTestId('doc-comment-pending-anchor-clear'));

    expect(change).toHaveBeenCalledWith(null);
  });
});
