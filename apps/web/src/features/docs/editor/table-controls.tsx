'use client';

import type { Editor } from '@tiptap/core';
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  FoldHorizontal,
  FoldVertical,
  PanelTop,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn.ts';

export interface TableCommand {
  readonly id: string;
  readonly label: string;
  readonly icon: typeof Trash2;
  readonly run: (editor: Editor) => void;
}

export const TABLE_COMMANDS: readonly TableCommand[] = [
  {
    id: 'row-before',
    label: 'Insert row above',
    icon: BetweenHorizontalStart,
    run: (editor) => editor.chain().focus().addRowBefore().run(),
  },
  {
    id: 'row-after',
    label: 'Insert row below',
    icon: BetweenHorizontalEnd,
    run: (editor) => editor.chain().focus().addRowAfter().run(),
  },
  {
    id: 'row-delete',
    label: 'Delete row',
    icon: FoldVertical,
    run: (editor) => editor.chain().focus().deleteRow().run(),
  },
  {
    id: 'column-before',
    label: 'Insert column left',
    icon: BetweenVerticalStart,
    run: (editor) => editor.chain().focus().addColumnBefore().run(),
  },
  {
    id: 'column-after',
    label: 'Insert column right',
    icon: BetweenVerticalEnd,
    run: (editor) => editor.chain().focus().addColumnAfter().run(),
  },
  {
    id: 'column-delete',
    label: 'Delete column',
    icon: FoldHorizontal,
    run: (editor) => editor.chain().focus().deleteColumn().run(),
  },
  {
    id: 'header-row',
    label: 'Toggle header row',
    icon: PanelTop,
    run: (editor) => editor.chain().focus().toggleHeaderRow().run(),
  },
  {
    id: 'delete',
    label: 'Delete table',
    icon: Trash2,
    run: (editor) => editor.chain().focus().deleteTable().run(),
  },
];

export interface TableAnchor {
  readonly left: number;
  readonly top: number;
}

export interface TableControlsProps {
  readonly editor: Editor | null;
  readonly anchor: TableAnchor | null;
  readonly testId: string;
}

export function TableControls({ editor, anchor, testId }: TableControlsProps) {
  if (editor === null || anchor === null) return null;
  const { left, top } = anchor;

  return (
    <div
      role="toolbar"
      aria-label="Table controls"
      data-testid={testId}
      style={{ left: `${left}px`, top: `${top}px` }}
      className="absolute z-30 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-pop"
    >
      {TABLE_COMMANDS.map((command) => (
        <button
          key={command.id}
          type="button"
          aria-label={command.label}
          title={command.label}
          data-testid={`${testId}-${command.id}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command.run(editor)}
          className={cn(
            'flex size-7 items-center justify-center rounded-sm text-muted',
            'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
            'hover:bg-surface-2 hover:text-text',
            command.id === 'delete' && 'hover:text-danger',
          )}
        >
          <command.icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
