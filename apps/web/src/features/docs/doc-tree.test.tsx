import { describe, expect, it } from 'bun:test';
import { act, render } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';
import { DocTree } from './doc-tree.tsx';

function summary(id: string, title: string): DocSummary {
  return {
    id,
    organizationId: 'org_1',
    collectionId: null,
    projectId: null,
    parentId: null,
    title,
    slug: id,
    content: '',
    visibility: 'workspace',
    publishToken: null,
    authorId: 'user_1',
    repoBinding: null,
    syncId: 1,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    archivedAt: null,
    excerpt: '',
  };
}

function tree(docs: readonly DocSummary[], collections: readonly DocCollection[]) {
  return (
    <TooltipProvider>
      <DocTree
        docs={docs}
        collections={collections}
        activeDocId={docs[0]?.id ?? null}
        unsavedDocId={null}
        search=""
        onSearchChange={() => undefined}
        onCreateCollection={() => undefined}
        onRenameCollection={() => undefined}
        onDeleteCollection={() => undefined}
        canWrite
      />
    </TooltipProvider>
  );
}

function viewportOf(): HTMLElement {
  const viewport = document.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
  if (viewport === null) throw new Error('viewport not found');
  return viewport;
}

describe('doc tree scroll preservation', () => {
  it('keeps the scroll position when the docs data changes under the user', () => {
    const docsA = Array.from({ length: 40 }, (_, index) => summary(`d${index}`, `Doc ${index}`));
    const view = render(tree(docsA, []));

    const viewport = viewportOf();
    act(() => {
      viewport.scrollTop = 250;
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(viewport.scrollTop).toBe(250);

    viewport.scrollTop = 0;
    const docsB = [summary('dNew', 'Doc New'), ...docsA];
    act(() => {
      view.rerender(tree(docsB, []));
    });

    expect(viewportOf().scrollTop).toBe(250);
  });

  it('does not move the scroll on a re-render that keeps the same docs', () => {
    const docs = Array.from({ length: 40 }, (_, index) => summary(`d${index}`, `Doc ${index}`));
    const view = render(tree(docs, []));

    const viewport = viewportOf();
    act(() => {
      viewport.scrollTop = 180;
      viewport.dispatchEvent(new Event('scroll'));
    });

    act(() => {
      view.rerender(tree(docs.slice(), []));
    });

    expect(viewportOf().scrollTop).toBe(180);
  });
});
