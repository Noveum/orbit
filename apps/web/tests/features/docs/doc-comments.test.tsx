import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { buildDocAnchor } from '@orbit/shared/utils';
import type { DocCommentAnchor } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { Member } from '@/lib/query/schemas.ts';
import { SessionProvider } from '@/lib/realtime/session.tsx';
import { DocComments } from '../../../src/features/docs/doc-comments.tsx';

const members: readonly Member[] = [
  { id: 'user_1', name: 'Ada', email: 'ada@orbit.test', image: null, handle: 'ada', role: 'admin' },
];

const docText = 'Launch plan\nThe launch is blocked on the migration.\nWe meet on Thursday.';
const passage = 'blocked on the migration';
const passageAnchor = buildDocAnchor(
  docText,
  docText.indexOf(passage),
  docText.indexOf(passage) + passage.length,
);

interface WireComment {
  readonly id: string;
  readonly body: string;
  readonly parentId: string | null;
  readonly anchor: DocCommentAnchor | null;
}

function wireComment({ id, body, parentId, anchor }: WireComment) {
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

function comment(
  id: string,
  body: string,
  parentId: string | null = null,
  anchor: DocCommentAnchor | null = null,
) {
  return wireComment({ id, body, parentId, anchor });
}

const originalFetch = globalThis.fetch;

const posted: { bodies: unknown[]; held: boolean } = { bodies: [], held: false };

function serve(listed: readonly ReturnType<typeof comment>[]): void {
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      posted.bodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (posted.held) return new Promise<Response>(() => undefined);
      return Promise.resolve(
        jsonResponse({ comment: comment('c_saved', 'Saved', null, null).comment, bodyHtml: '' }),
      );
    }
    if (url.includes('/comments')) {
      return Promise.resolve(jsonResponse({ comments: listed, nextCursor: null }));
    }
    return Promise.resolve(jsonResponse({}));
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function wrap(node: ReactNode): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <ToastProvider>
      <QueryClientProvider client={client}>
        <SessionProvider userId="user_1">{node}</SessionProvider>
      </QueryClientProvider>
    </ToastProvider>
  );
}

async function show(
  listed: readonly ReturnType<typeof comment>[],
  props: Partial<Parameters<typeof DocComments>[0]> = {},
): Promise<void> {
  serve(listed);
  render(wrap(<DocComments docId="doc_1" members={members} {...props} />));
  await screen.findByTestId('doc-comments');
  if (listed.length > 0) {
    const first = listed[0];
    if (first !== undefined) await screen.findByTestId(`doc-comment-${first.comment.id}`);
  }
}

async function writeAndSubmit(text: string): Promise<void> {
  const user = userEvent.setup();
  const surface = screen.getByTestId('doc-comment-composer').querySelector('.ProseMirror');
  expect(surface).not.toBeNull();
  if (surface instanceof HTMLElement) await user.click(surface);
  await user.paste(text);
  await user.click(screen.getByTestId('doc-comment-composer-submit'));
}

beforeEach(() => {
  posted.bodies.length = 0;
  posted.held = false;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('DocComments', () => {
  it('renders the thread and nests a reply under its parent', async () => {
    await show([comment('c_root', 'Root note'), comment('c_reply', 'A reply', 'c_root')]);

    expect(screen.getByText('Root note')).toBeInTheDocument();
    expect(screen.getByText('A reply')).toBeInTheDocument();

    const rootItem = screen.getByTestId('doc-comment-c_root').closest('li');
    expect(rootItem).not.toBeNull();
    if (rootItem !== null) {
      expect(within(rootItem).getByTestId('doc-comment-c_reply')).toBeInTheDocument();
    }
  });

  it('shows a posted comment before the server answers', async () => {
    posted.held = true;
    await show([]);

    await writeAndSubmit('Looks solid');

    await waitFor(() => expect(screen.getByText('Looks solid')).toBeInTheDocument());
    expect(document.querySelector('[data-testid^="doc-comment-pending-"]')).not.toBeNull();
    expect(posted.bodies).toHaveLength(1);
  });
});

describe('DocComments anchored to a passage', () => {
  it('reads the anchor off the wire and quotes it, leaving an old comment plain', async () => {
    await show(
      [
        comment('c_plain', 'About the whole page'),
        comment('c_anchored', 'Which migration?', null, passageAnchor),
      ],
      { anchorText: docText, onRevealPassage: () => undefined },
    );

    expect(screen.getByTestId('doc-comment-quote-c_anchored')).toHaveTextContent(passage);
    expect(screen.queryByTestId('doc-comment-quote-c_plain')).toBeNull();
    expect(screen.getByText('About the whole page')).toBeInTheDocument();
  });

  it('keeps the quote and calls the comment orphaned once the passage is edited away', async () => {
    await show([comment('c_anchored', 'Which migration?', null, passageAnchor)], {
      anchorText: 'Launch plan\nThe launch is on track.\nWe meet on Thursday.',
      onRevealPassage: () => undefined,
    });

    expect(screen.getByTestId('doc-comment-quote-c_anchored')).toHaveTextContent(passage);
    expect(screen.getByTestId('doc-comment-orphan-c_anchored')).toBeInTheDocument();
    expect(screen.getByTestId('doc-comment-quote-c_anchored')).toBeDisabled();
  });

  it('says nothing about orphaning while the document text is still unknown', async () => {
    await show([comment('c_anchored', 'Which migration?', null, passageAnchor)], {
      anchorText: null,
      onRevealPassage: () => undefined,
    });

    expect(screen.queryByTestId('doc-comment-orphan-c_anchored')).toBeNull();
    expect(screen.getByTestId('doc-comment-quote-c_anchored')).not.toBeDisabled();
  });

  it('asks the surface to reveal the passage when the quote is clicked', async () => {
    const reveal = mock((_commentId: string) => undefined);
    await show([comment('c_anchored', 'Which migration?', null, passageAnchor)], {
      anchorText: docText,
      onRevealPassage: reveal,
    });

    await userEvent.click(screen.getByTestId('doc-comment-quote-c_anchored'));

    expect(reveal).toHaveBeenCalledWith('c_anchored');
  });

  it('offers no way to travel to a passage the surface cannot reveal', async () => {
    await show([comment('c_anchored', 'Which migration?', null, passageAnchor)], {
      anchorText: docText,
    });

    const quote = screen.getByTestId('doc-comment-quote-c_anchored');
    expect(quote).toHaveTextContent(passage);
    expect(quote).toBeDisabled();
    expect(quote).toHaveAttribute('aria-label', 'The quoted passage');
  });

  it('marks the comment whose passage the reader clicked in the document', async () => {
    await show([comment('c_anchored', 'Which migration?', null, passageAnchor)], {
      anchorText: docText,
      focusedCommentId: 'c_anchored',
      onRevealPassage: () => undefined,
    });

    expect(screen.getByTestId('doc-comment-c_anchored')).toHaveAttribute('data-focused', 'true');
  });

  it('shows the selected passage above the composer and posts it as the anchor', async () => {
    const change = mock((_anchor: DocCommentAnchor | null) => undefined);
    await show([], {
      anchorText: docText,
      pendingAnchor: passageAnchor,
      onPendingAnchorChange: change,
    });

    expect(screen.getByTestId('doc-comment-pending-anchor')).toHaveTextContent(passage);

    await writeAndSubmit('Which migration?');

    await waitFor(() => expect(posted.bodies).toHaveLength(1));
    expect(posted.bodies[0]).toEqual({
      body: 'Which migration?',
      parentId: null,
      anchor: passageAnchor,
    });
    expect(change).toHaveBeenCalledWith(null);
  });

  it('quotes the passage on the comment it shows before the server answers', async () => {
    posted.held = true;
    await show([], {
      anchorText: docText,
      pendingAnchor: passageAnchor,
      onPendingAnchorChange: () => undefined,
      onRevealPassage: () => undefined,
    });

    await writeAndSubmit('Which migration?');

    await waitFor(() => expect(screen.getByText('Which migration?')).toBeInTheDocument());
    const optimistic = document.querySelector('[data-testid^="doc-comment-quote-pending-"]');
    expect(optimistic).not.toBeNull();
    expect(optimistic).toHaveTextContent(passage);
  });

  it('drops the pending passage when the reader dismisses it', async () => {
    const change = mock((_anchor: DocCommentAnchor | null) => undefined);
    await show([], {
      anchorText: docText,
      pendingAnchor: passageAnchor,
      onPendingAnchorChange: change,
    });

    await userEvent.click(screen.getByTestId('doc-comment-pending-anchor-clear'));

    expect(change).toHaveBeenCalledWith(null);
  });
});
