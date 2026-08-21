import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { render, screen, waitFor } from '@testing-library/react';
import type { Doc } from '@/lib/query/schemas.ts';
import { DocReader } from '../../../src/features/docs/doc-reader.tsx';

const MARKDOWN = ['## Intro', '', 'body', '', '## Rules', '', 'body', '', '## Checklist'].join(
  '\n',
);

const tops = new Map<string, number>();
type ObserverCallback = (entries: readonly unknown[]) => void;
const observers: ObserverCallback[] = [];
const realRect = Element.prototype.getBoundingClientRect;
const realObserver = globalThis.IntersectionObserver;

const doc: Doc = {
  id: 'doc_1',
  organizationId: 'org_1',
  collectionId: null,
  projectId: null,
  parentId: null,
  title: 'Delta protocol',
  slug: 'delta-protocol',
  kind: 'markdown',
  content: MARKDOWN,
  sortOrder: 0,
  visibility: 'workspace',
  publishToken: null,
  authorId: 'user_1',
  repoBinding: null,
  syncId: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

class StubObserver {
  constructor(private readonly callback: ObserverCallback) {
    observers.push(callback);
  }
  observe = mock();
  unobserve = mock();
  disconnect = () => {
    const at = observers.indexOf(this.callback);
    if (at !== -1) observers.splice(at, 1);
  };
  takeRecords = mock();
}

beforeEach(() => {
  tops.clear();
  observers.length = 0;
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: StubObserver,
  });
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    writable: true,
    configurable: true,
    value(this: Element) {
      const top = this.isConnected ? (tops.get(this.id) ?? 0) : 0;
      return { top, bottom: top + 24, left: 0, right: 0, width: 200, height: 24 } as DOMRect;
    },
  });
});

afterEach(() => {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    writable: true,
    configurable: true,
    value: realRect,
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: realObserver,
  });
});

function renderReader() {
  return render(
    <DocReader
      doc={doc}
      contentHtml={renderMarkdownWithHeadingIds(MARKDOWN)}
      attachments={[]}
      author={{ name: 'Pulkit', image: null }}
      followers={1}
      collectionName={null}
      projectName={null}
      backlinks={[{ id: 'doc_2', title: 'Sync engine launch plan' }]}
    />,
  );
}

function activeText(): string | null {
  return screen.getByTestId('doc-outline').querySelector('[aria-current]')?.textContent ?? null;
}

describe('doc outline scroll spy', () => {
  it('lists the headings the body rendered and starts on the first one', async () => {
    tops.set('intro', 200);
    tops.set('rules', 900);
    tops.set('checklist', 1600);
    renderReader();

    const outline = await screen.findByTestId('doc-outline');
    expect([...outline.querySelectorAll('a')].map((link) => link.textContent)).toEqual([
      'Intro',
      'Rules',
      'Checklist',
    ]);
    await waitFor(() => expect(activeText()).toBe('Intro'));
  });

  it('follows the reader down the page and never goes empty', async () => {
    tops.set('intro', 200);
    tops.set('rules', 900);
    tops.set('checklist', 1600);
    renderReader();
    await screen.findByTestId('doc-outline');
    await waitFor(() => expect(activeText()).toBe('Intro'));

    tops.set('intro', -700);
    tops.set('rules', 40);
    tops.set('checklist', 800);
    for (const notify of [...observers]) notify([]);
    await waitFor(() => expect(activeText()).toBe('Rules'));

    tops.set('rules', -600);
    tops.set('checklist', -10);
    for (const notify of [...observers]) notify([]);
    await waitFor(() => expect(activeText()).toBe('Checklist'));

    tops.set('intro', 500);
    tops.set('rules', 900);
    tops.set('checklist', 1600);
    for (const notify of [...observers]) notify([]);
    await waitFor(() => expect(activeText()).toBe('Intro'));
  });

  it('keeps the first heading active after the body re-renders its heading nodes', async () => {
    tops.set('intro', 200);
    tops.set('rules', 900);
    tops.set('checklist', 1600);
    renderReader();
    await screen.findByTestId('doc-outline');
    await waitFor(() => expect(activeText()).toBe('Intro'));

    const body = screen.getByTestId('doc-body');
    for (const heading of [...body.querySelectorAll('h1,h2,h3')]) {
      heading.replaceWith(heading.cloneNode(true));
    }
    for (const notify of [...observers]) notify([]);

    await waitFor(() => expect(activeText()).toBe('Intro'));
    expect(activeText()).not.toBe('Checklist');
  });

  it('points each outline link at the anchor the body actually rendered', async () => {
    tops.set('intro', 200);
    tops.set('rules', 900);
    tops.set('checklist', 1600);
    renderReader();
    await screen.findByTestId('doc-outline');

    const link = screen.getByTestId('doc-outline').querySelector('[data-heading="rules"]');
    expect(link?.getAttribute('href')).toBe('#rules');
    expect(screen.getByTestId('doc-body').querySelector('#rules')).not.toBeNull();
  });

  it('shows the docs that link here', async () => {
    renderReader();
    expect(await screen.findByTestId('doc-backlinks')).toHaveTextContent('Sync engine launch plan');
  });
});

describe('doc stats', () => {
  it('reports the size of the doc next to when it was last touched', async () => {
    render(
      <DocReader
        doc={{ ...doc, content: 'word '.repeat(660) }}
        contentHtml=""
        attachments={[]}
        author={{ name: 'Pulkit', image: null }}
        followers={1}
        collectionName={null}
        projectName={null}
      />,
    );

    expect((await screen.findByTestId('doc-stats')).textContent).toBe('660 words · 3 min read');
  });

  it('counts the words of the doc it was given, not the last one', async () => {
    render(
      <DocReader
        doc={{ ...doc, content: 'one two three' }}
        contentHtml=""
        attachments={[]}
        author={{ name: 'Pulkit', image: null }}
        followers={1}
        collectionName={null}
        projectName={null}
      />,
    );

    expect((await screen.findByTestId('doc-stats')).textContent).toBe('3 words · 1 min read');
  });
});
