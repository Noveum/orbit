'use client';

import { useScopeSubscription } from '@orbit/realtime-client/react';
import { scopes } from '@orbit/shared/events';
import { DOC_CONTENT_LIMIT } from '@orbit/shared/validators';
import { Archive, Check, FolderInput, Indent, PanelLeft, Pencil, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { cn } from '@/lib/cn.ts';
import type { Doc, DocDetail, DocSummary } from '@/lib/query/schemas.ts';
import type { DocPatch } from '@/lib/query/use-docs.ts';
import { useArchiveDoc, useDoc, useDocs, useUpdateDoc } from '@/lib/query/use-docs.ts';
import { DocAttachments } from './doc-attachments.tsx';
import { DocComments } from './doc-comments.tsx';
import { DocEditor } from './doc-editor.tsx';
import { DocExportMenu } from './doc-export-menu.tsx';
import { DocHistory } from './doc-history.tsx';
import { DocOutline } from './doc-outline.tsx';
import { DocBacklinks, DocContextRow, DocReader } from './doc-reader.tsx';
import { DocShareMenu } from './doc-share-menu.tsx';
import type { SaveStatus } from './use-autosave.ts';
import { useAutosave } from './use-autosave.ts';
import { useDocsTree } from './use-docs-tree.ts';
import { useEditorOutline } from './use-editor-outline.ts';

const STATUS_LABEL = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
  blocked: 'Too long to save',
} as const;

const NEAR_LIMIT = Math.round(DOC_CONTENT_LIMIT * 0.9);

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
      : parents.filter((entry) => (entry.title ?? '').toLowerCase().includes(query));
  return { shown: matches.slice(0, limit), hiddenCount: Math.max(matches.length - limit, 0) };
}

export interface DocDraft {
  readonly title: string;
  readonly content: string;
}

export function adoptsRemoteEdit(settled: boolean, seen: DocDraft, incoming: DocDraft): boolean {
  if (seen.title === incoming.title && seen.content === incoming.content) return false;
  return settled;
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
  readonly canWrite: boolean;
  readonly canPublish: boolean;
}

function useDocList() {
  const list = useDocs('');
  return {
    docs: list.data?.docs ?? [],
    collections: list.data?.collections ?? [],
    projects: list.data?.projects ?? [],
  };
}

export function DocSurface(props: DocSurfaceProps) {
  const detail = useDoc(props.docId);
  const docScopes = useMemo(() => [scopes.doc(props.docId)], [props.docId]);
  useScopeSubscription(docScopes);

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
  canWrite,
  canPublish,
}: DocSurfaceProps & { readonly detail: DocDetail }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const { docs, collections, projects } = useDocList();
  const { toggle, setUnsavedDocId } = useDocsTree();
  const update = useUpdateDoc(detail.doc.id);
  const archive = useArchiveDoc();
  const [status, setStatus] = useState<SaveStatus>('saved');

  useEffect(() => {
    setUnsavedDocId(canWrite && status !== 'saved' ? detail.doc.id : null);
    return () => setUnsavedDocId(null);
  }, [canWrite, status, detail.doc.id, setUnsavedDocId]);

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
          onClick={toggle}
        >
          <PanelLeft className="size-4" aria-hidden="true" />
        </Button>

        <p className="min-w-0 flex-1 truncate text-dense text-muted">{detail.doc.title}</p>

        {canWrite ? (
          <span
            data-testid="doc-save-status"
            className={status === 'error' ? 'text-2xs text-danger' : 'text-2xs text-faint'}
          >
            {STATUS_LABEL[status]}
          </span>
        ) : null}

        <DocExportMenu title={detail.doc.title} content={detail.doc.content} />

        <DocHistory docId={detail.doc.id} canWrite={canWrite} />

        {canWrite ? (
          <DocShareMenu
            doc={detail.doc}
            canPublish={canPublish}
            canManageAccess={canPublish || detail.doc.authorId === workspace.userId}
          />
        ) : null}

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

      {canWrite ? (
        <EditSession
          doc={detail.doc}
          save={update.mutateAsync}
          onStatusChange={setStatus}
          collectionName={collectionName}
          projectName={projectName}
          footer={
            <div className="mt-10 border-border border-t pt-6">
              <DocAttachments attachments={detail.attachments} />
              <DocBacklinks backlinks={detail.backlinks} />
              <DocComments docId={detail.doc.id} members={workspace.members} />
            </div>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 scroll-smooth overflow-y-auto motion-reduce:scroll-auto">
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
          <DocComments docId={detail.doc.id} members={workspace.members} />
        </div>
      )}
    </div>
  );
}

const nestItemClassName =
  'flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 text-left text-dense text-muted outline-none transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] data-[selected=true]:bg-surface-2 data-[selected=true]:text-text';

export function NestPicker({
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
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = 'nest-under-list';
  const { shown, hiddenCount } = matchParents(parents, search, NEST_PICKER_LIMIT);

  const options: readonly { readonly id: string | null; readonly label: string }[] = [
    { id: null, label: 'Top level' },
    ...shown.map((entry) => ({ id: entry.id, label: entry.title })),
  ];
  const activeIndex = Math.min(active, options.length - 1);

  const choose = (parentId: string | null) => {
    onSelect(parentId);
    setSearch('');
    setActive(0);
    setOpen(false);
  };

  const optionId = (id: string | null) => (id === null ? 'nest-under-none' : `nest-under-${id}`);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option !== undefined) choose(option.id);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearch('');
          setActive(0);
        }
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
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-border border-b px-2.5">
          <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(event.target.value.trim().length > 0 ? 1 : 0);
            }}
            onKeyDown={onKeyDown}
            data-testid="doc-parent-search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={optionId(options[activeIndex]?.id ?? null)}
            aria-label="Search docs to nest under"
            placeholder="Search docs..."
            className="h-9 w-full bg-transparent text-dense text-text outline-none placeholder:text-faint"
          />
        </div>
        <div id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
          {options.map((option, index) => (
            <button
              key={option.id ?? '__top_level__'}
              type="button"
              id={optionId(option.id)}
              role="option"
              aria-selected={index === activeIndex}
              data-selected={index === activeIndex}
              data-testid={optionId(option.id)}
              className={nestItemClassName}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(option.id)}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {currentParentId === option.id ? (
                <Check className="size-3.5 text-accent" aria-hidden="true" />
              ) : null}
            </button>
          ))}
          {hiddenCount > 0 ? (
            <p className="px-2 py-1.5 text-2xs text-faint">
              Showing the first {NEST_PICKER_LIMIT}. Refine your search to see more.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EditSession({
  doc,
  save,
  onStatusChange,
  collectionName,
  projectName,
  footer,
}: {
  readonly doc: Doc;
  readonly save: (patch: DocPatch) => Promise<unknown>;
  readonly onStatusChange: (status: SaveStatus) => void;
  readonly collectionName: string | null;
  readonly projectName: string | null;
  readonly footer?: React.ReactNode;
}) {
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const draft = useMemo(() => ({ title, content }), [title, content]);
  const autosave = useAutosave({
    value: draft,
    save,
    canSave: (next) => next.content.length <= DOC_CONTENT_LIMIT,
  });
  const flush = autosave.saveNow;
  const over = content.length > DOC_CONTENT_LIMIT;
  const near = content.length > NEAR_LIMIT;
  const settled = autosave.status === 'saved';
  const server = useRef({ title: doc.title, content: doc.content });
  const scroller = useRef<HTMLDivElement | null>(null);
  const outline = useEditorOutline(content, scroller);

  useEffect(() => onStatusChange(autosave.status), [autosave.status, onStatusChange]);
  useEffect(() => flush, [flush]);

  useEffect(() => {
    const incoming = { title: doc.title, content: doc.content };
    if (!adoptsRemoteEdit(settled, server.current, incoming)) return;
    server.current = incoming;
    setTitle(incoming.title);
    setContent(incoming.content);
  }, [doc.title, doc.content, settled]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1 px-6 pt-3 pb-1">
        <DocContextRow doc={doc} collectionName={collectionName} projectName={projectName} />
        <Input
          value={title}
          aria-label="Doc title"
          data-testid="doc-title-input"
          onChange={(event) => setTitle(event.target.value)}
          className="h-auto border-0 bg-transparent px-0 py-0 font-semibold text-text text-xl focus-visible:border-0"
        />
      </div>
      <DocEditor
        docId={doc.id}
        content={content}
        onChange={setContent}
        onForceSave={flush}
        footer={footer}
        scrollRef={scroller}
        outline={
          <div className="hidden shrink-0 pr-6 xl:block">
            <DocOutline
              headings={outline.headings}
              activeId={outline.activeId}
              onSelect={outline.goTo}
            />
          </div>
        }
      />
      {near ? (
        <p
          data-testid="doc-length-warning"
          className={cn(
            'shrink-0 border-border border-t px-6 py-2 text-2xs tabular-nums',
            over ? 'text-danger' : 'text-muted',
          )}
        >
          {over
            ? `This document is ${content.length.toLocaleString()} characters, past the ${DOC_CONTENT_LIMIT.toLocaleString()} limit. Nothing is being saved until it is shorter. Split it into linked pages.`
            : `${content.length.toLocaleString()} of ${DOC_CONTENT_LIMIT.toLocaleString()} characters.`}
        </p>
      ) : null}
    </div>
  );
}
