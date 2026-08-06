import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { DocTree } from '@/features/docs/doc-tree.tsx';
import type { DocSummary } from '@/lib/query/schemas.ts';
import { resetSidebarDisclosure } from '@/lib/use-sidebar-disclosure.ts';

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarDisclosure();
});

afterEach(cleanup);

function summary(id: string, title: string, snippet = ''): DocSummary {
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
    excerpt: 'The head of the doc, which is not why it matched.',
    snippet,
    titleMatch: snippet.length === 0,
  };
}

function tree(docs: readonly DocSummary[], search: string) {
  return (
    <TooltipProvider>
      <DocTree
        docs={docs}
        collections={[]}
        activeDocId={null}
        unsavedDocId={null}
        search={search}
        onSearchChange={() => undefined}
        onCreateCollection={() => undefined}
        onRenameCollection={() => undefined}
        onDeleteCollection={() => undefined}
        canWrite
      />
    </TooltipProvider>
  );
}

describe('the doc tree while searching', () => {
  it('shows the matching passage under a body hit, not the head of the doc', () => {
    render(
      tree(
        [summary('body', 'Deploy runbook', '…waits on a quorum handshake before traffic moves.')],
        'quorum',
      ),
    );

    const snippet = screen.getByTestId('doc-snippet-body');
    expect(snippet.textContent).toContain('quorum handshake');
    expect(snippet.textContent).not.toContain('head of the doc');
  });

  it('marks the matched words inside the passage', () => {
    render(tree([summary('body', 'Deploy runbook', 'a quorum of two signs off')], 'quorum'));

    const marks = [...screen.getByTestId('doc-snippet-body').querySelectorAll('mark')];
    expect(marks.map((node) => node.textContent)).toEqual(['quorum']);
  });

  it('shows no passage for a title-only hit', () => {
    render(tree([summary('titled', 'Quorum notes')], 'quorum'));

    expect(screen.queryByTestId('doc-snippet-titled')).toBeNull();
    expect(screen.getByText('Quorum notes')).toBeTruthy();
  });

  it('keeps the server order instead of regrouping the hits into folders', () => {
    render(
      tree(
        [summary('titled', 'Quorum notes'), summary('body', 'Deploy runbook', 'a quorum of two')],
        'quorum',
      ),
    );

    const rows = [...document.querySelectorAll('[data-testid^="doc-row-"]')];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'doc-row-titled',
      'doc-row-body',
    ]);
    expect(screen.queryByTestId('doc-group-toggle-private')).toBeNull();
  });

  it('says so when a search matches nothing', () => {
    render(tree([], 'quorum'));

    expect(screen.getByTestId('doc-search-results').textContent).toContain('No matches');
  });

  it('goes back to the folder tree when the search box is cleared', () => {
    const view = render(tree([summary('titled', 'Quorum notes')], 'quorum'));
    expect(screen.queryByTestId('doc-group-toggle-private')).toBeNull();

    view.rerender(tree([summary('titled', 'Quorum notes')], ''));

    expect(screen.getByTestId('doc-group-toggle-private')).toBeTruthy();
    expect(screen.queryByTestId('doc-search-results')).toBeNull();
  });
});
