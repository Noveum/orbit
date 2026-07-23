import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { IssueWorkspaceProvider } from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import * as docsQuery from '@/lib/query/use-docs.ts';
import * as issuesQuery from '@/lib/query/use-issues.ts';
import { DocsWorkspace } from './docs-workspace.tsx';

const push = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ push, replace: mock(), refresh: mock() }),
  usePathname: () => '/docs',
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

function Tree({ docs, canWrite }: { readonly docs: boolean; readonly canWrite: boolean }) {
  const shell = (children: ReactNode) => (
    <TooltipProvider>
      <HotkeyProvider>
        <IssueWorkspaceProvider>{children}</IssueWorkspaceProvider>
      </HotkeyProvider>
    </TooltipProvider>
  );
  return shell(docs ? <DocsWorkspace docId={null} canWrite={canWrite} canPublish={false} /> : null);
}

function mountShellThenDocs(canWrite = true) {
  const view = render(<Tree docs={false} canWrite={canWrite} />);
  view.rerender(<Tree docs canWrite={canWrite} />);
  return view;
}

beforeEach(() => {
  push.mockClear();
});

describe('c on the docs page', () => {
  it('creates a doc even though the workspace registered its own c first', async () => {
    const user = userEvent.setup();
    mountShellThenDocs();
    expect(screen.getByTestId('docs-workspace')).toBeInTheDocument();

    await user.keyboard('c');

    expect(push).toHaveBeenCalledWith('/docs/new');
    expect(screen.queryByTestId('quick-create')).not.toBeInTheDocument();
  });

  it('does nothing rather than creating an issue when docs are read only', async () => {
    const user = userEvent.setup();
    mountShellThenDocs(false);

    await user.keyboard('c');

    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quick-create')).not.toBeInTheDocument();
  });
});
