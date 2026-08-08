'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronRight, FileText, Folder, FolderOpen, Lock, Plus } from 'lucide-react';
import Link from 'next/link';
import { Collapsible } from '@/components/ui/collapsible.tsx';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/cn.ts';
import { revealOnHover } from '@/lib/interaction.ts';
import type { DocSummary } from '@/lib/query/schemas.ts';
import type { DropEdge } from './doc-drop.ts';
import type { DocRowMenuProps } from './doc-row-menu.tsx';
import { DocRowMenu } from './doc-row-menu.tsx';
import { type DocGroup, PRIVATE_GROUP_ID } from './doc-tree-model.ts';

export const DOC_DRAG_PREFIX = 'doc:';
export const GROUP_DRAG_PREFIX = 'group:';

export const folderActionClassName = revealOnHover;

export interface DropHint {
  readonly targetId: string;
  readonly edge: DropEdge;
}

function glyphFor(groupId: string, open: boolean) {
  if (groupId === PRIVATE_GROUP_ID) return Lock;
  return open ? FolderOpen : Folder;
}

function indentFor(depth: number): string {
  return `${0.5 + depth * 0.75}rem`;
}

function DropLine({ edge }: { readonly edge: 'above' | 'below' }) {
  return (
    <span
      aria-hidden="true"
      data-testid={`doc-drop-line-${edge}`}
      className={cn(
        'pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-accent',
        edge === 'above' ? '-top-px' : '-bottom-px',
      )}
    />
  );
}

export interface FolderRowProps {
  readonly group: DocGroup;
  readonly open: boolean;
  readonly count: number;
  readonly canWrite: boolean;
  readonly hint: DropHint | null;
  readonly onToggle: () => void;
  readonly onCreate: () => void;
  readonly children: React.ReactNode;
  readonly actions?: React.ReactNode;
}

export function FolderRow({
  group,
  open,
  count,
  canWrite,
  hint,
  onToggle,
  onCreate,
  children,
  actions,
}: FolderRowProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${GROUP_DRAG_PREFIX}${group.id}`,
    disabled: !group.droppable,
  });
  const nesting = isOver && hint?.targetId === group.id;
  const Glyph = glyphFor(group.id, open);

  return (
    <section className="flex flex-col gap-0.5" data-testid={`doc-folder-${group.id}`}>
      <div
        ref={setNodeRef}
        className={cn(
          'group relative flex h-7 items-center gap-1 rounded-md px-2',
          'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
          nesting ? 'bg-accent-soft ring-1 ring-accent' : '',
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          data-testid={`doc-group-toggle-${group.id}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-3 shrink-0 text-faint transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none',
              open ? 'rotate-90' : '',
            )}
          />
          <Glyph className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium text-dense">{group.name}</span>
          <span data-numeric className="shrink-0 text-2xs text-faint">
            {count}
          </span>
        </button>

        {canWrite ? (
          <>
            <button
              type="button"
              aria-label={`New doc in ${group.name}`}
              data-testid={`new-doc-in-${group.id}`}
              onClick={onCreate}
              className={cn(
                'flex size-5 items-center justify-center rounded-sm text-faint hover:bg-surface-2 hover:text-text',
                revealOnHover,
              )}
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
            {actions}
          </>
        ) : null}
      </div>

      <Collapsible open={open} className="flex flex-col gap-0.5">
        {children}
      </Collapsible>
    </section>
  );
}

export interface PageRowProps {
  readonly doc: DocSummary;
  readonly depth: number;
  readonly childCount: number;
  readonly collapsed: boolean;
  readonly active: boolean;
  readonly unsaved: boolean;
  readonly draggable: boolean;
  readonly hint: DropHint | null;
  readonly onToggle: () => void;
  readonly onNavigate: () => void;
  readonly menu?: Omit<DocRowMenuProps, 'doc'>;
  readonly renaming: boolean;
  readonly onRenameSubmit: (title: string) => void;
  readonly onRenameCancel: () => void;
}

function RenameRow({
  doc,
  depth,
  onSubmit,
  onCancel,
}: {
  readonly doc: DocSummary;
  readonly depth: number;
  readonly onSubmit: (title: string) => void;
  readonly onCancel: () => void;
}) {
  return (
    <div style={{ paddingLeft: indentFor(depth) }} className="pr-1">
      <Input
        autoFocus
        defaultValue={doc.title}
        aria-label={`Rename ${doc.title}`}
        data-testid={`doc-rename-input-${doc.id}`}
        className="h-7 text-dense"
        onBlur={(event) => onSubmit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit(event.currentTarget.value);
          if (event.key === 'Escape') onCancel();
        }}
      />
    </div>
  );
}

function DisclosureButton({
  doc,
  depth,
  collapsed,
  onToggle,
}: {
  readonly doc: DocSummary;
  readonly depth: number;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}) {
  return (
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
        aria-hidden="true"
        className={cn(
          'size-3 transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none',
          collapsed ? '' : 'rotate-90',
        )}
      />
    </button>
  );
}

export function PageRow(props: PageRowProps) {
  if (props.renaming) {
    return (
      <RenameRow
        doc={props.doc}
        depth={props.depth}
        onSubmit={props.onRenameSubmit}
        onCancel={props.onRenameCancel}
      />
    );
  }
  return <DraggablePageRow {...props} />;
}

function DraggablePageRow({
  doc,
  depth,
  childCount,
  collapsed,
  active,
  unsaved,
  draggable,
  hint,
  onToggle,
  onNavigate,
  menu,
}: PageRowProps) {
  const id = `${DOC_DRAG_PREFIX}${doc.id}`;
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    disabled: !draggable,
  });
  const edge = isOver && hint?.targetId === doc.id ? hint.edge : null;

  return (
    <div
      ref={setDropRef}
      className={cn('relative flex flex-col', isDragging ? 'opacity-40' : '')}
      data-testid={`doc-row-wrap-${doc.id}`}
    >
      {edge === 'above' ? <DropLine edge="above" /> : null}
      <div className="group relative flex items-center">
        {childCount > 0 ? (
          <DisclosureButton doc={doc} depth={depth} collapsed={collapsed} onToggle={onToggle} />
        ) : null}

        <Link
          ref={setNodeRef}
          href={`/docs/${doc.id}`}
          data-testid={`doc-row-${doc.id}`}
          data-depth={depth}
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
          style={{ paddingLeft: indentFor(depth) }}
          className={cn(
            'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-1 text-dense',
            'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
            draggable ? 'cursor-grab active:cursor-grabbing' : '',
            edge === 'inside' ? 'bg-accent-soft ring-1 ring-accent' : '',
            active
              ? 'bg-accent-soft font-medium text-accent'
              : 'text-muted hover:bg-surface-2 hover:text-text',
          )}
          {...attributes}
          {...listeners}
        >
          <FileText
            className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{doc.title}</span>
          {unsaved ? (
            <span
              aria-hidden="true"
              title="Unsaved changes"
              className="size-1.5 shrink-0 rounded-full bg-warning"
            />
          ) : null}
        </Link>

        {menu === undefined ? null : <DocRowMenu doc={doc} className={revealOnHover} {...menu} />}
      </div>
      {edge === 'below' ? <DropLine edge="below" /> : null}
    </div>
  );
}
