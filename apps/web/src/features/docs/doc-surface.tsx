'use client';

import { Command } from 'cmdk';
import { Archive, Check, FolderInput, Indent, PanelLeft, Pencil, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import type { Doc, DocCollection, DocDetail, DocSummary } from '@/lib/query/schemas.ts';
import type { DocPatch } from '@/lib/query/use-docs.ts';
import { useArchiveDoc, useDoc, useUpdateDoc } from '@/lib/query/use-docs.ts';
import { DocEditor } from './doc-editor.tsx';
import { DocHistory } from './doc-history.tsx';
import { DocReader } from './doc-reader.tsx';
import { DocShareMenu } from './doc-share-menu.tsx';
import type { SaveStatus } from './use-autosave.ts';
import { useAutosave } from './use-autosave.ts';

const STATUS_LABEL = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
} as const;

const NEST_PICKER_LIMIT = 50;

export function matchParents(
  parents: readonly DocSummary[],
  search: string,
  limit: number,
): { readonly shown: DocSummary[]; readonly hiddenCount: number } {
  const query = search.trim().toLowerCase();
  const matches =
    query.length === 0
      ? parents
      : parents.filter((entry) => entry.title.toLowerCase().includes(query));
  return { shown: matches.slice(0, limit), hiddenCount: Math.max(matches.length - limit, 0) };
}

export function descendantIds(docs: readonly DocSummary[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const doc of docs) {
    if (doc.parentId === null) continue;
    const list = children.get(doc.parentId) ?? [];
    list.push(doc.id);
    children.set(doc.parentId, list);
  }

  const blocked = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) continue;
    for (const child of children.get(next) ?? []) {
      if (blocked.has(child)) continue;
      blocked.add(child);
      queue.push(child);
    }
  }
  return blocked;
}

export interface DocSurfaceProps {
  readonly docId: string;
  readonly docs: readonly DocSummary[];
  readonly collections: readonly DocCollection[];
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly canWrite: boolean;
  readonly canPublish: boolean;
  readonly startEditing: boolean;
  readonly onUnsavedChange: (docId: string | null) => void;
  readonly onToggleTree: () => void;
}

export function DocSurface(props: DocSurfaceProps) {
  const detail = useDoc(props.docId);

  if (detail.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-[45rem] flex-col gap-4 px-6 py-10">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (detail.data === undefined) {
    return (
      <EmptyState
        icon={<Pencil strokeWidth={1.75} aria-hidden="true" />}
        title="Doc not found"
        description="It may have been archived or it belongs to another workspace."
      />
    );
  }

  return <LoadedDoc key={detail.data.doc.id} detail={detail.data} {...props} />;
}

function LoadedDoc({
  detail,
  docs,
  collections,
  projects,
  canWrite,
  canPublish,
  startEditing,
  onUnsavedChange,
  onToggleTree,
}: DocSurfaceProps & { readonly detail: DocDetail }) {
  const router = useRouter();
  const update = useUpdateDoc(detail.doc.id);
  const archive = useArchiveDoc();
  const [editing, setEditing] = useState(startEditing && canWrite);
  const [status, setStatus] = useState<SaveStatus>('saved');

  useEffect(() => {
    onUnsavedChange(editing && status !== 'saved' ? detail.doc.id : null);
  }, [editing, status, detail.doc.id, onUnsavedChange]);

  const collectionName =
    collections.find((entry) => entry.id === detail.doc.collectionId)?.name ?? null;
  const projectName = projects.find((entry) => entry.id === detail.doc.projectId)?.name ?? null;
  const blocked = useMemo(() => descendantIds(docs, detail.doc.id), [docs, detail.doc.id]);
  const parents = useMemo(() => docs.filter((entry) => !blocked.has(entry.id)), [docs, blocked]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-3">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Toggle doc tree"
          data-testid="toggle-doc-tree"
          className="size-7 px-0 lg:hidden"
          onClick={onToggleTree}
        >
          <PanelLeft className="size-4" aria-hidden="true" />
        </Button>

        <p className="min-w-0 flex-1 truncate text-dense text-muted">{detail.doc.title}</p>

        {canWrite && editing ? (
          <span
            data-testid="doc-save-status"
            className={status === 'error' ? 'text-2xs text-danger' : 'text-2xs text-faint'}
          >
            {STATUS_LABEL[status]}
          </span>
        ) : null}

        <DocHistory docId={detail.doc.id} canWrite={canWrite} />

        {canPublish ? <DocShareMenu doc={detail.doc} /> : null}

        {canWrite ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Move doc" className="size-7 px-0">
                  <FolderInput className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Move to collection</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => update.mutate({ collectionId: null })}>
                  <span className="flex-1">Private</span>
                  {detail.doc.collectionId === null ? (
                    <Check className="size-3.5 text-accent" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
                {collections.map((collection) => (
                  <DropdownMenuItem
                    key={collection.id}
                    data-testid={`move-to-${collection.id}`}
                    onSelect={() => update.mutate({ collectionId: collection.id })}
                  >
                    <span className="flex-1">{collection.name}</span>
                    {detail.doc.collectionId === collection.id ? (
                      <Check className="size-3.5 text-accent" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <NestPicker
              parents={parents}
              currentParentId={detail.doc.parentId}
              onSelect={(parentId) => update.mutate({ parentId })}
            />

            <Button
              variant="ghost"
              size="sm"
              aria-label="Archive doc"
              data-testid="doc-archive"
              className="size-7 px-0"
              onClick={() => {
                archive.mutate(detail.doc.id);
                router.push('/docs');
              }}
            >
              <Archive className="size-4" aria-hidden="true" />
            </Button>

            <Button
              variant={editing ? 'primary' : 'secondary'}
              size="sm"
              data-testid="doc-edit-toggle"
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? 'Done' : 'Edit'}
            </Button>

            <Button
              variant="primary"
              size="sm"
              data-testid="new-doc"
              className="hidden sm:inline-flex"
              onClick={() => router.push('/docs/new')}
            >
              New doc
              <Kbd keys={['c']} className="ml-1 opacity-70" />
            </Button>
          </>
        ) : null}
      </div>

      {editing ? (
        <EditSession doc={detail.doc} save={update.mutateAsync} onStatusChange={setStatus} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DocReader
            doc={detail.doc}
            contentHtml={detail.contentHtml}
            attachments={detail.attachments}
            author={detail.author}
            followers={detail.followers}
            collectionName={collectionName}
            projectName={projectName}
            backlinks={detail.backlinks}
          />
        </div>
      )}
    </div>
  );
}

const nestItemClassName =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-dense text-muted outline-none transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] data-[selected=true]:bg-surface-2 data-[selected=true]:text-text';

function NestPicker({
  parents,
  currentParentId,
  onSelect,
}: {
  readonly parents: readonly DocSummary[];
  readonly currentParentId: string | null;
  readonly onSelect: (parentId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { shown, hiddenCount } = matchParents(parents, search, NEST_PICKER_LIMIT);

  const choose = (parentId: string | null) => {
    onSelect(parentId);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Nest doc"
          data-testid="doc-parent"
          className="size-7 px-0"
        >
          <Indent className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Command shouldFilter={false} label="Nest under">
          <div className="flex items-center gap-2 border-border border-b px-2.5">
            <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              data-testid="doc-parent-search"
              aria-label="Search docs to nest under"
              placeholder="Search docs..."
              className="h-9 w-full bg-transparent text-dense text-text outline-none placeholder:text-faint"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1.5">
            <Command.Item
              value="__top_level__"
              data-testid="nest-under-none"
              className={nestItemClassName}
              onSelect={() => choose(null)}
            >
              <span className="flex-1 truncate">Top level</span>
              {currentParentId === null ? (
                <Check className="size-3.5 text-accent" aria-hidden="true" />
              ) : null}
            </Command.Item>
            {shown.map((entry) => (
              <Command.Item
                key={entry.id}
                value={entry.id}
                data-testid={`nest-under-${entry.id}`}
                className={nestItemClassName}
                onSelect={() => choose(entry.id)}
              >
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                {currentParentId === entry.id ? (
                  <Check className="size-3.5 text-accent" aria-hidden="true" />
                ) : null}
              </Command.Item>
            ))}
            {hiddenCount > 0 ? (
              <p className="px-2 py-1.5 text-2xs text-faint">
                Showing the first {NEST_PICKER_LIMIT}. Refine your search to see more.
              </p>
            ) : null}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EditSession({
  doc,
  save,
  onStatusChange,
}: {
  readonly doc: Doc;
  readonly save: (patch: DocPatch) => Promise<unknown>;
  readonly onStatusChange: (status: SaveStatus) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const draft = useMemo(() => ({ title, content }), [title, content]);
  const autosave = useAutosave({ value: draft, save });
  const flush = autosave.saveNow;

  useEffect(() => onStatusChange(autosave.status), [autosave.status, onStatusChange]);
  useEffect(() => flush, [flush]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border border-b px-6 pt-5 pb-3">
        <Input
          value={title}
          aria-label="Doc title"
          data-testid="doc-title-input"
          onChange={(event) => setTitle(event.target.value)}
          className="h-auto border-0 bg-transparent px-0 font-semibold text-text text-xl focus-visible:border-0"
        />
      </div>
      <DocEditor docId={doc.id} content={content} onChange={setContent} onForceSave={flush} />
    </div>
  );
}
