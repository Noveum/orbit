'use client';

import { renderMarkdown } from '@orbit/services/markdown';
import { useQueryClient } from '@tanstack/react-query';
import { Bold, Code2, Heading2, Italic, Link2, ListChecks, Paperclip, Table2 } from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { messageOf } from '@/lib/query/fetcher.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { useBootstrap } from '@/lib/query/use-issues.ts';
import { DocBody } from './doc-body.tsx';
import { RichTextEditor, type UploadedAttachment } from './editor/rich-text-editor.tsx';
import {
  attachmentMarkdown,
  type EditResult,
  insertBlock,
  linkSelection,
  replaceSlashQuery,
  SNIPPETS,
  type SnippetName,
  wrapSelection,
} from './markdown-input.ts';
import { uploadDocFile } from './upload.ts';

const SLASH_ITEMS: readonly { name: SnippetName; label: string; icon: typeof Bold }[] = [
  { name: 'heading', label: 'Heading', icon: Heading2 },
  { name: 'table', label: 'Table', icon: Table2 },
  { name: 'code', label: 'Code block', icon: Code2 },
  { name: 'tasks', label: 'Task list', icon: ListChecks },
];

const DISMISS_SLASH = new Set(['Escape', ' ', 'Enter', 'Backspace']);

export type EditorMode = 'rich' | 'markdown';

export interface DocEditorProps {
  readonly docId: string;
  readonly content: string;
  readonly onChange: (value: string) => void;
  readonly onForceSave: () => void;
}

export function DocEditor({ docId, content, onChange, onForceSave }: DocEditorProps) {
  const { toast } = useToast();
  const client = useQueryClient();
  const bootstrap = useBootstrap(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>('rich');
  const [preview, setPreview] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [uploading, setUploading] = useState(false);

  const html = useMemo(
    () => (mode === 'markdown' && preview ? renderMarkdown(content) : ''),
    [mode, preview, content],
  );

  const applyEdit = useCallback(
    (result: EditResult) => {
      onChange(result.value);
      requestAnimationFrame(() => {
        const area = areaRef.current;
        if (area === null) return;
        area.focus();
        area.setSelectionRange(result.start, result.end);
      });
    },
    [onChange],
  );

  const selection = useCallback(() => {
    const area = areaRef.current;
    if (area === null) return { value: content, start: content.length, end: content.length };
    return { value: area.value, start: area.selectionStart, end: area.selectionEnd };
  }, [content]);

  const insertSnippet = useCallback(
    (name: SnippetName, fromSlash: boolean) => {
      setSlashOpen(false);
      const current = selection();
      applyEdit(
        fromSlash
          ? replaceSlashQuery(current, SNIPPETS[name])
          : insertBlock(current, SNIPPETS[name]),
      );
    },
    [applyEdit, selection],
  );

  const upload = useCallback(
    async (file: File): Promise<UploadedAttachment> => {
      try {
        const uploaded = await uploadDocFile(docId, file);
        await client.invalidateQueries({ queryKey: queryKeys.doc(docId) });
        return uploaded;
      } catch (error: unknown) {
        toast({ title: 'Upload failed', description: messageOf(error), tone: 'danger' });
        throw error;
      }
    },
    [client, docId, toast],
  );

  const uploadFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        for (const file of files) {
          const uploaded = await upload(file);
          applyEdit(
            insertBlock(
              selection(),
              `${attachmentMarkdown(uploaded.fileName, uploaded.contentType, uploaded.url)}\n\n`,
            ),
          );
        }
      } catch {
        return;
      } finally {
        setUploading(false);
      }
    },
    [applyEdit, selection, upload],
  );

  const modActions: Record<string, () => void> = {
    s: onForceSave,
    b: () => applyEdit(wrapSelection(selection(), '**')),
    i: () => applyEdit(wrapSelection(selection(), '_')),
    k: () => applyEdit(linkSelection(selection())),
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const run = event.metaKey || event.ctrlKey ? modActions[event.key.toLowerCase()] : undefined;
    if (run !== undefined) {
      event.preventDefault();
      run();
      return;
    }
    if (event.key === '/' && !slashOpen) setSlashOpen(true);
    else if (slashOpen && DISMISS_SLASH.has(event.key)) {
      if (event.key === 'Escape') event.preventDefault();
      setSlashOpen(false);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    uploadFiles(files).catch(() => undefined);
  };

  const onDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    setDropping(false);
    uploadFiles([...event.dataTransfer.files]).catch(() => undefined);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="doc-editor">
      <div className="flex flex-wrap items-center gap-1 border-border border-b px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
          {(['rich', 'markdown'] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`editor-mode-${option}`}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                'rounded-sm px-2 py-1 text-2xs transition-colors duration-[var(--duration-fast)]',
                mode === option ? 'bg-surface text-text shadow-sm' : 'text-faint hover:text-muted',
              )}
            >
              {option === 'rich' ? 'Rich text' : 'Markdown'}
            </button>
          ))}
        </div>

        <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />

        {mode === 'markdown' ? (
          <>
            <Tooltip label="Bold" shortcut={['mod', 'b']} side="bottom">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Bold"
                className="size-7 px-0"
                onClick={() => applyEdit(wrapSelection(selection(), '**'))}
              >
                <Bold className="size-3.5" aria-hidden="true" />
              </Button>
            </Tooltip>
            <Tooltip label="Italic" shortcut={['mod', 'i']} side="bottom">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Italic"
                className="size-7 px-0"
                onClick={() => applyEdit(wrapSelection(selection(), '_'))}
              >
                <Italic className="size-3.5" aria-hidden="true" />
              </Button>
            </Tooltip>
            <Tooltip label="Link" shortcut={['mod', 'k']} side="bottom">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Link"
                className="size-7 px-0"
                onClick={() => applyEdit(linkSelection(selection()))}
              >
                <Link2 className="size-3.5" aria-hidden="true" />
              </Button>
            </Tooltip>

            {SLASH_ITEMS.map((item) => (
              <Tooltip key={item.name} label={item.label} side="bottom">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={item.label}
                  data-testid={`insert-${item.name}`}
                  className="size-7 px-0"
                  onClick={() => insertSnippet(item.name, false)}
                >
                  <item.icon className="size-3.5" aria-hidden="true" />
                </Button>
              </Tooltip>
            ))}
          </>
        ) : (
          <span className="flex items-center gap-1 text-2xs text-faint">
            <Paperclip className="size-3.5" aria-hidden="true" />
            Drop or paste a file to attach it
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          {uploading ? <span className="text-2xs text-faint">Uploading…</span> : null}
          <span className="hidden items-center gap-1 text-2xs text-faint sm:flex">
            Type <Kbd keys={['/']} /> to insert
          </span>
          {mode === 'markdown' ? (
            <Button
              variant={preview ? 'primary' : 'secondary'}
              size="sm"
              data-testid="toggle-preview"
              aria-pressed={preview}
              onClick={() => setPreview((value) => !value)}
            >
              {preview ? 'Editing preview' : 'Preview'}
            </Button>
          ) : null}
        </span>
      </div>

      {mode === 'rich' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <RichTextEditor
            value={content}
            onChange={onChange}
            members={bootstrap.data?.members ?? []}
            onUpload={upload}
            onForceSave={onForceSave}
            ariaLabel="Doc body"
            testId="doc-rich-editor"
          />
        </div>
      ) : (
        <div
          className={cn(
            'relative grid min-h-0 flex-1',
            preview ? 'grid-rows-2 lg:grid-cols-2 lg:grid-rows-1' : 'grid-cols-1',
            dropping && 'ring-2 ring-accent ring-inset',
          )}
        >
          <div className="relative min-h-0 overflow-y-auto">
            <textarea
              ref={areaRef}
              value={content}
              data-testid="doc-editor-input"
              aria-label="Doc markdown"
              spellCheck={false}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onDragOver={(event) => {
                event.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={onDrop}
              className="min-h-full w-full resize-none bg-transparent px-6 py-6 font-mono text-dense text-text leading-6 outline-none placeholder:text-faint"
              placeholder="Write markdown. Drop a file to attach it."
            />

            {slashOpen ? (
              <div
                data-testid="slash-menu"
                className="absolute top-3 left-6 z-20 w-56 rounded-lg border border-border bg-surface p-1 shadow-pop"
              >
                <p className="px-2 py-1 text-2xs text-faint">Insert</p>
                {SLASH_ITEMS.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    data-testid={`slash-${item.name}`}
                    onClick={() => insertSnippet(item.name, true)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-dense text-muted hover:bg-surface-2 hover:text-text"
                  >
                    <item.icon className="size-3.5" aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {preview ? (
            <div className="min-h-0 overflow-y-auto border-border border-t px-6 py-6 lg:border-t-0 lg:border-l">
              <DocBody html={html} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
