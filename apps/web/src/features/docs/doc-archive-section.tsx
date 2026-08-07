'use client';

import { Archive, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Collapsible } from '@/components/ui/collapsible.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { revealOnHover } from '@/lib/interaction.ts';
import { useArchivedDocs, useDeleteDoc, useRestoreDoc } from '@/lib/query/use-docs.ts';

export function DocArchiveSection({ canWrite }: { readonly canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const archived = useArchivedDocs(open);
  const restore = useRestoreDoc();
  const remove = useDeleteDoc();

  const rows = (archived.data?.docs ?? []).filter((doc) => doc.archivedAt !== null);

  return (
    <section data-testid="doc-archive" className="mt-1 border-border border-t pt-2">
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this doc for good?</DialogTitle>
            <DialogDescription>
              {pendingDelete?.title ?? 'This doc'} and its history are removed for everyone. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              data-testid="doc-delete-confirm"
              onClick={() => {
                if (pendingDelete !== null) remove.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete for good
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <button
        type="button"
        aria-expanded={open}
        data-testid="doc-archive-toggle"
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-3 shrink-0 text-faint transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none',
            open ? 'rotate-90' : '',
          )}
        />
        <Archive className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-dense">Archived</span>
      </button>

      <Collapsible open={open} className="flex flex-col gap-0.5">
        {archived.isPending || rows.length === 0 ? (
          <p className="px-2 py-1 pl-7 text-2xs text-faint">
            {archived.isPending ? 'Loading…' : 'Nothing archived.'}
          </p>
        ) : (
          rows.map((doc) => (
            <div
              key={doc.id}
              data-testid={`doc-archived-${doc.id}`}
              className="group flex h-7 items-center gap-1 rounded-md pr-1 pl-7 text-dense text-muted hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1 truncate">{doc.title}</span>
              {canWrite ? (
                <>
                  <Tooltip label="Restore" side="left">
                    <button
                      type="button"
                      aria-label={`Restore ${doc.title}`}
                      data-testid={`doc-restore-${doc.id}`}
                      onClick={() => restore.mutate(doc.id)}
                      className={cn(
                        'flex size-5 items-center justify-center rounded-sm text-faint hover:bg-surface-3 hover:text-text',
                        revealOnHover,
                      )}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Delete for good" side="left">
                    <button
                      type="button"
                      aria-label={`Delete ${doc.title} for good`}
                      data-testid={`doc-delete-${doc.id}`}
                      onClick={() => setPendingDelete({ id: doc.id, title: doc.title })}
                      className={cn(
                        'flex size-5 items-center justify-center rounded-sm text-faint hover:bg-surface-3 hover:text-danger',
                        revealOnHover,
                      )}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </Tooltip>
                </>
              ) : null}
            </div>
          ))
        )}
      </Collapsible>
    </section>
  );
}
