'use client';

import { renderMarkdown } from '@orbit/services/markdown';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { Bold, Code, Italic, Link2, Strikethrough } from 'lucide-react';
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/cn.ts';
import type { Member } from '@/lib/query/schemas.ts';
import { docProseClassName } from '../doc-body.tsx';
import { findTrigger, matchSlashCommands, type SlashCommand } from './commands.ts';
import {
  editorExtensions,
  type MenuKey,
  type MenuKeyHandlerRef,
  toEditorHtml,
} from './extensions.ts';
import { docToMarkdown } from './markdown.ts';
import { editorSurfaceClassName } from './styles.ts';

export interface UploadedAttachment {
  readonly url: string;
  readonly fileName: string;
  readonly contentType: string;
}

export interface RichTextEditorProps {
  readonly value: string;
  readonly onChange: (markdown: string) => void;
  readonly members?: readonly Member[];
  readonly placeholder?: string;
  readonly testId?: string;
  readonly className?: string;
  readonly autoFocus?: boolean;
  readonly ariaLabel: string;
  readonly onSubmit?: () => void;
  readonly onForceSave?: () => void;
  readonly onCancel?: () => void;
  readonly onReady?: (editor: Editor) => void;
  readonly onUpload?: (file: File) => Promise<UploadedAttachment>;
}

interface MenuPosition {
  readonly left: number;
  readonly top: number;
}

interface MenuState {
  readonly kind: 'slash' | 'mention';
  readonly from: number;
  readonly query: string;
  readonly position: MenuPosition;
}

function textBeforeCaret(editor: Editor): string {
  const { state } = editor;
  const { from, empty } = state.selection;
  if (!empty) return '';
  const start = state.selection.$from.start();
  return state.doc.textBetween(start, from, '\n', '\0');
}

function caretPosition(editor: Editor, at: number, container: HTMLElement | null): MenuPosition {
  if (container === null) return { left: 0, top: 0 };
  const coords = editor.view.coordsAtPos(at);
  const box = container.getBoundingClientRect();
  return { left: coords.left - box.left, top: coords.bottom - box.top + 6 };
}

export function RichTextEditor({
  value,
  onChange,
  members = [],
  placeholder = 'Write. Press / for blocks and @ to mention.',
  testId = 'rich-editor',
  className,
  autoFocus = false,
  ariaLabel,
  onSubmit,
  onForceSave,
  onCancel,
  onReady,
  onUpload,
}: RichTextEditorProps) {
  const containerRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emitted = useRef<Set<string>>(new Set([value]));
  const menuRef = useRef<MenuState | null>(null);
  const highlightRef = useRef(0);
  const keyHandler = useRef<(key: MenuKey) => boolean>(() => false);
  const menuKeyRef: MenuKeyHandlerRef = useRef((key: MenuKey) => keyHandler.current(key));

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [bubble, setBubble] = useState<MenuPosition | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const listId = useId();
  const optionPrefix = useId();

  const items = useMemo((): readonly SlashCommand[] | readonly Member[] => {
    if (menu === null) return [];
    if (menu.kind === 'slash') return matchSlashCommands(menu.query);
    const needle = menu.query.toLowerCase();
    return members
      .filter(
        (member) =>
          member.name.toLowerCase().includes(needle) ||
          (member.handle ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [menu, members]);

  const closeMenu = useCallback(() => {
    menuRef.current = null;
    highlightRef.current = 0;
    setMenu(null);
    setHighlight(0);
  }, []);

  const editor = useEditor({
    extensions: editorExtensions(menuKeyRef, placeholder),
    content: toEditorHtml(renderMarkdown(value)),
    immediatelyRender: false,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: instance }) => {
      const markdown = docToMarkdown(instance.getJSON());
      if (emitted.current.size > 64) emitted.current.clear();
      emitted.current.add(markdown);
      onChange(markdown);
    },
  });

  useEffect(() => {
    if (editor === null) return;
    if (emitted.current.has(value)) return;
    if (docToMarkdown(editor.getJSON()) === value) return;
    emitted.current.add(value);
    editor.commands.setContent(toEditorHtml(renderMarkdown(value)), { emitUpdate: false });
  }, [editor, value]);

  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    if (editor !== null) ready.current?.(editor);
  }, [editor]);

  useEffect(() => {
    if (editor === null) return;

    const sync = () => {
      const before = textBeforeCaret(editor);
      const trigger = findTrigger(before, editor.state.selection.from);
      const next =
        trigger === null
          ? null
          : {
              kind: trigger.kind,
              from: trigger.from,
              query: trigger.query,
              position: caretPosition(editor, trigger.from, containerRef.current),
            };
      menuRef.current = next;
      setMenu(next);
      if (next === null) {
        highlightRef.current = 0;
        setHighlight(0);
      }

      const { from, to, empty } = editor.state.selection;
      if (empty || editor.isActive('codeBlock')) {
        setBubble(null);
        setLink(null);
        return;
      }
      const container = containerRef.current;
      if (container === null) return;
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const box = container.getBoundingClientRect();
      setBubble({
        left: (start.left + end.left) / 2 - box.left,
        top: start.top - box.top - 44,
      });
    };

    editor.on('selectionUpdate', sync);
    editor.on('update', sync);
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('update', sync);
    };
  }, [editor]);

  const runUpload = useCallback(
    async (files: readonly File[]) => {
      if (editor === null || onUpload === undefined || files.length === 0) return;
      setUploading(true);
      try {
        for (const file of files) {
          const uploaded = await onUpload(file);
          if (uploaded.contentType.startsWith('image/')) {
            editor.chain().focus().setImage({ src: uploaded.url, alt: uploaded.fileName }).run();
          } else {
            editor
              .chain()
              .focus()
              .insertContent([
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: uploaded.fileName,
                      marks: [{ type: 'link', attrs: { href: uploaded.url } }],
                    },
                  ],
                },
              ])
              .run();
          }
        }
      } finally {
        setUploading(false);
      }
    },
    [editor, onUpload],
  );

  const applyItem = useCallback(
    (index: number) => {
      const state = menuRef.current;
      if (editor === null || state === null) return;
      const chosen = items[index];
      if (chosen === undefined) return;

      editor
        .chain()
        .focus()
        .deleteRange({ from: state.from, to: editor.state.selection.from })
        .run();
      closeMenu();

      if (state.kind === 'slash') {
        (chosen as SlashCommand).run(editor, () => fileRef.current?.click());
        return;
      }
      const member = chosen as Member;
      editor
        .chain()
        .focus()
        .insertContent(`@${member.handle ?? member.name} `)
        .run();
    },
    [closeMenu, editor, items],
  );

  keyHandler.current = (key: MenuKey): boolean => {
    if (menuRef.current === null || items.length === 0) {
      if (key === 'Escape' && onCancel !== undefined) {
        onCancel();
        return true;
      }
      return false;
    }
    if (key === 'Escape') {
      closeMenu();
      return true;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const step = key === 'ArrowDown' ? 1 : items.length - 1;
      const next = (highlightRef.current + step) % items.length;
      highlightRef.current = next;
      setHighlight(next);
      return true;
    }
    applyItem(highlightRef.current);
    return true;
  };

  useEffect(() => {
    if (editor === null) return;
    const dom = editor.view.dom;
    dom.setAttribute('aria-autocomplete', 'list');
    dom.setAttribute('aria-expanded', menu === null ? 'false' : 'true');
    if (menu === null || items.length === 0) {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
      return;
    }
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-activedescendant', `${optionPrefix}-${highlight}`);
  }, [editor, highlight, items.length, listId, menu, optionPrefix]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'enter' && onSubmit !== undefined) {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (key === 's' && onForceSave !== undefined) {
      event.preventDefault();
      onForceSave();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0 || onUpload === undefined) return;
    event.preventDefault();
    runUpload(files).catch(() => undefined);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    const files = [...event.dataTransfer.files];
    if (files.length === 0 || onUpload === undefined) return;
    event.preventDefault();
    runUpload(files).catch(() => undefined);
  };

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    runUpload(files).catch(() => undefined);
  };

  return (
    <section
      ref={containerRef}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn('relative min-h-0', className)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDrop={onDrop}
      onDragOver={(event) => {
        if (onUpload !== undefined) event.preventDefault();
      }}
    >
      <EditorContent editor={editor} className={cn(docProseClassName, editorSurfaceClassName)} />

      {onUpload === undefined ? null : (
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          data-testid={`${testId}-file`}
          onChange={onPickFile}
        />
      )}

      {uploading ? (
        <p className="absolute right-2 bottom-2 text-2xs text-faint">Uploading…</p>
      ) : null}

      {bubble === null || editor === null ? null : (
        <div
          data-testid={`${testId}-bubble`}
          style={{ left: `${bubble.left}px`, top: `${bubble.top}px` }}
          className="-translate-x-1/2 absolute z-30 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-pop"
        >
          <BubbleButton
            label="Bold"
            active={editor.isActive('bold')}
            icon={Bold}
            onPress={() => editor.chain().focus().toggleBold().run()}
          />
          <BubbleButton
            label="Italic"
            active={editor.isActive('italic')}
            icon={Italic}
            onPress={() => editor.chain().focus().toggleItalic().run()}
          />
          <BubbleButton
            label="Strikethrough"
            active={editor.isActive('strike')}
            icon={Strikethrough}
            onPress={() => editor.chain().focus().toggleStrike().run()}
          />
          <BubbleButton
            label="Inline code"
            active={editor.isActive('code')}
            icon={Code}
            onPress={() => editor.chain().focus().toggleCode().run()}
          />
          <BubbleButton
            label={editor.isActive('link') ? 'Remove link' : 'Link'}
            active={editor.isActive('link') || link !== null}
            icon={Link2}
            onPress={() => {
              if (editor.isActive('link')) {
                editor.chain().focus().unsetLink().run();
                return;
              }
              setLink('https://');
            }}
          />
          {link === null ? null : (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                const href = link.trim();
                setLink(null);
                if (href.length === 0) return;
                editor.chain().focus().setLink({ href }).run();
              }}
            >
              <input
                value={link}
                aria-label="Link URL"
                data-testid={`${testId}-link-input`}
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setLink(null);
                }}
                className="h-7 w-44 rounded-sm border border-border bg-surface-2 px-2 text-2xs text-text outline-none focus-visible:border-accent"
              />
              <button
                type="submit"
                className="rounded-sm px-2 py-1 text-2xs text-accent transition-colors duration-[var(--duration-fast)] hover:bg-surface-2"
              >
                Apply
              </button>
            </form>
          )}
        </div>
      )}

      {menu === null || items.length === 0 ? null : (
        <MenuList
          listId={listId}
          optionPrefix={optionPrefix}
          kind={menu.kind}
          items={items}
          highlight={highlight}
          position={menu.position}
          onHighlight={(index) => {
            highlightRef.current = index;
            setHighlight(index);
          }}
          onPick={applyItem}
        />
      )}
    </section>
  );
}

interface MenuListProps {
  readonly listId: string;
  readonly optionPrefix: string;
  readonly kind: 'slash' | 'mention';
  readonly items: readonly SlashCommand[] | readonly Member[];
  readonly highlight: number;
  readonly position: MenuPosition;
  readonly onHighlight: (index: number) => void;
  readonly onPick: (index: number) => void;
}

function MenuList({
  listId,
  optionPrefix,
  kind,
  items,
  highlight,
  position,
  onHighlight,
  onPick,
}: MenuListProps) {
  return (
    <div
      id={listId}
      role="listbox"
      aria-label={kind === 'slash' ? 'Insert a block' : 'Mention a teammate'}
      data-testid={kind === 'slash' ? 'slash-menu' : 'mention-list'}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      className="absolute z-30 flex max-h-64 w-64 flex-col overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-pop"
    >
      {items.map((item, index) => (
        <MenuOption
          key={kind === 'slash' ? (item as SlashCommand).id : (item as Member).id}
          id={`${optionPrefix}-${index}`}
          kind={kind}
          item={item}
          selected={index === highlight}
          onHighlight={() => onHighlight(index)}
          onPick={() => onPick(index)}
        />
      ))}
    </div>
  );
}

function MenuOption({
  id,
  kind,
  item,
  selected,
  onHighlight,
  onPick,
}: {
  readonly id: string;
  readonly kind: 'slash' | 'mention';
  readonly item: SlashCommand | Member;
  readonly selected: boolean;
  readonly onHighlight: () => void;
  readonly onPick: () => void;
}) {
  const slash = kind === 'slash' ? (item as SlashCommand) : null;
  const member = kind === 'mention' ? (item as Member) : null;
  const Icon = slash === null ? null : slash.icon;

  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      data-testid={slash === null ? undefined : `slash-${slash.id}`}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHighlight}
      onFocus={onHighlight}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-dense',
        'transition-colors duration-[var(--duration-fast)]',
        selected ? 'bg-surface-2 text-text' : 'text-muted',
      )}
    >
      {Icon === null ? null : <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{slash === null ? member?.name : slash.label}</span>
      <span className="shrink-0 truncate text-2xs text-faint">
        {slash === null ? `@${member?.handle ?? member?.name}` : slash.hint}
      </span>
    </button>
  );
}

function BubbleButton({
  label,
  icon: Icon,
  active,
  onPress,
}: {
  readonly label: string;
  readonly icon: typeof Bold;
  readonly active: boolean;
  readonly onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
      className={cn(
        'flex size-7 items-center justify-center rounded-sm transition-colors duration-[var(--duration-fast)]',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}
