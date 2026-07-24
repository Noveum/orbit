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

function scrollerOf(): HTMLElement {
  const scroller = document.querySelector<HTMLElement>('[data-testid="doc-tree-scroll"]');
  if (scroller === null) throw new Error('scroller not found');
  return scroller;
}

describe('doc tree scroller', () => {
  it('is a plain native overflow scroller, not a hijacked one', () => {
    render(tree([summary('d0', 'Doc 0')], []));
    expect(scrollerOf().className).toContain('overflow-y-auto');
    expect(document.querySelector('[data-radix-scroll-area-viewport]')).toBeNull();
  });

  it('leaves the scroll position alone when the docs data changes under the user', () => {
    const docsA = Array.from({ length: 40 }, (_, index) => summary(`d${index}`, `Doc ${index}`));
    const view = render(tree(docsA, []));

    const scroller = scrollerOf();
    act(() => {
      scroller.scrollTop = 250;
    });

    const docsB = [summary('dNew', 'Doc New'), ...docsA];
    act(() => {
      view.rerender(tree(docsB, []));
    });

    expect(scrollerOf().scrollTop).toBe(250);
  });
});
