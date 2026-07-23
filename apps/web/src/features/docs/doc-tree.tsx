'use client';

import { FolderPlus, MoreHorizontal, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Input } from '@/components/ui/input.tsx';
import { ScrollArea } from '@/components/ui/scroll-area.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';

const RECENT_MS = 24 * 60 * 60 * 1000;

export interface DocGroup {
  readonly id: string;
  readonly name: string;
  readonly collectionId: string | null;
  readonly docs: readonly DocSummary[];
}

export function groupDocs(
  docs: readonly DocSummary[],
  collections: readonly DocCollection[],
): DocGroup[] {
  const groups: DocGroup[] = collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    collectionId: collection.id,
    docs: docs.filter((doc) => doc.collectionId === collection.id),
  }));

  const projectDocs = docs.filter((doc) => doc.collectionId === null && doc.projectId !== null);
  if (projectDocs.length > 0) {
    groups.push({ id: 'project', name: 'Project docs', collectionId: null, docs: projectDocs });
  }

  const privateDocs = docs.filter((doc) => doc.collectionId === null && doc.projectId === null);
  groups.push({ id: 'private', name: 'Private', collectionId: null, docs: privateDocs });

  return groups;
}

function GroupActions({
  group,
  onRename,
  onDelete,
}: {
  readonly group: DocGroup;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  const iconClassName =
    'flex size-5 items-center justify-center rounded-sm text-faint opacity-0 transition-opacity duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text focus-visible:opacity-100 group-hover:opacity-100';

  return (
    <>
      <Link
        href={
          group.collectionId === null ? '/docs/new' : `/docs/new?collection=${group.collectionId}`
        }
        aria-label={`New doc in ${group.name}`}
        data-testid={`new-doc-in-${group.id}`}
        className={iconClassName}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </Link>
      {group.collectionId === null ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Manage ${group.name}`}
            className={cn(iconClassName, 'data-[state=open]:opacity-100')}
          >
            <MoreHorizontal className="size-3.5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>Rename collection</DropdownMenuItem>
            <DropdownMenuItem
              className="text-danger data-[highlighted]:text-danger"
              onSelect={onDelete}
            >
              Delete collection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

function DocRow({
  doc,
  active,
  unsaved,
  recent,
}: {
  readonly doc: DocSummary;
  readonly active: boolean;
  readonly unsaved: boolean;
  readonly recent: boolean;
}) {
  return (
    <Link
      href={`/docs/${doc.id}`}
      data-testid={`doc-row-${doc.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-7 items-center gap-2 rounded-md px-2 text-dense transition-colors duration-[var(--duration-fast)]',
        active
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
      {unsaved || recent ? (
        <span
          aria-hidden="true"
          title={unsaved ? 'Unsaved changes' : 'Updated recently'}
          className={cn('size-1.5 shrink-0 rounded-full', unsaved ? 'bg-warning' : 'bg-accent')}
        />
      ) : null}
    </Link>
  );
}

export interface DocTreeProps {
  readonly docs: readonly DocSummary[];
  readonly collections: readonly DocCollection[];
  readonly activeDocId: string | null;
  readonly unsavedDocId: string | null;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly onCreateCollection: (name: string) => void;
  readonly onRenameCollection: (id: string, name: string) => void;
  readonly onDeleteCollection: (id: string) => void;
  readonly canWrite: boolean;
}

export function DocTree({
  docs,
  collections,
  activeDocId,
  unsavedDocId,
  search,
  onSearchChange,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  canWrite,
}: DocTreeProps) {
  const groups = useMemo(() => groupDocs(docs, collections), [docs, collections]);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const now = Date.now();

  const submitDraft = () => {
    const name = (draftName ?? '').trim();
    setDraftName(null);
    if (name.length > 0) onCreateCollection(name);
  };

  const submitRename = () => {
    const pending = renaming;
    setRenaming(null);
    if (pending === null) return;
    const name = pending.name.trim();
    if (name.length > 0) onRenameCollection(pending.id, name);
  };

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-border border-r bg-surface">
      <div className="flex items-center gap-1 border-border border-b p-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-faint"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search docs"
            aria-label="Search docs"
            data-testid="doc-search"
            className="h-8 pl-7 text-dense"
          />
        </div>
        {canWrite ? (
          <Tooltip label="New collection" side="bottom">
            <Button
              variant="ghost"
              size="sm"
              aria-label="New collection"
              data-testid="new-collection"
              onClick={() => setDraftName('')}
              className="size-8 shrink-0 px-0"
            >
              <FolderPlus className="size-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-2">
          {draftName === null ? null : (
            <Input
              autoFocus
              value={draftName}
              placeholder="Collection name"
              aria-label="Collection name"
              data-testid="new-collection-name"
              className="h-8"
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={submitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitDraft();
                if (event.key === 'Escape') setDraftName(null);
              }}
            />
          )}

          {groups.map((group) => (
            <section key={group.id} className="flex flex-col gap-0.5">
              <div className="group flex h-6 items-center gap-1 px-2">
                {renaming?.id === group.id ? (
                  <Input
                    autoFocus
                    value={renaming.name}
                    aria-label="Collection name"
                    className="h-6 text-2xs"
                    onChange={(event) => setRenaming({ id: group.id, name: event.target.value })}
                    onBlur={submitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitRename();
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <p className="min-w-0 flex-1 truncate font-medium text-2xs text-faint uppercase tracking-wide">
                    {group.name}
                  </p>
                )}

                {canWrite ? (
                  <GroupActions
                    group={group}
                    onRename={() => setRenaming({ id: group.id, name: group.name })}
                    onDelete={() => onDeleteCollection(group.id)}
                  />
                ) : null}
              </div>

              {group.docs.length === 0 ? (
                <p className="px-2 py-1 text-2xs text-faint">Nothing here yet</p>
              ) : (
                group.docs.map((doc) => (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    active={activeDocId === doc.id}
                    unsaved={unsavedDocId === doc.id}
                    recent={now - new Date(doc.updatedAt).getTime() < RECENT_MS}
                  />
                ))
              )}
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
