import type { Editor } from '@tiptap/core';
import {
  ChevronRight,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Info,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Table2,
  TriangleAlert,
} from 'lucide-react';
import { CALLOUT_LABEL } from './markdown.ts';

export interface SlashCommand {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly icon: typeof List;
  readonly run: (editor: Editor, pickImage: () => void) => void;
}

function callout(tone: 'note' | 'tip' | 'warning' | 'danger', icon: typeof Info): SlashCommand {
  return {
    id: `callout-${tone}`,
    label: `${CALLOUT_LABEL[tone]} callout`,
    hint: 'Highlighted block',
    icon,
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'callout',
          attrs: { tone },
          content: [{ type: 'paragraph' }],
        })
        .run();
    },
  };
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'heading-1',
    label: 'Heading 1',
    hint: 'Big section title',
    icon: Heading1,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'heading-2',
    label: 'Heading 2',
    hint: 'Section title',
    icon: Heading2,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'heading-3',
    label: 'Heading 3',
    hint: 'Subsection title',
    icon: Heading3,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet-list',
    label: 'Bulleted list',
    hint: 'Simple list',
    icon: List,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered-list',
    label: 'Numbered list',
    hint: 'Ordered steps',
    icon: ListOrdered,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task-list',
    label: 'Task list',
    hint: 'Checkboxes',
    icon: ListChecks,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'code-block',
    label: 'Code block',
    hint: 'Syntax highlighted',
    icon: Code2,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Block quote',
    icon: Quote,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  callout('note', Info),
  callout('warning', TriangleAlert),
  {
    id: 'toggle',
    label: 'Toggle',
    hint: 'Collapsible section',
    icon: ChevronRight,
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'toggleBlock',
          content: [
            { type: 'toggleSummary', content: [{ type: 'text', text: 'Details' }] },
            { type: 'paragraph' },
          ],
        })
        .run();
    },
  },
  {
    id: 'table',
    label: 'Table',
    hint: '3 by 3 with a header',
    icon: Table2,
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'Horizontal rule',
    icon: Minus,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'image',
    label: 'Image or file',
    hint: 'Upload an attachment',
    icon: ImageIcon,
    run: (_editor, pickImage) => pickImage(),
  },
];

export function matchSlashCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) ||
      command.id.includes(needle.replace(/\s/g, '')),
  );
}

export interface TriggerMatch {
  readonly kind: 'slash' | 'mention';
  readonly query: string;
  readonly from: number;
}

const TRIGGER = /(^|\s)([/@])([\w-]*)$/;

export function findTrigger(textBefore: string, caret: number): TriggerMatch | null {
  const match = TRIGGER.exec(textBefore);
  if (match === null) return null;
  const lead = match[1] ?? '';
  const char = match[2];
  const query = match[3] ?? '';
  if (char === undefined) return null;
  return {
    kind: char === '/' ? 'slash' : 'mention',
    query,
    from: caret - (match[0].length - lead.length),
  };
}
