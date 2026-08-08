import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocSummary } from '@/lib/query/schemas.ts';
import { matchParents, NestPickerList } from '../../../src/features/docs/doc-surface.tsx';

function doc(id: string, title: string): DocSummary {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    id,
    organizationId: 'org_1',
    collectionId: null,
    projectId: null,
    parentId: null,
    title,
    slug: id,
    content: '',
    sortOrder: 0,
    visibility: 'workspace',
    publishToken: null,
    authorId: 'user_1',
    repoBinding: null,
    syncId: 1,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    excerpt: '',
    snippet: '',
    titleMatch: false,
    rank: 0,
  };
}

const parents: readonly DocSummary[] = [
  doc('doc_engine', 'Engine design'),
  doc('doc_billing', 'Billing overview'),
  doc('doc_roadmap', 'Roadmap 2026'),
];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('matchParents', () => {
  it('filters by case-insensitive title substring', () => {
    expect(matchParents(parents, 'engine', 50).shown.map((entry) => entry.id)).toEqual([
      'doc_engine',
    ]);
    expect(matchParents(parents, 'o', 50).shown.map((entry) => entry.id)).toEqual([
      'doc_billing',
      'doc_roadmap',
    ]);
  });

  it('does not throw when a doc has an empty or missing title', () => {
    const titleless = [doc('doc_blank', ''), { ...doc('doc_null', 'x'), title: null }];
    expect(() =>
      matchParents(titleless as unknown as readonly DocSummary[], 'x', 50),
    ).not.toThrow();
  });
});

describe('NestPickerList', () => {
  it('narrows the list to matching titles when the user types', async () => {
    const user = userEvent.setup();
    const onSelect = mock();
    render(<NestPickerList parents={parents} currentParentId={null} onSelect={onSelect} />);

    const search = await screen.findByTestId('doc-parent-search');
    expect(screen.getByTestId('nest-under-doc_engine')).toBeInTheDocument();
    expect(screen.getByTestId('nest-under-doc_billing')).toBeInTheDocument();

    await user.type(search, 'engine');

    expect(search).toHaveValue('engine');
    expect(screen.getByTestId('nest-under-doc_engine')).toBeInTheDocument();
    expect(screen.queryByTestId('nest-under-doc_billing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nest-under-doc_roadmap')).not.toBeInTheDocument();
    expect(screen.getByTestId('nest-under-none')).toBeInTheDocument();
  });

  it('selects a matching doc with Enter after filtering', async () => {
    const user = userEvent.setup();
    const onSelect = mock();
    render(<NestPickerList parents={parents} currentParentId={null} onSelect={onSelect} />);

    const search = await screen.findByTestId('doc-parent-search');

    await user.type(search, 'roadmap');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('doc_roadmap');
  });

  it('moves the highlight with arrow keys and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = mock();
    render(<NestPickerList parents={parents} currentParentId={null} onSelect={onSelect} />);

    const search = await screen.findByTestId('doc-parent-search');
    search.focus();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('doc_billing');
  });

  it('keeps Top level in reach and clears the query after a pick', async () => {
    const user = userEvent.setup();
    const onSelect = mock();
    render(<NestPickerList parents={parents} currentParentId={null} onSelect={onSelect} />);

    const search = await screen.findByTestId('doc-parent-search');
    await user.type(search, 'engine');
    expect(
      within(screen.getByTestId('nest-under-none')).getByText('Top level'),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('nest-under-none'));
    expect(onSelect).toHaveBeenCalledWith(null);

    expect(screen.getByTestId('doc-parent-search')).toHaveValue('');
  });
});
