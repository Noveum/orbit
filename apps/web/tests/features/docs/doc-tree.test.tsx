import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';
import { resetSidebarDisclosure } from '@/lib/use-sidebar-disclosure.ts';
import {
  ancestorsOf,
  DocTree,
  docDisclosureKey,
  docTreeOf,
  groupDisclosureKey,
  groupIdOf,
} from '../../../src/features/docs/doc-tree.tsx';

function reloadPage(): void {
  cleanup();
  resetSidebarDisclosure();
}

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarDisclosure();
});

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
    snippet: '',
    titleMatch: false,
  };
}

function tree(
  docs: readonly DocSummary[],
  collections: readonly DocCollection[],
  activeDocId?: string | null,
) {
  return (
    <TooltipProvider>
      <DocTree
        docs={docs}
        collections={collections}
        activeDocId={activeDocId === undefined ? (docs[0]?.id ?? null) : activeDocId}
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

describe('folding a folder in the rendered tree', () => {
  const nested: DocSummary[] = [
    summary('root', 'Handbook'),
    { ...summary('child', 'Onboarding'), parentId: 'root' },
    { ...summary('grandchild', 'Day one'), parentId: 'child' },
    summary('other', 'Runbook'),
  ];

  afterEach(cleanup);

  it('hides the descendants when the control is pressed, and says so', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(tree(nested, [], 'other'));

    const toggle = screen.getByTestId('doc-toggle-root');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Day one')).toBeTruthy();

    await user.click(toggle);

    expect(screen.getByTestId('doc-toggle-root')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Onboarding')).toBeNull();
    expect(screen.queryByText('Day one')).toBeNull();
    expect(screen.getByText('Runbook')).toBeTruthy();
  });

  it('reopens the chain when the doc inside it becomes the active one', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const view = render(tree(nested, [], 'other'));

    await user.click(screen.getByTestId('doc-toggle-root'));
    expect(screen.queryByText('Day one')).toBeNull();

    view.rerender(tree(nested, [], 'grandchild'));

    expect(screen.getByText('Day one')).toBeTruthy();
    expect(screen.getByTestId('doc-toggle-root')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('collapsing the folder the open doc lives in', () => {
  const nested: DocSummary[] = [
    summary('root', 'Handbook'),
    { ...summary('child', 'Onboarding'), parentId: 'root' },
    { ...summary('grandchild', 'Day one'), parentId: 'child' },
    summary('other', 'Runbook'),
  ];

  afterEach(cleanup);

  it('stays collapsed when the docs list refreshes underneath it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const view = render(tree(nested, [], 'grandchild'));

    await user.click(screen.getByTestId('doc-toggle-root'));
    expect(screen.queryByText('Day one')).toBeNull();

    view.rerender(tree([...nested], [], 'grandchild'));

    expect(screen.queryByText('Day one')).toBeNull();
    expect(screen.getByTestId('doc-toggle-root')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('coming back to a doc after leaving the docs section', () => {
  const nested: DocSummary[] = [
    summary('root', 'Handbook'),
    { ...summary('child', 'Onboarding'), parentId: 'root' },
    { ...summary('grandchild', 'Day one'), parentId: 'child' },
    summary('other', 'Runbook'),
  ];

  afterEach(cleanup);

  it('reveals it again, even though it was the last doc open before leaving', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const view = render(tree(nested, [], 'grandchild'));

    view.rerender(tree(nested, [], null));
    await user.click(screen.getByTestId('doc-toggle-root'));
    expect(screen.queryByText('Day one')).toBeNull();

    view.rerender(tree(nested, [], 'grandchild'));

    expect(screen.getByText('Day one')).toBeTruthy();
  });
});

function groupRegion(groupId: string): HTMLElement {
  const toggle = screen.getByTestId(`doc-group-toggle-${groupId}`);
  const section = toggle.closest('section');
  const region = section?.querySelector<HTMLElement>('[data-state]') ?? null;
  if (region === null) throw new Error(`no region for ${groupId}`);
  return region;
}

function groupContent(groupId: string): HTMLElement | null {
  const toggle = screen.getByTestId(`doc-group-toggle-${groupId}`);
  const section = toggle.closest('section');
  return section?.querySelector<HTMLElement>('[data-state="open"]') ?? null;
}

function storedDisclosure(): Record<string, unknown> {
  const raw = window.localStorage.getItem('orbit:sidebar:disclosure');
  if (raw === null) return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

describe('a folder in the docs sidebar', () => {
  const nested: DocSummary[] = [
    summary('root', 'Handbook'),
    { ...summary('child', 'Onboarding'), parentId: 'root' },
    summary('other', 'Runbook'),
  ];

  afterEach(cleanup);

  it('names the folder a doc belongs to, so the folder can be reopened for it', () => {
    expect(groupIdOf(summary('a', 'A'))).toBe('private');
    expect(groupIdOf({ ...summary('b', 'B'), projectId: 'project_1' })).toBe('project');
    expect(groupIdOf({ ...summary('c', 'C'), collectionId: 'collection_1' })).toBe('collection_1');
    expect(docDisclosureKey('same')).not.toBe(groupDisclosureKey('same'));
  });

  it('closes from its own header, hiding everything filed under it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(tree(nested, [], null));

    const toggle = screen.getByTestId('doc-group-toggle-private');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(groupRegion('private')).toHaveAttribute('data-state', 'open');

    await user.click(toggle);

    expect(screen.getByTestId('doc-group-toggle-private')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(groupRegion('private')).toHaveAttribute('data-state', 'closed');
  });

  it('is still closed the next time the person loads the app', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(tree(nested, [], null));

    await user.click(screen.getByTestId('doc-group-toggle-private'));
    expect(storedDisclosure()[groupDisclosureKey('private')]).toBe(false);

    reloadPage();
    render(tree(nested, [], null));

    expect(screen.getByTestId('doc-group-toggle-private')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(groupContent('private')).toBeNull();
  });

  it('opens again when a doc filed under it becomes the active one', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const view = render(tree(nested, [], null));

    await user.click(screen.getByTestId('doc-group-toggle-private'));
    expect(screen.getByTestId('doc-group-toggle-private')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    view.rerender(tree(nested, [], 'child'));

    expect(screen.getByTestId('doc-group-toggle-private')).toHaveAttribute('aria-expanded', 'true');
  });

  it('stays open when it was never closed', () => {
    render(tree(nested, [], null));

    expect(screen.getByTestId('doc-group-toggle-private')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Handbook')).toBeTruthy();
  });
});

describe('a nested page that was folded away', () => {
  const nested: DocSummary[] = [
    summary('root', 'Handbook'),
    { ...summary('child', 'Onboarding'), parentId: 'root' },
    { ...summary('grandchild', 'Day one'), parentId: 'child' },
    summary('other', 'Runbook'),
  ];

  afterEach(cleanup);

  it('is still folded the next time the person loads the app', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(tree(nested, [], 'other'));

    await user.click(screen.getByTestId('doc-toggle-root'));
    expect(screen.queryByText('Onboarding')).toBeNull();
    expect(storedDisclosure()[docDisclosureKey('root')]).toBe(false);

    reloadPage();
    render(tree(nested, [], 'other'));

    expect(screen.getByTestId('doc-toggle-root')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Onboarding')).toBeNull();
    expect(screen.queryByText('Day one')).toBeNull();
    expect(screen.getByText('Runbook')).toBeTruthy();
  });

  it('is unfolded again on the next load once the person reopens it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(tree(nested, [], 'other'));

    await user.click(screen.getByTestId('doc-toggle-root'));
    await user.click(screen.getByTestId('doc-toggle-root'));

    reloadPage();
    render(tree(nested, [], 'other'));

    expect(screen.getByTestId('doc-toggle-root')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Onboarding')).toBeTruthy();
  });
});
