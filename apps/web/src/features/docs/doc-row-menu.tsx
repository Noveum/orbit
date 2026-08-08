'use client';

import {
  Archive,
  Check,
  Copy,
  FolderInput,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/cn.ts';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';

export interface DocRowActions {
  readonly canDelete: (doc: DocSummary) => boolean;
  readonly onRename: (doc: DocSummary) => void;
  readonly onMove: (doc: DocSummary, collectionId: string | null) => void;
  readonly onDuplicate: (doc: DocSummary) => void;
  readonly onCopyLink: (doc: DocSummary) => void;
  readonly onArchive: (doc: DocSummary) => void;
  readonly onDelete: (doc: DocSummary) => void;
}

export interface DocRowMenuProps {
  readonly doc: DocSummary;
  readonly collections: readonly DocCollection[];
  readonly actions: DocRowActions;
  readonly className?: string;
}

export function DocRowMenu({ doc, collections, actions, className }: DocRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${doc.title}`}
        data-testid={`doc-row-menu-${doc.id}`}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          'mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-faint',
          'hover:bg-surface-2 hover:text-text data-[state=open]:opacity-100',
          className,
        )}
      >
        <MoreHorizontal className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem data-testid="doc-rename" onSelect={() => actions.onRename(doc)}>
          <Pencil className="size-3.5" aria-hidden="true" />
          Rename
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="doc-move-to">
            <FolderInput className="size-3.5" aria-hidden="true" />
            Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              data-testid="doc-move-to-private"
              onSelect={() => actions.onMove(doc, null)}
            >
              <span className="flex-1">Private</span>
              {doc.collectionId === null ? (
                <Check className="size-3.5 text-accent" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
            {collections.map((collection) => (
              <DropdownMenuItem
                key={collection.id}
                data-testid={`doc-move-to-${collection.id}`}
                onSelect={() => actions.onMove(doc, collection.id)}
              >
                <span className="flex-1 truncate">{collection.name}</span>
                {doc.collectionId === collection.id ? (
                  <Check className="size-3.5 text-accent" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem onSelect={() => actions.onDuplicate(doc)}>
          <Copy className="size-3.5" aria-hidden="true" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="doc-copy-row-link" onSelect={() => actions.onCopyLink(doc)}>
          <Link2 className="size-3.5" aria-hidden="true" />
          Copy link
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="doc-archive-row" onSelect={() => actions.onArchive(doc)}>
          <Archive className="size-3.5" aria-hidden="true" />
          Archive
        </DropdownMenuItem>
        {actions.canDelete(doc) ? (
          <DropdownMenuItem
            data-testid="doc-delete-row"
            className="text-danger data-[highlighted]:text-danger"
            onSelect={() => actions.onDelete(doc)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete for good
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
