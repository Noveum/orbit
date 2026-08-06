import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { buildDocAnchor } from '@orbit/shared/utils';
import type { DocCommentAnchor } from '@orbit/shared/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type RefObject, useMemo, useState } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { DocEditor } from '../../../src/features/docs/doc-editor.tsx';
import {
  DOC_ANCHOR_SETTLE_MS,
  type DocAnchorTarget,
  type DocCommenting,
} from '../../../src/features/docs/use-doc-anchors.ts';

const SOURCE = [
  '# Launch plan',
  '',
  'The launch is blocked on the migration.',
  '',
  'We meet on Thursday.',
].join('\n');

const PLAIN = 'Launch plan\nThe launch is blocked on the migration.\nWe meet on Thursday.';
const PASSAGE = 'blocked on the migration';

const originalFetch = globalThis.fetch;
const realScrollIntoView = Element.prototype.scrollIntoView;
const scrolled: string[] = [];

function anchorFor(quote: string): DocCommentAnchor {
  const at = PLAIN.indexOf(quote);
  return buildDocAnchor(PLAIN, at, at + quote.length);
}

interface Recorded {
  readonly selected: string[];
  readonly texts: string[];
  readonly edits: string[];
  readonly anchors: DocCommentAnchor[];
  readonly reveal: RefObject<((commentId: string) => void) | null>;
}

function record(): Recorded {
  return { selected: [], texts: [], edits: [], anchors: [], reveal: { current: null } };
}

function Harness({
  targets,
  recorded,
  focusedCommentId,
  wired,
}: {
  readonly targets: readonly DocAnchorTarget[];
  readonly recorded: Recorded;
  readonly focusedCommentId: string | null;
  readonly wired: boolean;
}) {
  const [content, setContent] = useState(SOURCE);
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
    [],
  );
  const commenting = useMemo<DocCommenting>(
    () => ({
      targets,
      focusedCommentId,
      onSelectPassage: (commentId) => recorded.selected.push(commentId),
      onTextChange: (text) => recorded.texts.push(text),
      onAnchorSelected: (anchor) => recorded.anchors.push(anchor),
      revealRef: recorded.reveal,
    }),
    [targets, focusedCommentId, recorded],
  );

  return (
    <ToastProvider>
      <TooltipProvider>
        <QueryClientProvider client={client}>
          <DocEditor
            docId="doc_1"
            content={content}
            onChange={(next) => {
              recorded.edits.push(next);
              setContent(next);
            }}
            onForceSave={() => undefined}
            {...(wired ? { commenting } : {})}
          />
        </QueryClientProvider>
      </TooltipProvider>
    </ToastProvider>
  );
}

async function mount(
  targets: readonly DocAnchorTarget[],
  options: { focusedCommentId?: string; wired?: boolean } = {},
): Promise<Recorded> {
  const recorded = record();
  render(
    <Harness
      targets={targets}
      recorded={recorded}
      focusedCommentId={options.focusedCommentId ?? null}
      wired={options.wired ?? true}
    />,
  );
  await screen.findByTestId('doc-rich-editor');
  await waitFor(() => {
    expect(surface().textContent).toContain(PASSAGE);
  });
  return recorded;
}

function marks(commentId: string): Element[] {
  return [...document.querySelectorAll(`[data-doc-comment-anchor="${commentId}"]`)];
}

function surface(): HTMLElement {
  const found = document.querySelector('.ProseMirror');
  if (!(found instanceof HTMLElement)) throw new Error('the editor surface never mounted');
  return found;
}

function settle(times = 2): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DOC_ANCHOR_SETTLE_MS * times));
}

async function selectEverything(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(surface());
  await user.keyboard('{Control>}a{/Control}');
}

beforeEach(() => {
  scrolled.length = 0;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value(this: Element) {
      scrolled.push(this.textContent ?? '');
    },
  });
  globalThis.fetch = mock(
    () =>
      new Promise<Response>(() => {
        return;
      }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value: realScrollIntoView,
  });
});

describe('a doc editor carrying anchored comments', () => {
  it('marks the passage of an anchored comment and nothing else', async () => {
    await mount([{ commentId: 'c_1', anchor: anchorFor(PASSAGE) }]);

    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));
    expect(
      marks('c_1')
        .map((node) => node.textContent)
        .join(''),
    ).toBe(PASSAGE);
    expect(document.querySelectorAll('[data-doc-comment-anchor]')).toHaveLength(
      marks('c_1').length,
    );
  });

  it('draws the passage of the focused comment as the active one', async () => {
    await mount([{ commentId: 'c_1', anchor: anchorFor(PASSAGE) }], { focusedCommentId: 'c_1' });

    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));
    expect(marks('c_1')[0]?.classList.contains('orbit-doc-anchor-active')).toBe(true);
  });

  it('marks nothing in a doc that was never wired for comments', async () => {
    await mount([{ commentId: 'c_1', anchor: anchorFor(PASSAGE) }], { wired: false });
    await settle();

    expect(document.querySelectorAll('[data-doc-comment-anchor]')).toHaveLength(0);
  });

  it('tells the thread which comment the reader clicked in the document', async () => {
    const recorded = await mount([{ commentId: 'c_1', anchor: anchorFor(PASSAGE) }]);
    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));

    const mark = marks('c_1')[0];
    expect(mark).toBeDefined();
    if (mark !== undefined) await userEvent.click(mark);

    expect(recorded.selected).toEqual(['c_1']);
  });

  it('scrolls the document to the passage the thread asked to reveal', async () => {
    const recorded = await mount([{ commentId: 'c_1', anchor: anchorFor(PASSAGE) }]);
    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));
    expect(recorded.reveal.current).not.toBeNull();
    scrolled.length = 0;

    act(() => recorded.reveal.current?.('c_1'));

    expect(scrolled.filter((text) => text.includes(PASSAGE)).length).toBeGreaterThan(0);
  });

  it('scrolls nowhere for a comment whose passage is not in the document', async () => {
    const recorded = await mount([{ commentId: 'c_1', anchor: anchorFor(PASSAGE) }]);
    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));
    scrolled.length = 0;

    act(() => recorded.reveal.current?.('c_absent'));

    expect(scrolled).toHaveLength(0);
  });

  it('seeds the composer with the passage when Comment is picked in the bubble', async () => {
    const recorded = await mount([]);
    const user = userEvent.setup();
    await selectEverything(user);

    const bubble = await screen.findByTestId('doc-rich-editor-bubble');
    const control = bubble.querySelector('[aria-label=Comment]');
    expect(control).not.toBeNull();
    if (control !== null) await user.click(control);

    expect(recorded.anchors).toHaveLength(1);
    expect(recorded.anchors[0]?.quote).toContain(PASSAGE);
  });

  it('reports the document text again after an edit, so an orphan can be spotted', async () => {
    const recorded = await mount([{ commentId: 'c_1', anchor: anchorFor(PASSAGE) }]);
    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));
    recorded.texts.length = 0;

    const user = userEvent.setup();
    await selectEverything(user);
    await user.keyboard('{Backspace}');
    await user.paste('Everything is fine now.');

    await waitFor(() => expect(recorded.texts.at(-1)).toContain('Everything is fine now.'));
    await waitFor(() => expect(marks('c_1')).toHaveLength(0));
  });

  it('never walks a document that carries no anchored comment', async () => {
    const recorded = await mount([]);
    await settle(2);
    recorded.texts.length = 0;
    recorded.edits.length = 0;

    const user = userEvent.setup();
    await user.click(surface());
    await user.paste('One more sentence.');
    await settle(3);

    expect(recorded.edits.length).toBeGreaterThan(0);
    expect(recorded.texts).toHaveLength(0);
  });

  it('walks the document once a burst of edits settles, not once per edit', async () => {
    const recorded = await mount([{ commentId: 'c_1', anchor: anchorFor(PASSAGE) }]);
    await waitFor(() => expect(marks('c_1').length).toBeGreaterThan(0));
    recorded.texts.length = 0;
    recorded.edits.length = 0;

    const user = userEvent.setup();
    await user.click(surface());
    for (const word of ['alpha ', 'bravo ', 'charlie ', 'delta ', 'echo ', 'foxtrot ']) {
      await user.paste(word);
    }
    await settle(3);

    expect(recorded.edits.length).toBeGreaterThanOrEqual(6);
    expect(recorded.texts.at(-1)).toContain('foxtrot');
    expect(recorded.texts.length).toBeLessThan(recorded.edits.length);
  });
});
