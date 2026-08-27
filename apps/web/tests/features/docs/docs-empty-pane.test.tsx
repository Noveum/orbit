import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import userEvent from '@testing-library/user-event';
import { HTML_PAGE_TEMPLATE_ID } from '@/features/docs/templates.ts';
import { newDocPath } from '@/lib/docs/paths.ts';
import { cleanup, render, screen } from '@/test/render.tsx';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile([
  'next/navigation',
  '@/lib/query/use-docs.ts',
  '@/features/docs/use-docs-tree.ts',
  '@/features/docs/doc-import.tsx',
  '@/features/docs/docs-home.tsx',
  '@/features/docs/docs-empty-pane.tsx',
]);

const push = mock();
const toggle = mock();
let docs: readonly { readonly id: string }[] = [];

mock.module('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

mock.module('@/lib/query/use-docs.ts', () => ({
  useDocs: () => ({ data: { docs, collections: [], projects: [] } }),
}));

mock.module('@/features/docs/use-docs-tree.ts', () => ({
  useDocsTree: () => ({ toggle }),
}));

mock.module('@/features/docs/doc-import.tsx', () => ({
  DocImport: () => <span data-testid="doc-import-stub" />,
}));

mock.module('@/features/docs/docs-home.tsx', () => ({
  DocsHome: () => <div data-testid="docs-home-stub" />,
}));

const { DocsEmptyPane } = await import('@/features/docs/docs-empty-pane.tsx');

beforeEach(() => {
  docs = [];
  push.mockClear();
  toggle.mockClear();
});

afterEach(cleanup);

describe('DocsEmptyPane HTML creation', () => {
  it('opens the HTML page template from the toolbar', async () => {
    docs = [{ id: 'doc_1' }];
    const user = userEvent.setup();
    render(<DocsEmptyPane canWrite />);

    await user.click(screen.getByTestId('new-html-page'));

    expect(push).toHaveBeenCalledWith(newDocPath({ templateId: HTML_PAGE_TEMPLATE_ID }));
  });

  it('keeps templates and import available in the scrollable narrow-screen toolbar', () => {
    docs = [{ id: 'doc_1' }];
    render(<DocsEmptyPane canWrite />);

    expect(screen.getByTestId('docs-toolbar').className).toContain('overflow-x-auto');
    expect(screen.getByTestId('doc-templates').className).not.toContain('hidden');
    expect(screen.getByTestId('doc-import-stub').parentElement).toBe(
      screen.getByTestId('docs-toolbar'),
    );
  });

  it('opens the HTML page template from the empty state', async () => {
    const user = userEvent.setup();
    render(<DocsEmptyPane canWrite />);
    const actions = screen.getAllByRole('button', { name: 'New HTML page' });
    const emptyStateAction = actions.at(1);

    expect(actions).toHaveLength(2);
    expect(emptyStateAction).toBeDefined();
    if (emptyStateAction === undefined) throw new Error('Missing empty state action');
    await user.click(emptyStateAction);

    expect(push).toHaveBeenCalledWith(newDocPath({ templateId: HTML_PAGE_TEMPLATE_ID }));
  });

  it('hides both HTML creation actions without write permission', () => {
    render(<DocsEmptyPane canWrite={false} />);

    expect(screen.queryByTestId('new-html-page')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New HTML page' })).toBeNull();
  });
});
