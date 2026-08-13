'use client';

import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  ChevronDown,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Info,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  OctagonAlert,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  TriangleAlert,
  Type,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { CALLOUT_LABEL, type CalloutTone } from './markdown.ts';

type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'other';

const BLOCK_OPTIONS: readonly {
  kind: Exclude<BlockKind, 'other'>;
  label: string;
  icon: LucideIcon;
}[] = [
  { kind: 'paragraph', label: 'Text', icon: Type },
  { kind: 'h1', label: 'Heading 1', icon: Heading1 },
  { kind: 'h2', label: 'Heading 2', icon: Heading2 },
  { kind: 'h3', label: 'Heading 3', icon: Heading3 },
];

const CALLOUT_ICON: Record<CalloutTone, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  warning: TriangleAlert,
  danger: OctagonAlert,
};

function blockKindOf(editor: Editor): BlockKind {
  if (editor.isActive('heading', { level: 1 })) return 'h1';
  if (editor.isActive('heading', { level: 2 })) return 'h2';
  if (editor.isActive('heading', { level: 3 })) return 'h3';
  if (editor.isActive('paragraph')) return 'paragraph';
  return 'other';
}

function insertCallout(editor: Editor, tone: CalloutTone): void {
  editor
    .chain()
    .focus()
    .insertContent({ type: 'callout', attrs: { tone }, content: [{ type: 'paragraph' }] })
    .run();
}

export interface EditorToolbarProps {
  readonly editor: Editor;
  readonly onPickFile: () => void;
  readonly canUpload?: boolean;
  readonly compact?: boolean;
  readonly className?: string;
  readonly testId?: string;
  readonly leading?: ReactNode | undefined;
  readonly trailing?: ReactNode | undefined;
  readonly collapsed?: boolean;
}

export function EditorToolbar({
  editor,
  onPickFile,
  canUpload = false,
  compact = false,
  collapsed = false,
  className,
  testId = 'editor-toolbar',
  leading,
  trailing,
}: EditorToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      canUndo: instance.can().undo(),
      canRedo: instance.can().redo(),
      hasSelection: !instance.state.selection.empty,
      bold: instance.isActive('bold'),
      italic: instance.isActive('italic'),
      underline: instance.isActive('underline'),
      strike: instance.isActive('strike'),
      code: instance.isActive('code'),
      highlight: instance.isActive('highlight'),
      bulletList: instance.isActive('bulletList'),
      orderedList: instance.isActive('orderedList'),
      taskList: instance.isActive('taskList'),
      blockquote: instance.isActive('blockquote'),
      codeBlock: instance.isActive('codeBlock'),
      link: instance.isActive('link'),
      block: blockKindOf(instance),
    }),
  });

  const current = BLOCK_OPTIONS.find((option) => option.kind === state.block);

  const setBlock = (kind: Exclude<BlockKind, 'other'>) => {
    const chain = editor.chain().focus();
    if (kind === 'paragraph') chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(kind.slice(1)) as 1 | 2 | 3 }).run();
  };

  return (
    <TooltipProvider>
      <div
        data-testid={testId}
        className={cn(
          'flex flex-wrap items-center gap-0.5',
          compact
            ? 'text-muted'
            : 'sticky top-0 z-20 border-border border-b bg-surface/95 px-2 py-1 backdrop-blur-sm',
          className,
        )}
      >
        {leading === undefined ? null : (
          <>
            {leading}
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          </>
        )}
        {compact || collapsed ? null : (
          <>
            <ToolbarButton
              label="Undo"
              shortcut={['mod', 'z']}
              icon={Undo2}
              disabled={!state.canUndo}
              onPress={() => editor.chain().focus().undo().run()}
            />
            <ToolbarButton
              label="Redo"
              shortcut={['mod', 'shift', 'z']}
              icon={Redo2}
              disabled={!state.canRedo}
              onPress={() => editor.chain().focus().redo().run()}
            />

            <Divider />

            <DropdownMenu>
              <Tooltip label="Text style" side="bottom">
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-1.5"
                    data-testid={`${testId}-block`}
                    aria-label="Text style"
                  >
                    {current ? <current.icon className="size-3.5" aria-hidden="true" /> : null}
                    <span className="text-2xs">{current?.label ?? 'Style'}</span>
                    <ChevronDown className="size-3 text-faint" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="start" className="min-w-40">
                {BLOCK_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.kind}
                    data-testid={`${testId}-block-${option.kind}`}
                    aria-current={state.block === option.kind}
                    onSelect={() => setBlock(option.kind)}
                    className={cn(state.block === option.kind && 'text-text')}
                  >
                    <option.icon className="size-3.5" aria-hidden="true" />
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Divider />
          </>
        )}

        <ToolbarButton
          label="Bold"
          shortcut={['mod', 'b']}
          icon={Bold}
          active={state.bold}
          onPress={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          shortcut={['mod', 'i']}
          icon={Italic}
          active={state.italic}
          onPress={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Strikethrough"
          icon={Strikethrough}
          active={state.strike}
          onPress={() => editor.chain().focus().toggleStrike().run()}
        />
        {compact ? null : (
          <ToolbarButton
            label="Underline"
            shortcut={['mod', 'u']}
            icon={UnderlineIcon}
            active={state.underline}
            onPress={() => editor.chain().focus().toggleUnderline().run()}
          />
        )}
        {compact ? null : (
          <ToolbarButton
            label="Highlight"
            icon={Highlighter}
            active={state.highlight}
            onPress={() => editor.chain().focus().toggleHighlight().run()}
          />
        )}
        <ToolbarButton
          label="Inline code"
          icon={Code}
          active={state.code}
          onPress={() => editor.chain().focus().toggleCode().run()}
        />

        <Divider />

        <ToolbarButton
          label="Bulleted list"
          icon={List}
          active={state.bulletList}
          onPress={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbered list"
          icon={ListOrdered}
          active={state.orderedList}
          onPress={() => editor.chain().focus().toggleOrderedList().run()}
        />
        {compact ? null : (
          <ToolbarButton
            label="Task list"
            icon={ListChecks}
            active={state.taskList}
            onPress={() => editor.chain().focus().toggleTaskList().run()}
          />
        )}

        <Divider />

        <ToolbarButton
          label="Quote"
          icon={Quote}
          active={state.blockquote}
          onPress={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label="Code block"
          icon={Code2}
          active={state.codeBlock}
          onPress={() => editor.chain().focus().toggleCodeBlock().run()}
        />

        {compact ? null : (
          <>
            <DropdownMenu>
              <Tooltip label="Callout" side="bottom">
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 px-0"
                    data-testid={`${testId}-callout`}
                    aria-label="Callout"
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="start" className="min-w-40">
                {(Object.keys(CALLOUT_LABEL) as CalloutTone[]).map((tone) => {
                  const Icon = CALLOUT_ICON[tone];
                  return (
                    <DropdownMenuItem
                      key={tone}
                      data-testid={`${testId}-callout-${tone}`}
                      onSelect={() => insertCallout(editor, tone)}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                      {CALLOUT_LABEL[tone]}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <ToolbarButton
              label="Table"
              icon={Table2}
              onPress={() =>
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              }
            />
            <ToolbarButton
              label="Divider"
              icon={Minus}
              onPress={() => editor.chain().focus().setHorizontalRule().run()}
            />
          </>
        )}

        {canUpload ? (
          <>
            {compact ? <Divider /> : null}
            <ToolbarButton
              label="Attach image or file"
              icon={Paperclip}
              onPress={onPickFile}
              testId={`${testId}-attach`}
            />
          </>
        ) : null}

        <Divider />

        <LinkControl
          editor={editor}
          active={state.link}
          enabled={state.hasSelection || state.link}
          testId={testId}
        />
        {trailing === undefined ? null : <span className="ml-auto">{trailing}</span>}
      </div>
    </TooltipProvider>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

interface ToolbarButtonProps {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onPress: () => void;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly shortcut?: readonly string[];
  readonly testId?: string;
}

function ToolbarButton({
  label,
  icon: Icon,
  onPress,
  active,
  disabled,
  shortcut,
  testId,
}: ToolbarButtonProps) {
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors duration-[var(--duration-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-accent-soft text-accent'
          : 'text-muted not-disabled:hover:bg-surface-2 not-disabled:hover:text-text',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
  return (
    <Tooltip label={label} side="bottom" {...(shortcut ? { shortcut } : {})}>
      {button}
    </Tooltip>
  );
}

function LinkControl({
  editor,
  active,
  enabled,
  testId,
}: {
  readonly editor: Editor;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly testId: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('https://');

  const apply = () => {
    const url = href.trim();
    setOpen(false);
    if (url.length === 0) return;
    editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={active ? 'Edit link' : 'Link'} shortcut={['mod', 'k']} side="bottom">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Link"
            aria-pressed={active}
            disabled={!enabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setHref(String(editor.getAttributes('link')['href'] ?? 'https://'))}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-sm transition-colors duration-[var(--duration-fast)]',
              'disabled:cursor-not-allowed disabled:opacity-40',
              active
                ? 'bg-accent-soft text-accent'
                : 'text-muted not-disabled:hover:bg-surface-2 not-disabled:hover:text-text',
            )}
          >
            <Link2 className="size-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="w-64">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <input
            value={href}
            aria-label="Link URL"
            data-testid={`${testId}-link-input`}
            onChange={(event) => setHref(event.target.value)}
            className="h-7 flex-1 rounded-sm border border-border bg-surface-2 px-2 text-2xs text-text outline-none focus-visible:border-accent"
          />
          <Button type="submit" variant="primary" size="sm">
            Apply
          </Button>
          {active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                editor.chain().focus().unsetLink().run();
              }}
            >
              Remove
            </Button>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
