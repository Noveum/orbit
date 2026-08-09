import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { DocRowActions } from '@/features/docs/doc-row-menu.tsx';
import { DocTree } from '@/features/docs/doc-tree.tsx';
import {
  collapsibleKeys,
  docDisclosureKey,
  groupDisclosureKey,
} from '@/features/docs/doc-tree-model.ts';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';
import { resetSidebarDisclosure } from '@/lib/use-sidebar-disclosure.ts';

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarDisclosure();
});

afterEach(cleanup);

function summary(id: string, title: string, overrides: Partial<DocSummary> = {}): DocSummary {
  return {
    id,
    organizationId: 'org',
    collectionId: null,
    projectId: null,
    parentId: null,
    title,
    slug: id,
    content: '',
    sortOrder: 0,
    visibility: 'workspace',
    publishToken: null,
    authorId: 'user',
    repoBinding: null,
    syncId: 1,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    archivedAt: null,
    excerpt: '',
    snippet: '',
    titleMatch: false,
    rank: 0,
    ...overrides,
  } as DocSummary;
}

function collection(id: string, name: string): DocCollection {
  return {
    id,
    organizationId: 'org',
    name,
    icon: 'book',
    position: 0,
    syncId: 1,
    createdAt: '2020-01-01T00:00:00.000Z',
  } as DocCollection;
}

function noopActions(overrides: Partial<DocRowActions> = {}): DocRowActions {
  return {
    canDelete: () => true,
    onRename: () => undefined,
    onMove: () => undefined,
    onDuplicate: () => undefined,
    onCopyLink: () => undefined,
    onArchive: () => undefined,
    onDelete: () => undefined,
    ...overrides,
  };
}

function tree(
  docs: readonly DocSummary[],
  collections: readonly DocCollection[],
  actions?: DocRowActions,
  onRenameDoc?: (docId: string, title: string) => void,
) {
  return (
    <TooltipProvider>
      <DocTree
        docs={docs}
        collections={collections}
        activeDocId={null}
        unsavedDocId={null}
        search=""
        searching={false}
        onSearchChange={() => undefined}
        onCreateCollection={() => undefined}
        onRenameCollection={() => undefined}
        onDeleteCollection={() => undefined}
        onCreateDoc={() => undefined}
        onMoveDoc={() => undefined}
        canWrite
        {...(actions === undefined ? {} : { actions })}
        {...(onRenameDoc === undefined ? {} : { onRenameDoc })}
      />
    </TooltipProvider>
  );
}

describe('folders in the doc tree', () => {
  it('renders a folder as a folder, never as an openable page', () => {
    render(tree([summary('a', 'Spec', { collectionId: 'specs' })], [collection('specs', 'Specs')]));

    const folder = screen.getByTestId('doc-folder-specs');
    expect(folder.textContent).toContain('Specs');
    expect(screen.queryByTestId('doc-row-specs')).toBeNull();
    expect(folder.querySelector('a[href="/docs/specs"]')).toBeNull();
  });

  it('counts the docs filed in each folder', () => {
    render(
      tree(
        [
          summary('a', 'One', { collectionId: 'specs' }),
          summary('b', 'Two', { collectionId: 'specs' }),
          summary('c', 'Loose'),
        ],
        [collection('specs', 'Specs')],
      ),
    );

    expect(screen.getByTestId('doc-group-toggle-specs').textContent).toContain('2');
    expect(screen.getByTestId('doc-group-toggle-private').textContent).toContain('1');
  });

  it('says a folder is empty rather than leaving it blank', () => {
    render(tree([], [collection('specs', 'Specs')]));

    expect(screen.getByTestId('doc-folder-specs').textContent).toContain('Nothing here yet');
  });
});

describe('the row menu', () => {
  it('moves a doc into a folder from the menu', async () => {
    const onMove = mock();
    const user = userEvent.setup();
    render(
      tree([summary('a', 'Loose page')], [collection('specs', 'Specs')], noopActions({ onMove })),
    );

    await user.click(screen.getByTestId('doc-row-menu-a'));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}');
    await screen.findByTestId('doc-move-to-specs');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]?.[1]).toBe('specs');
  });

  it('archives from the row', async () => {
    const onArchive = mock();
    const user = userEvent.setup();
    render(tree([summary('a', 'Loose page')], [], noopActions({ onArchive })));

    await user.click(screen.getByTestId('doc-row-menu-a'));
    await user.click(screen.getByTestId('doc-archive-row'));

    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('hides delete from someone who may not delete the doc', async () => {
    const user = userEvent.setup();
    render(tree([summary('a', 'Loose page')], [], noopActions({ canDelete: () => false })));

    await user.click(screen.getByTestId('doc-row-menu-a'));

    expect(screen.queryByTestId('doc-delete-row')).toBeNull();
  });

  it('renames in place and reports the new title', async () => {
    const onRenameDoc = mock();
    const user = userEvent.setup();
    render(tree([summary('a', 'Old name')], [], noopActions(), onRenameDoc));

    await user.click(screen.getByTestId('doc-row-menu-a'));
    await user.click(screen.getByTestId('doc-rename'));
    const input = await screen.findByTestId('doc-rename-input-a');
    await user.clear(input);
    await user.type(input, 'New name{Enter}');

    expect(onRenameDoc).toHaveBeenCalledWith('a', 'New name');
  });

  it('keeps the old title when the rename is cancelled', async () => {
    const onRenameDoc = mock();
    const user = userEvent.setup();
    render(tree([summary('a', 'Old name')], [], noopActions(), onRenameDoc));

    await user.click(screen.getByTestId('doc-row-menu-a'));
    await user.click(screen.getByTestId('doc-rename'));
    await user.type(await screen.findByTestId('doc-rename-input-a'), '{Escape}');

    expect(onRenameDoc).not.toHaveBeenCalled();
    expect(screen.getByTestId('doc-row-a').textContent).toContain('Old name');
  });

  it('shows no row menu to someone who cannot write', () => {
    render(tree([summary('a', 'Loose page')], []));

    expect(screen.queryByTestId('doc-row-menu-a')).toBeNull();
  });
});

describe('collapsibleKeys', () => {
  const docs = [
    { id: 'parent', parentId: null },
    { id: 'child', parentId: 'parent' },
    { id: 'grandchild', parentId: 'child' },
    { id: 'leaf', parentId: null },
  ];

  it('includes a nested page that itself holds pages', () => {
    const keys = collapsibleKeys(['engineering'], docs);
    expect(keys).toContain(docDisclosureKey('child'));
  });

  it('includes every folder', () => {
    expect(collapsibleKeys(['engineering', 'private'], docs)).toContain(
      groupDisclosureKey('private'),
    );
  });

  it('leaves out pages that hold nothing, since they cannot be collapsed', () => {
    const keys = collapsibleKeys([], docs);
    expect(keys).not.toContain(docDisclosureKey('leaf'));
    expect(keys).not.toContain(docDisclosureKey('grandchild'));
  });
});
