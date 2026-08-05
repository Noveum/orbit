'use client';

import { renderMarkdown } from '@orbit/services/markdown';
import { useQueryClient } from '@tanstack/react-query';
import { Bold, Code2, Heading2, Italic, Link2, ListChecks, Table2 } from 'lucide-react';
import type { RefObject } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { messageOf } from '@/lib/query/fetcher.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { useBootstrap } from '@/lib/query/use-issues.ts';
import { DocBody } from './doc-body.tsx';
import {
  MarkdownCodeEditor,
  type MarkdownCodeEditorHandle,
  type ModKey,
} from './editor/markdown-code-editor.tsx';
import { RichTextEditor, type UploadedAttachment } from './editor/rich-text-editor.tsx';
import {
  attachmentMarkdown,
  type EditResult,
  insertBlock,
  linkSelection,
  type Selection,
  SNIPPETS,
  type SnippetName,
  wrapSelection,
} from './markdown-input.ts';
import { type UploadOptions, uploadDocFile } from './upload.ts';

const SNIPPET_ITEMS: readonly { name: SnippetName; label: string; icon: typeof Bold }[] = [
  { name: 'heading', label: 'Heading', icon: Heading2 },
  { name: 'table', label: 'Table', icon: Table2 },
  { name: 'code', label: 'Code block', icon: Code2 },
  { name: 'tasks', label: 'Task list', icon: ListChecks },
];

export type EditorMode = 'rich' | 'markdown';

export interface DocEditorProps {
  readonly docId: string;
  readonly content: string;
  readonly onChange: (value: string) => void;
  readonly onForceSave: () => void;
  readonly footer?: React.ReactNode;
  readonly outline?: React.ReactNode;
  readonly scrollRef?: RefObject<HTMLDivElement | null>;
}

export function DocEditor({
  docId,
  content,
  onChange,
  onForceSave,
  footer,
  outline,
  scrollRef,
}: DocEditorProps) {
  const { toast } = useToast();
  const client = useQueryClient();
  const bootstrap = useBootstrap(null);
  const cmRef = useRef<MarkdownCodeEditorHandle>(null);
  const [mode, setMode] = useState<EditorMode>('rich');
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);

  const html = useMemo(
    () => (mode === 'markdown' && preview ? renderMarkdown(content) : ''),
    [mode, preview, content],
  );

  const applyEdit = useCallback((result: EditResult) => {
    cmRef.current?.applyEdit(result);
  }, []);

  const selection = useCallback((): Selection => {
    return (
      cmRef.current?.getSelection() ?? {
        value: content,
        start: content.length,
        end: content.length,
      }
    );
  }, [content]);

  const insertSnippet = useCallback(
    (name: SnippetName) => applyEdit(insertBlock(selection(), SNIPPETS[name])),
    [applyEdit, selection],
  );

  const upload = useCallback(
    async (file: File, options: UploadOptions = {}): Promise<UploadedAttachment> => {
      try {
        const uploaded = await uploadDocFile(docId, file, options);
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
      setPercent(0);
      try {
        for (const file of files) {
          const uploaded = await upload(file, {
            onProgress: ({ loaded, total }) =>
              setPercent(total === 0 ? 0 : Math.round((loaded / total) * 100)),
          });
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

  const onModKey = useCallback(
    (key: ModKey) => {
      if (key === 's') return onForceSave();
      if (key === 'b') return applyEdit(wrapSelection(selection(), '**'));
      if (key === 'i') return applyEdit(wrapSelection(selection(), '_'));
      applyEdit(linkSelection(selection()));
    },
    [applyEdit, selection, onForceSave],
  );

  const onFiles = useCallback(
    (files: readonly File[]) => {
      uploadFiles(files).catch(() => undefined);
    },
    [uploadFiles],
  );

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

        {mode === 'markdown' ? (
          <>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
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

            {SNIPPET_ITEMS.map((item) => (
              <Tooltip key={item.name} label={item.label} side="bottom">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={item.label}
                  data-testid={`insert-${item.name}`}
                  className="size-7 px-0"
                  onClick={() => insertSnippet(item.name)}
                >
                  <item.icon className="size-3.5" aria-hidden="true" />
                </Button>
              </Tooltip>
            ))}
          </>
        ) : null}

        <span className="ml-auto flex items-center gap-2">
          {uploading ? (
            <span className="text-2xs text-faint" data-testid="upload-progress" aria-live="polite">
              Uploading {percent}%
            </span>
          ) : null}
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
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RichTextEditor
              value={content}
              onChange={onChange}
              members={bootstrap.data?.members ?? []}
              onUpload={upload}
              onForceSave={onForceSave}
              toolbar="full"
              ariaLabel="Doc body"
              testId="doc-rich-editor"
              footer={footer}
              {...(scrollRef === undefined ? {} : { scrollRef })}
            />
          </div>
          {outline}
        </div>
      ) : (
        <div
          className={cn(
            'relative grid min-h-0 flex-1',
            preview ? 'grid-rows-2 lg:grid-cols-2 lg:grid-rows-1' : 'grid-cols-1',
          )}
        >
          <div className="relative min-h-0">
            <MarkdownCodeEditor
              handleRef={cmRef}
              value={content}
              onChange={onChange}
              onModKey={onModKey}
              onFiles={onFiles}
              ariaLabel="Doc markdown"
              testId="doc-editor-input"
            />
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
