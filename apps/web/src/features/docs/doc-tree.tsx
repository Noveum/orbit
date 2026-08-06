'use client';

import { ChevronRight, FolderPlus, MoreHorizontal, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Collapsible } from '@/components/ui/collapsible.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { revealOnHover } from '@/lib/interaction.ts';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';
import { useSidebarDisclosure } from '@/lib/use-sidebar-disclosure.ts';
import { MatchedText } from './search-highlight.tsx';

const RECENT_MS = 24 * 60 * 60 * 1000;

export interface DocGroup {
  readonly id: string;
  readonly name: string;
  readonly collectionId: string | null;
  readonly docs: readonly DocSummary[];
}

export interface DocNode {
  readonly doc: DocSummary;
  readonly depth: number;
  readonly childCount: number;
}

export const MAX_TREE_DEPTH = 32;

export const PROJECT_GROUP_ID = 'project';
export const PRIVATE_GROUP_ID = 'private';

export function docDisclosureKey(docId: string): string {
  return `docs:page:${docId}`;
}

export function groupDisclosureKey(groupId: string): string {
  return `docs:group:${groupId}`;
}

export function groupIdOf(doc: DocSummary): string {
  if (doc.collectionId !== null) return doc.collectionId;
  return doc.projectId === null ? PRIVATE_GROUP_ID : PROJECT_GROUP_ID;
}

export function docTreeOf(
  docs: readonly DocSummary[],
  collapsed: ReadonlySet<string> = new Set(),
): DocNode[] {
  const present = new Set(docs.map((doc) => doc.id));
  const byParent = new Map<string, DocSummary[]>();
  const rootKey = '';

  for (const doc of docs) {
    const parent = doc.parentId !== null && present.has(doc.parentId) ? doc.parentId : rootKey;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(doc);
    byParent.set(parent, siblings);
  }

  const nodes: DocNode[] = [];
  const seen = new Set<string>();

  const walk = (parent: string, depth: number): void => {
    if (depth >= MAX_TREE_DEPTH) return;
    for (const doc of byParent.get(parent) ?? []) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const childCount = (byParent.get(doc.id) ?? []).length;
      nodes.push({ doc, depth, childCount });
      if (childCount > 0 && !collapsed.has(doc.id)) walk(doc.id, depth + 1);
    }
  };

  walk(rootKey, 0);
  return nodes;
}

export function ancestorsOf(docs: readonly DocSummary[], docId: string): string[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const chain: string[] = [];
  let cursor = byId.get(docId)?.parentId ?? null;
  let depth = 0;
  while (cursor !== null && depth < MAX_TREE_DEPTH) {
    chain.push(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
    depth += 1;
  }
  return chain;
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
    groups.push({
      id: PROJECT_GROUP_ID,
      name: 'Project docs',
      collectionId: null,
      docs: projectDocs,
    });
  }

  const privateDocs = docs.filter((doc) => doc.collectionId === null && doc.projectId === null);
  groups.push({
    id: PRIVATE_GROUP_ID,
    name: 'Private',
    collectionId: null,
    docs: privateDocs,
  });

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
  const iconClassName = cn(
    'flex size-5 items-center justify-center rounded-sm text-faint hover:bg-surface-2 hover:text-text',
    revealOnHover,
  );

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

function GroupHeader({
  group,
  open,
  draftName,
  canWrite,
  onToggle,
  onDraftChange,
  onSubmitRename,
  onCancelRename,
  onStartRename,
  onDelete,
}: {
  readonly group: DocGroup;
  readonly open: boolean;
  readonly draftName: string | null;
  readonly canWrite: boolean;
  readonly onToggle: () => void;
  readonly onDraftChange: (name: string) => void;
  readonly onSubmitRename: () => void;
  readonly onCancelRename: () => void;
  readonly onStartRename: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <div className="group flex h-6 items-center gap-1 px-2">
      {draftName === null ? (
        <button
          type="button"
          aria-expanded={open}
          data-testid={`doc-group-toggle-${group.id}`}
          onClick={onToggle}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left',
            'font-medium text-2xs text-faint uppercase tracking-wide',
            'transition-colors duration-[var(--duration-fast)] hover:text-muted',
          )}
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none',
              open ? 'rotate-90' : '',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{group.name}</span>
        </button>
      ) : (
        <Input
          autoFocus
          value={draftName}
          aria-label="Collection name"
          className="h-6 text-2xs"
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={onSubmitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmitRename();
            if (event.key === 'Escape') onCancelRename();
          }}
        />
      )}

      {canWrite ? (
        <GroupActions group={group} onRename={onStartRename} onDelete={onDelete} />
      ) : null}
    </div>
  );
}

export function DocSnippet({
  snippet,
  term,
  docId,
}: {
  readonly snippet: string;
  readonly term: string;
  readonly docId: string;
}) {
  if (snippet.length === 0) return null;
  return (
    <p
      data-testid={`doc-snippet-${docId}`}
      className="line-clamp-2 pr-2 pb-1 text-2xs text-faint leading-snug"
    >
      <MatchedText text={snippet} term={term} />
    </p>
  );
}

function DocRow({
  doc,
  depth,
  active,
  unsaved,
  recent,
  childCount,
  collapsed,
  term,
  onToggle,
  onNavigate,
}: {
  readonly doc: DocSummary;
  readonly depth: number;
  readonly active: boolean;
  readonly unsaved: boolean;
  readonly recent: boolean;
  readonly childCount: number;
  readonly collapsed: boolean;
  readonly term: string;
  readonly onToggle: () => void;
  readonly onNavigate: () => void;
}) {
  return (
    <div className="relative flex flex-col">
      <div className="relative flex items-center">
        {childCount > 0 ? (
          <button
            type="button"
            aria-label={collapsed ? `Expand ${doc.title}` : `Collapse ${doc.title}`}
            aria-expanded={!collapsed}
            data-testid={`doc-toggle-${doc.id}`}
            onClick={onToggle}
            style={{ left: `${depth * 0.75}rem` }}
            className="absolute z-10 flex size-4 items-center justify-center rounded-sm text-faint transition-colors duration-[var(--duration-instant)] hover:bg-surface-2 hover:text-text motion-reduce:transition-none"
          >
            <ChevronRight
              className={cn(
                'size-3 transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none',
                collapsed ? '' : 'rotate-90',
              )}
              aria-hidden="true"
            />
          </button>
        ) : null}
        <Link
          href={`/docs/${doc.id}`}
          data-testid={`doc-row-${doc.id}`}
          data-depth={depth}
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
          style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
          className={cn(
            'flex h-7 items-center gap-2 rounded-md pr-2 text-dense transition-colors duration-[var(--duration-fast)]',
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
      </div>
      <div style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}>
        <DocSnippet snippet={doc.snippet} term={term} docId={doc.id} />
      </div>
    </div>
  );
}

function SearchResults({
  docs,
  term,
  activeDocId,
  unsavedDocId,
  onNavigate,
}: {
  readonly docs: readonly DocSummary[];
  readonly term: string;
  readonly activeDocId: string | null;
  readonly unsavedDocId: string | null;
  readonly onNavigate: () => void;
}) {
  return (
    <section data-testid="doc-search-results" className="flex flex-col gap-0.5">
      <p className="px-2 font-medium text-2xs text-faint uppercase tracking-wide">
        {docs.length === 0 ? 'No matches' : 'Matches'}
      </p>
      {docs.map((doc) => (
        <DocRow
          key={doc.id}
          doc={doc}
          depth={0}
          childCount={0}
          collapsed={false}
          onToggle={() => undefined}
          active={activeDocId === doc.id}
          unsaved={unsavedDocId === doc.id}
          recent={false}
          term={term}
          onNavigate={onNavigate}
        />
      ))}
    </section>
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
  readonly onNavigate?: () => void;
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
  onNavigate = () => undefined,
}: DocTreeProps) {
  const searching = search.trim().length > 0;
  const groups = useMemo(
    () => (searching ? [] : groupDocs(docs, collections)),
    [docs, collections, searching],
  );
  const { isOpen, toggle, openAll } = useSidebarDisclosure();

  const collapsed = useMemo(
    () =>
      new Set(docs.filter((doc) => !isOpen(docDisclosureKey(doc.id), true)).map((doc) => doc.id)),
    [docs, isOpen],
  );

  const revealed = useRef<string | null>(null);

  useEffect(() => {
    if (activeDocId === null) {
      revealed.current = null;
      return;
    }
    const active = docs.find((doc) => doc.id === activeDocId);
    if (active === undefined) return;
    if (revealed.current === activeDocId) return;
    revealed.current = activeDocId;
    openAll([
      groupDisclosureKey(groupIdOf(active)),
      ...ancestorsOf(docs, activeDocId).map(docDisclosureKey),
    ]);
  }, [activeDocId, docs, openAll]);

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
    <div
      data-testid="doc-tree"
      className="flex h-full w-64 shrink-0 flex-col border-border border-r bg-surface"
    >
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

      <div data-testid="doc-tree-scroll" className="min-h-0 flex-1 overflow-y-auto">
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

          {searching ? (
            <SearchResults
              docs={docs}
              term={search}
              activeDocId={activeDocId}
              unsavedDocId={unsavedDocId}
              onNavigate={onNavigate}
            />
          ) : null}

          {groups.map((group) => {
            const groupKey = groupDisclosureKey(group.id);
            const open = isOpen(groupKey, true);
            return (
              <section key={group.id} className="flex flex-col gap-0.5">
                <GroupHeader
                  group={group}
                  open={open}
                  draftName={renaming?.id === group.id ? renaming.name : null}
                  canWrite={canWrite}
                  onToggle={() => toggle(groupKey, true)}
                  onDraftChange={(name) => setRenaming({ id: group.id, name })}
                  onSubmitRename={submitRename}
                  onCancelRename={() => setRenaming(null)}
                  onStartRename={() => setRenaming({ id: group.id, name: group.name })}
                  onDelete={() => onDeleteCollection(group.id)}
                />

                <Collapsible open={open} className="flex flex-col gap-0.5">
                  {group.docs.length === 0 ? (
                    <p className="px-2 py-1 text-2xs text-faint">Nothing here yet</p>
                  ) : (
                    docTreeOf(group.docs, collapsed).map((node) => (
                      <DocRow
                        key={node.doc.id}
                        doc={node.doc}
                        depth={node.depth}
                        childCount={node.childCount}
                        collapsed={collapsed.has(node.doc.id)}
                        onToggle={() => toggle(docDisclosureKey(node.doc.id), true)}
                        active={activeDocId === node.doc.id}
                        unsaved={unsavedDocId === node.doc.id}
                        recent={now - new Date(node.doc.updatedAt).getTime() < RECENT_MS}
                        term={search}
                        onNavigate={onNavigate}
                      />
                    ))
                  )}
                </Collapsible>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
