import { describe, expect, it } from 'bun:test';
import { act, render } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';
import { ancestorsOf, DocTree, docTreeOf } from './doc-tree.tsx';

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

describe('a folder that can be closed', () => {
  const nested: DocSummary[] = [
    summary('root', 'Handbook'),
    { ...summary('child', 'Onboarding'), parentId: 'root' },
    { ...summary('grandchild', 'Day one'), parentId: 'child' },
    summary('other', 'Runbook'),
  ];

  it('lays the whole tree out when nothing is collapsed', () => {
    const nodes = docTreeOf(nested);
    expect(nodes.map((node) => node.doc.id)).toEqual(['root', 'child', 'grandchild', 'other']);
    expect(nodes.map((node) => node.depth)).toEqual([0, 1, 2, 0]);
  });

  it('hides everything beneath a collapsed folder, and leaves siblings alone', () => {
    const nodes = docTreeOf(nested, new Set(['root']));
    expect(nodes.map((node) => node.doc.id)).toEqual(['root', 'other']);
  });

  it('collapses only the branch that was closed', () => {
    const nodes = docTreeOf(nested, new Set(['child']));
    expect(nodes.map((node) => node.doc.id)).toEqual(['root', 'child', 'other']);
  });

  it('reports how many children a row has, so only folders get a control', () => {
    const nodes = docTreeOf(nested);
    const counts = Object.fromEntries(nodes.map((node) => [node.doc.id, node.childCount]));
    expect(counts['root']).toBe(1);
    expect(counts['child']).toBe(1);
    expect(counts['grandchild']).toBe(0);
    expect(counts['other']).toBe(0);
  });

  it('names the chain above a doc, so opening one can reveal it', () => {
    expect(ancestorsOf(nested, 'grandchild')).toEqual(['child', 'root']);
    expect(ancestorsOf(nested, 'other')).toEqual([]);
  });
});
