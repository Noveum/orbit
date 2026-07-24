'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { DocsSidebar } from './docs-sidebar.tsx';
import { type DocsTreeControl, DocsTreeProvider } from './use-docs-tree.ts';

export interface DocsShellProps {
  readonly canWrite: boolean;
  readonly children: ReactNode;
}

export function DocsShell({ canWrite, children }: DocsShellProps) {
  const [open, setOpen] = useState(false);
  const [unsavedDocId, setUnsavedDocId] = useState<string | null>(null);

  const control = useMemo<DocsTreeControl>(
    () => ({
      open,
      toggle: () => setOpen((value) => !value),
      close: () => setOpen(false),
      unsavedDocId,
      setUnsavedDocId,
    }),
    [open, unsavedDocId],
  );

  return (
    <DocsTreeProvider value={control}>
      <div className="relative flex h-full min-h-0" data-testid="docs-workspace">
        <DocsSidebar canWrite={canWrite} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </DocsTreeProvider>
  );
}
