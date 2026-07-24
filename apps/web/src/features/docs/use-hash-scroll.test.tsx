import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { render, waitFor } from '@testing-library/react';
import type { Doc } from '@/lib/query/schemas.ts';
import { DocReader } from './doc-reader.tsx';
import { hashTargetId } from './use-hash-scroll.ts';

const MARKDOWN = ['## Intro', '', 'body', '', '## Rules', '', 'body', '', '## Checklist'].join(
  '\n',
);

const HEADING_TOP = new Map<string, number>([
  ['intro', 200],
  ['rules', 900],
  ['checklist', 1600],
]);

const doc: Doc = {
  id: 'doc_1',
  organizationId: 'org_1',
  collectionId: null,
  projectId: null,
  parentId: null,
  title: 'Delta protocol',
  slug: 'delta-protocol',
  content: MARKDOWN,
  visibility: 'workspace',
  publishToken: null,
  authorId: 'user_1',
  repoBinding: null,
  syncId: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

const scrolledTo: number[] = [];
const realRect = Element.prototype.getBoundingClientRect;
const realScrollTo = window.scrollTo;

beforeEach(() => {
  scrolledTo.length = 0;
  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    configurable: true,
    value: (options: ScrollToOptions) => {
      if (typeof options?.top === 'number') scrolledTo.push(options.top);
    },
  });
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    writable: true,
    configurable: true,
    value(this: Element) {
      const top = this.isConnected ? (HEADING_TOP.get(this.id) ?? 0) : 0;
      return { top, bottom: top + 24, left: 0, right: 0, width: 200, height: 24 } as DOMRect;
    },
  });
});

afterEach(() => {
  window.location.hash = '';
  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    configurable: true,
    value: realScrollTo,
  });
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    writable: true,
    configurable: true,
    value: realRect,
  });
});

function reader(which: Doc) {
  return (
    <DocReader
      doc={which}
      contentHtml={renderMarkdown(MARKDOWN)}
      attachments={[]}
      author={{ name: 'Pulkit', image: null }}
      followers={1}
      collectionName={null}
      projectName={null}
    />
  );
}

function renderReader() {
  return render(reader(doc));
}

describe('hash target id', () => {
  it('reads the id out of a hash and ignores empty hashes', () => {
    expect(hashTargetId('#rules')).toBe('rules');
    expect(hashTargetId('#delete%20me')).toBe('delete me');
    expect(hashTargetId('#')).toBeNull();
    expect(hashTargetId('')).toBeNull();
  });
});

describe('reader hash deep link', () => {
  it('scrolls the heading that matches the url hash into view on mount', async () => {
    window.location.hash = '#rules';
    renderReader();
    await waitFor(() => expect(scrolledTo).toContain(900 - 96));
  });

  it('does not scroll anywhere when there is no hash', async () => {
    window.location.hash = '';
    renderReader();
    await waitFor(() => expect(document.querySelector('#rules')).not.toBeNull());
    expect(scrolledTo).toHaveLength(0);
  });

  it('scrolls again after switching to another doc that shares the heading id', async () => {
    window.location.hash = '#rules';
    const view = render(reader(doc));
    await waitFor(() => expect(scrolledTo).toContain(900 - 96));

    scrolledTo.length = 0;
    view.rerender(reader({ ...doc, id: 'doc_2' }));
    await waitFor(() => expect(scrolledTo).toContain(900 - 96));
  });
});
