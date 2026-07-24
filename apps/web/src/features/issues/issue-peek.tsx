'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowUpRight, X } from 'lucide-react';
import { overlayClassName } from '@/components/ui/dialog.tsx';
import { cn } from '@/lib/cn.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { IssueDetailView } from './issue-detail.tsx';

export interface IssuePeekProps {
  readonly issue: Issue | undefined;
  readonly onClose: () => void;
  readonly onOpen: () => void;
}

export function IssuePeek({ issue, onClose, onOpen }: IssuePeekProps) {
  if (issue === undefined) return null;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClassName} />
        <DialogPrimitive.Content
          data-testid="issue-peek"
          aria-label={`Peek ${issue.identifier}`}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-border border-l bg-surface shadow-pop',
            'data-[state=open]:animate-panel-in data-[state=closed]:animate-panel-out',
            'motion-reduce:animate-none',
          )}
        >
          <div className="flex items-center justify-between border-border border-b px-3 py-2">
            <span data-numeric className="text-2xs text-faint">
              {issue.identifier}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onOpen}
                aria-label="Open full page"
                className="flex items-center gap-1 rounded-sm px-2 py-1 text-2xs text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text"
              >
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                Open
              </button>
              <DialogPrimitive.Close
                aria-label="Close"
                className="rounded-sm p-1 text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text"
              >
                <X className="size-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <DialogPrimitive.Title className="sr-only">{issue.title}</DialogPrimitive.Title>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <IssueDetailView identifier={issue.identifier} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
