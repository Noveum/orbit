'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  FolderPlus,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import type { DocCollection, DocSummary } from '@/lib/query/schemas.ts';
import { useSidebarDisclosure } from '@/lib/use-sidebar-disclosure.ts';
import type { DocMove } from './doc-drop.ts';
import type { DocRowActions } from './doc-row-menu.tsx';
import { DocSearchResults } from './doc-search-results.tsx';
import {
  ancestorsOf,
  collapsibleKeys,
  type DocGroup,
  docDisclosureKey,
  docTreeOf,
  groupDisclosureKey,
  groupDocs,
  groupIdOf,
} from './doc-tree-model.ts';
import { FolderRow, folderActionClassName, PageRow } from './doc-tree-rows.tsx';
import { useDocDrag } from './use-doc-drag.ts';

export {
  ancestorsOf,
  docDisclosureKey,
  docTreeOf,
  groupDisclosureKey,
  groupDocs,
  groupIdOf,
  MAX_TREE_DEPTH,
  PRIVATE_GROUP_ID,
  PROJECT_GROUP_ID,
} from './doc-tree-model.ts';

export interface DocTreeProps {
  readonly docs: readonly DocSummary[];
  readonly collections: readonly DocCollection[];
  readonly activeDocId: string | null;
  readonly unsavedDocId: string | null;
  readonly search: string;
  readonly searching: boolean;
  readonly onSearchChange: (value: string) => void;
  readonly onCreateCollection: (name: string) => void;
  readonly onRenameCollection: (id: string, name: string) => void;
  readonly onDeleteCollection: (id: string) => void;
  readonly onCreateDoc: (collectionId: string | null) => void;
  readonly onMoveDoc: (move: DocMove) => void;
  readonly actions?: DocRowActions;
  readonly onRenameDoc?: (docId: string, title: string) => void;
  readonly canWrite: boolean;
  readonly footer?: React.ReactNode;
  readonly onNavigate?: () => void;
}

function CollectionActions({
  group,
  className,
  onRename,
  onDelete,
}: {
  readonly group: DocGroup;
  readonly className: string;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  if (group.collectionId === null) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Manage ${group.name}`}
        className={cn(
          'flex size-5 items-center justify-center rounded-sm text-faint hover:bg-surface-2 hover:text-text data-[state=open]:opacity-100',
          className,
        )}
      >
        <MoreHorizontal className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>Rename folder</DropdownMenuItem>
        <DropdownMenuItem
          className="text-danger data-[highlighted]:text-danger"
          onSelect={onDelete}
        >
          Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DocTree({
  docs,
  collections,
  activeDocId,
  unsavedDocId,
  search,
  searching,
  onSearchChange,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onCreateDoc,
  onMoveDoc,
  actions,
  onRenameDoc,
  canWrite,
  footer,
  onNavigate = () => undefined,
}: DocTreeProps) {
  const showingResults = search.trim().length > 0;
  const groups = useMemo(
    () => (showingResults ? [] : groupDocs(docs, collections)),
    [docs, collections, showingResults],
  );
  const { isOpen, toggle, openAll, setAll } = useSidebarDisclosure();

  const collapsed = useMemo(
    () =>
      new Set(docs.filter((doc) => !isOpen(docDisclosureKey(doc.id), true)).map((doc) => doc.id)),
    [docs, isOpen],
  );

  const disclosureKeys = useMemo(
    () =>
      collapsibleKeys(
        groups.map((group) => group.id),
        docs,
      ),
    [groups, docs],
  );
  const anyOpen = disclosureKeys.some((key) => isOpen(key, true));

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
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);

  const drag = useDocDrag(docs, onMoveDoc);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const dragged = docs.find((doc) => doc.id === drag.activeId);

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
        <Tooltip label={anyOpen ? 'Collapse everything' : 'Expand everything'} side="bottom">
          <Button
            variant="ghost"
            size="sm"
            aria-label={anyOpen ? 'Collapse everything' : 'Expand everything'}
            aria-expanded={anyOpen}
            data-testid="toggle-all-folders"
            onClick={() => setAll(disclosureKeys, !anyOpen)}
            className="size-8 shrink-0 px-0"
          >
            {anyOpen ? (
              <ChevronsDownUp className="size-4" aria-hidden="true" />
            ) : (
              <ChevronsUpDown className="size-4" aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
        {canWrite ? (
          <Tooltip label="New folder" side="bottom">
            <Button
              variant="ghost"
              size="sm"
              aria-label="New folder"
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
        <div className="flex flex-col gap-2 p-2">
          {draftName === null ? null : (
            <Input
              autoFocus
              value={draftName}
              placeholder="Folder name"
              aria-label="Folder name"
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

          {showingResults ? (
            <DocSearchResults
              docs={docs}
              term={search}
              collections={collections}
              searching={searching}
              activeDocId={activeDocId}
              onNavigate={onNavigate}
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={drag.onDragStart}
              onDragMove={drag.onDragMove}
              onDragEnd={drag.onDragEnd}
              onDragCancel={drag.onDragCancel}
            >
              {groups.map((group) => {
                const groupKey = groupDisclosureKey(group.id);
                const open = isOpen(groupKey, true);
                return (
                  <FolderRow
                    key={group.id}
                    group={group}
                    open={open}
                    count={group.docs.length}
                    canWrite={canWrite}
                    hint={drag.hint}
                    onToggle={() => toggle(groupKey, true)}
                    onCreate={() => onCreateDoc(group.collectionId)}
                    actions={
                      <CollectionActions
                        group={group}
                        className={folderActionClassName}
                        onRename={() => setRenaming({ id: group.id, name: group.name })}
                        onDelete={() => onDeleteCollection(group.id)}
                      />
                    }
                  >
                    {renaming?.id === group.id ? (
                      <Input
                        autoFocus
                        value={renaming.name}
                        aria-label="Folder name"
                        className="mx-2 h-7 text-dense"
                        onChange={(event) =>
                          setRenaming({ id: group.id, name: event.target.value })
                        }
                        onBlur={submitRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') submitRename();
                          if (event.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : null}

                    {group.docs.length === 0 ? (
                      <p className="px-2 py-1 pl-7 text-2xs text-faint">Nothing here yet</p>
                    ) : (
                      docTreeOf(group.docs, collapsed).map((node) => (
                        <PageRow
                          key={node.doc.id}
                          doc={node.doc}
                          depth={node.depth}
                          childCount={node.childCount}
                          collapsed={collapsed.has(node.doc.id)}
                          active={activeDocId === node.doc.id}
                          unsaved={unsavedDocId === node.doc.id}
                          draggable={canWrite}
                          hint={drag.hint}
                          onToggle={() => toggle(docDisclosureKey(node.doc.id), true)}
                          onNavigate={onNavigate}
                          renaming={renamingDocId === node.doc.id}
                          onRenameSubmit={(title) => {
                            setRenamingDocId(null);
                            const next = title.trim();
                            if (next.length > 0 && next !== node.doc.title) {
                              onRenameDoc?.(node.doc.id, next);
                            }
                          }}
                          onRenameCancel={() => setRenamingDocId(null)}
                          {...(actions === undefined
                            ? {}
                            : {
                                menu: {
                                  collections,
                                  actions: {
                                    ...actions,
                                    onRename: (doc) => setRenamingDocId(doc.id),
                                  },
                                },
                              })}
                        />
                      ))
                    )}
                  </FolderRow>
                );
              })}

              <DragOverlay dropAnimation={null}>
                {dragged === undefined ? null : (
                  <span className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-dense text-text shadow-pop">
                    <FileText className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
                    <span className="max-w-48 truncate">{dragged.title}</span>
                  </span>
                )}
              </DragOverlay>
            </DndContext>
          )}

          {showingResults ? null : footer}
        </div>
      </div>
    </div>
  );
}
