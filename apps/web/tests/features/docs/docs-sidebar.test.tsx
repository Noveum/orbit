import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { IssueWorkspaceProvider } from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import * as docsQuery from '@/lib/query/use-docs.ts';
import * as issuesQuery from '@/lib/query/use-issues.ts';
import { render } from '@/test/render.tsx';
import { DocsShell } from '../../../src/features/docs/docs-shell.tsx';

const push = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ push, replace: mock(), refresh: mock() }),
  usePathname: () => '/docs',
  useParams: () => ({}),
}));

mock.module('@/lib/query/use-docs.ts', () => ({
  ...docsQuery,
  useDocs: () => ({ data: { docs: [], collections: [], projects: [] } }),
  useCreateCollection: () => ({ mutate: mock() }),
  useRenameCollection: () => ({ mutate: mock() }),
  useDeleteCollection: () => ({ mutate: mock() }),
}));

mock.module('@/lib/query/use-issues.ts', () => ({
  ...issuesQuery,
  useBootstrap: () => ({ data: undefined }),
  useCreateIssue: () => ({ mutate: mock(), isPending: false }),
}));

function shell(children: ReactNode) {
  return (
    <TooltipProvider>
      <HotkeyProvider>
        <IssueWorkspaceProvider>{children}</IssueWorkspaceProvider>
      </HotkeyProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  push.mockClear();
});

describe('docs sidebar', () => {
  it('creates a doc when c is pressed even though the workspace also binds c', async () => {
    const user = userEvent.setup();
    render(
      shell(
        <DocsShell canWrite>
          <div data-testid="pane-a" />
        </DocsShell>,
      ),
    );
    expect(screen.getByTestId('doc-tree')).toBeInTheDocument();

    await user.keyboard('c');

    expect(push).toHaveBeenCalledWith('/docs/new');
  });

  it('does nothing on c when docs are read only', async () => {
    const user = userEvent.setup();
    render(
      shell(
        <DocsShell canWrite={false}>
          <div data-testid="pane-a" />
        </DocsShell>,
      ),
    );

    await user.keyboard('c');

    expect(push).not.toHaveBeenCalled();
  });

  it('keeps the tree mounted and its state when the content pane changes', async () => {
    const user = userEvent.setup();
    const view = render(
      shell(
        <DocsShell canWrite>
          <div data-testid="pane-a" />
        </DocsShell>,
      ),
    );

    await user.type(screen.getByTestId('doc-search'), 'engine');
    expect(screen.getByTestId('doc-search')).toHaveValue('engine');

    view.rerender(
      shell(
        <DocsShell canWrite>
          <div data-testid="pane-b" />
        </DocsShell>,
      ),
    );

    expect(screen.getByTestId('pane-b')).toBeInTheDocument();
    expect(screen.queryByTestId('pane-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('doc-search')).toHaveValue('engine');
  });
});
