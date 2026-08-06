import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { render, waitFor } from '@testing-library/react';
import type { Doc } from '@/lib/query/schemas.ts';
import { DocReader } from '../../../src/features/docs/doc-reader.tsx';
import { hashTargetId } from '../../../src/features/docs/use-hash-scroll.ts';

const MARKDOWN = ['## Intro', '', 'body', '', '## Rules', '', 'body', '', '## Checklist'].join(
  '\n',
);

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

const scrolledIds: string[] = [];
const realScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrolledIds.length = 0;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value(this: Element) {
      scrolledIds.push(this.id);
    },
  });
});

afterEach(() => {
  window.location.hash = '';
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value: realScrollIntoView,
  });
});

function reader(which: Doc) {
  return (
    <DocReader
      doc={which}
      contentHtml={renderMarkdownWithHeadingIds(MARKDOWN)}
      attachments={[]}
      author={{ name: 'Pulkit', image: null }}
      followers={1}
      collectionName={null}
      projectName={null}
    />
  );
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
  it('brings the heading that matches the url hash into view on mount', async () => {
    window.location.hash = '#rules';
    render(reader(doc));
    await waitFor(() => expect(scrolledIds).toContain('rules'));
  });

  it('does not scroll anywhere when there is no hash', async () => {
    window.location.hash = '';
    render(reader(doc));
    await waitFor(() => expect(document.querySelector('#rules')).not.toBeNull());
    expect(scrolledIds).toHaveLength(0);
  });

  it('scrolls again after switching to another doc that shares the heading id', async () => {
    window.location.hash = '#rules';
    const view = render(reader(doc));
    await waitFor(() => expect(scrolledIds).toContain('rules'));

    scrolledIds.length = 0;
    view.rerender(reader({ ...doc, id: 'doc_2' }));
    await waitFor(() => expect(scrolledIds).toContain('rules'));
  });
});
