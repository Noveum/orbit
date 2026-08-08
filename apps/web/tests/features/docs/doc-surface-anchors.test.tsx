import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { buildDocAnchor } from '@orbit/shared/utils';
import type { DocCommentAnchor } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { SessionProvider } from '@/lib/realtime/session.tsx';
import {
  DOC_PREFERENCES_STORAGE_KEY,
  resetDocPreferences,
} from '../../../src/features/docs/use-doc-preferences.ts';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/docs/doc_1',
  useSearchParams: () => new URLSearchParams(''),
}));

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
}));

const { DocSurface } = await import('../../../src/features/docs/doc-surface.tsx');

const MARKDOWN = [
  '# Launch plan',
  '',
  'The launch is blocked on the migration.',
  '',
  'We meet on Thursday.',
].join('\n');

const PLAIN = 'Launch plan\nThe launch is blocked on the migration.\nWe meet on Thursday.';
const PASSAGE = 'blocked on the migration';
const GONE = 'We meet on Thursday.';

const originalFetch = globalThis.fetch;
const realScrollIntoView = Element.prototype.scrollIntoView;
const scrolled: string[] = [];

function anchorFor(quote: string): DocCommentAnchor {
  const at = PLAIN.indexOf(quote);
  return buildDocAnchor(PLAIN, at, at + quote.length);
}

const doc = {
  id: 'doc_1',
  organizationId: 'org_1',
  collectionId: null,
  projectId: null,
  parentId: null,
  title: 'Launch plan',
  slug: 'launch-plan',
  content: MARKDOWN,
  sortOrder: 0,
  visibility: 'workspace',
  publishToken: null,
  authorId: 'user_1',
  repoBinding: null,
  syncId: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

function commentPayload(anchor: DocCommentAnchor | null) {
  return {
    comments: [
      {
        comment: {
          id: 'c_1',
          docId: 'doc_1',
          authorId: 'user_1',
          parentId: null,
          body: 'Which migration?',
          anchor,
          editedAt: null,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          deletedAt: null,
          syncId: 5,
        },
        bodyHtml: '<p>Which migration?</p>',
      },
    ],
    nextCursor: null,
  };
}

function stubFetch(anchor: DocCommentAnchor | null, access: 'read' | 'write'): void {
  globalThis.fetch = mock((input: string | URL | Request) => {
    const url = String(input);
    const body = (() => {
      if (url.includes('/comments')) return commentPayload(anchor);
      if (url.startsWith('/api/docs/doc_1')) {
        return {
          doc,
          contentHtml: '<h1>Launch plan</h1><p>The launch is blocked on the migration.</p>',
          attachments: [],
          author: { id: 'user_1', name: 'Ada', image: null },
          followers: 1,
          backlinks: [],
          access,
        };
      }
      if (url.startsWith('/api/docs')) {
        return {
          docs: [{ ...doc, excerpt: '', snippet: '', titleMatch: false }],
          collections: [],
          projects: [],
        };
      }
      return {};
    })();
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
}

function wrap(node: ReactNode): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <ToastProvider>
      <TooltipProvider>
        <QueryClientProvider client={client}>
          <SessionProvider userId="user_1">{node}</SessionProvider>
        </QueryClientProvider>
      </TooltipProvider>
    </ToastProvider>
  );
}

function marks(commentId: string): Element[] {
  return [...document.querySelectorAll(`[data-doc-comment-anchor="${commentId}"]`)];
}

async function open(canWrite: boolean, anchor: DocCommentAnchor | null) {
  stubFetch(anchor, canWrite ? 'write' : 'read');
  render(wrap(<DocSurface docId="doc_1" canWriteDocs={canWrite} canPublish={false} />));
  await screen.findByTestId('doc-comments');
}

beforeEach(() => {
  window.localStorage.setItem(
    DOC_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ mode: 'rich', toolbar: true, width: 'wide' }),
  );
  resetDocPreferences();
  scrolled.length = 0;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value(this: Element) {
      scrolled.push(this.textContent ?? '');
    },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value: realScrollIntoView,
  });
});

describe('a doc opened with an anchored comment on it', () => {
  it('carries the anchor off the wire into a highlight in the editor', async () => {
    await open(true, anchorFor(PASSAGE));

    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));
    expect(
      marks('c_1')
        .map((node) => node.textContent)
        .join(''),
    ).toBe(PASSAGE);
    expect(screen.getByTestId('doc-comment-quote-c_1')).toHaveTextContent(PASSAGE);
  });

  it('scrolls the document to the passage when the quote in the thread is clicked', async () => {
    await open(true, anchorFor(PASSAGE));
    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));
    scrolled.length = 0;

    await userEvent.click(screen.getByTestId('doc-comment-quote-c_1'));

    expect(scrolled.filter((text) => text.includes(PASSAGE)).length).toBeGreaterThan(0);
  });

  it('marks the comment in the thread when its passage is clicked in the document', async () => {
    await open(true, anchorFor(PASSAGE));
    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));

    const mark = marks('c_1')[0];
    expect(mark).toBeDefined();
    if (mark !== undefined) await userEvent.click(mark);

    await waitFor(() =>
      expect(screen.getByTestId('doc-comment-c_1')).toHaveAttribute('data-focused', 'true'),
    );
  });

  it('calls the comment orphaned once the editor no longer holds its passage', async () => {
    await open(true, {
      quote: 'a sentence that was struck from this page',
      prefix: '',
      suffix: '',
      start: 12,
    });

    await waitFor(() => expect(screen.getByTestId('doc-comment-orphan-c_1')).toBeInTheDocument());
    expect(screen.getByTestId('doc-comment-quote-c_1')).toBeDisabled();
  });

  it('offers Comment over a selection and seeds the composer with the passage', async () => {
    await open(true, null);
    const surface = document.querySelector('.ProseMirror');
    expect(surface).not.toBeNull();
    if (!(surface instanceof HTMLElement)) return;

    const user = userEvent.setup();
    await user.click(surface);
    await user.keyboard('{Control>}a{/Control}');

    const bubble = await screen.findByTestId('doc-rich-editor-bubble');
    const control = bubble.querySelector('[aria-label=Comment]');
    expect(control).not.toBeNull();
    if (control !== null) await user.click(control);

    await waitFor(() =>
      expect(screen.getByTestId('doc-comment-pending-anchor')).toHaveTextContent(PASSAGE),
    );
  });

  it('leaves the quote inert in a doc the reader cannot edit', async () => {
    await open(false, anchorFor(GONE));

    const quote = await screen.findByTestId('doc-comment-quote-c_1');
    expect(quote).toHaveTextContent(GONE);
    expect(quote).toBeDisabled();
    expect(quote).toHaveAttribute('aria-label', 'The quoted passage');
    expect(screen.queryByTestId('doc-editor')).toBeNull();
  });
});
