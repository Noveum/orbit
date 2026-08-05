import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, render, screen, within } from '@testing-library/react';
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

const createMutate = mock((input: { body: string; parentId: string | null }) => {
  setStore([
    ...store,
    {
      comment: {
        id: `pending-${store.length}`,
        docId: 'doc_1',
        authorId: 'user_1',
        parentId: input.parentId,
        body: input.body,
        editedAt: null,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
        syncId: 0,
      },
      bodyHtml: '',
    },
  ]);
});

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

function docComment(id: string, body: string, parentId: string | null = null): DocComment {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    comment: {
      id,
      docId: 'doc_1',
      authorId: 'user_1',
      parentId,
      body,
      editedAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      syncId: 1,
    },
    bodyHtml: `<p>${body}</p>`,
  };
}

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
