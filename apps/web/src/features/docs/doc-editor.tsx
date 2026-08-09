'use client';

import { renderMarkdown } from '@orbit/services/markdown';
import type { Editor } from '@tiptap/core';
import {
  Bold,
  Code2,
  Heading2,
  Italic,
  Link2,
  ListChecks,
  PanelTopClose,
  PanelTopOpen,
  Table2,
} from 'lucide-react';
import type { Ref, RefObject } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { tabHover } from '@/lib/interaction.ts';
import { useBootstrap } from '@/lib/query/use-issues.ts';
import { DocBody } from './doc-body.tsx';
import { DocOutline } from './doc-outline.tsx';
import {
  MarkdownCodeEditor,
  type MarkdownCodeEditorHandle,
  type ModKey,
} from './editor/markdown-code-editor.tsx';
import { RichTextEditor } from './editor/rich-text-editor.tsx';
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
import type { DocHeading } from './outline.ts';
import { type DocCommenting, useDocAnchors } from './use-doc-anchors.ts';
import { type EditorMode, useDocPreferences } from './use-doc-preferences.ts';
import { useDocUploads } from './use-doc-uploads.ts';

const SNIPPET_ITEMS: readonly { name: SnippetName; label: string; icon: typeof Bold }[] = [
  { name: 'heading', label: 'Heading', icon: Heading2 },
  { name: 'table', label: 'Table', icon: Table2 },
  { name: 'code', label: 'Code block', icon: Code2 },
  { name: 'tasks', label: 'Task list', icon: ListChecks },
];

function MarkdownFormattingButtons({
  onWrap,
  onLink,
  onSnippet,
}: {
  readonly onWrap: (marker: string) => void;
  readonly onLink: () => void;
  readonly onSnippet: (name: SnippetName) => void;
}) {
  return (
    <>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
      <Tooltip label="Bold" shortcut={['mod', 'b']} side="bottom">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Bold"
          className="size-7 px-0"
          onClick={() => onWrap('**')}
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
          onClick={() => onWrap('_')}
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
          onClick={onLink}
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
            onClick={() => onSnippet(item.name)}
          >
            <item.icon className="size-3.5" aria-hidden="true" />
          </Button>
        </Tooltip>
      ))}
    </>
  );
}

function EditorModeSwitch({
  mode,
  onMode,
  toolbar,
  onToggleToolbar,
}: {
  readonly mode: EditorMode;
  readonly onMode: (mode: EditorMode) => void;
  readonly toolbar: boolean;
  readonly onToggleToolbar: () => void;
}) {
  const label = toolbar ? 'Hide formatting' : 'Show formatting';
  const Icon = toolbar ? PanelTopClose : PanelTopOpen;
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
        {(['markdown', 'rich'] as const).map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`editor-mode-${option}`}
            aria-pressed={mode === option}
            onClick={() => onMode(option)}
            className={cn(
              'rounded-sm px-2 py-1 text-2xs',
              tabHover,
              mode === option ? 'bg-surface text-text shadow-sm' : 'text-faint',
            )}
          >
            {option === 'rich' ? 'Rich text' : 'Markdown'}
          </button>
        ))}
      </div>
      <Tooltip label={label} side="bottom">
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          aria-pressed={toolbar}
          data-testid="toggle-formatting"
          className="size-7 px-0"
          onClick={onToggleToolbar}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}

function MarkdownToolbarRow({
  modeSwitch,
  toolbar,
  uploadStatus,
  preview,
  onTogglePreview,
  onWrap,
  onLink,
  onSnippet,
}: {
  readonly modeSwitch: React.ReactNode;
  readonly toolbar: boolean;
  readonly uploadStatus: React.ReactNode;
  readonly preview: boolean;
  readonly onTogglePreview: () => void;
  readonly onWrap: (marker: string) => void;
  readonly onLink: () => void;
  readonly onSnippet: (name: SnippetName) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-border border-b px-3 py-1.5">
      {modeSwitch}
      {toolbar ? (
        <MarkdownFormattingButtons onWrap={onWrap} onLink={onLink} onSnippet={onSnippet} />
      ) : null}

      <span className="ml-auto flex items-center gap-2">
        {uploadStatus}
        <Button
          variant={preview ? 'primary' : 'secondary'}
          size="sm"
          data-testid="toggle-preview"
          aria-pressed={preview}
          onClick={onTogglePreview}
        >
          {preview ? 'Editing preview' : 'Preview'}
        </Button>
      </span>
    </div>
  );
}

function MarkdownPane({
  handleRef,
  content,
  onChange,
  onModKey,
  onFiles,
  previewHtml,
}: {
  readonly handleRef: RefObject<MarkdownCodeEditorHandle | null>;
  readonly content: string;
  readonly onChange: (value: string) => void;
  readonly onModKey: (key: ModKey) => void;
  readonly onFiles: (files: readonly File[]) => void;
  readonly previewHtml: string | null;
}) {
  return (
    <div
      className={cn(
        'relative grid min-h-0 min-w-0 flex-1',
        previewHtml === null ? 'grid-cols-1' : 'grid-rows-2 lg:grid-cols-2 lg:grid-rows-1',
      )}
    >
      <div className="relative min-h-0">
        <MarkdownCodeEditor
          handleRef={handleRef}
          value={content}
          onChange={onChange}
          onModKey={onModKey}
          onFiles={onFiles}
          ariaLabel="Doc markdown"
          testId="doc-editor-input"
        />
      </div>

      {previewHtml === null ? null : (
        <div className="min-h-0 overflow-y-auto border-border border-t px-6 py-6 lg:border-t-0 lg:border-l">
          <DocBody html={previewHtml} />
        </div>
      )}
    </div>
  );
}

export interface DocEditorOutline {
  readonly headings: readonly DocHeading[];
  readonly activeId: string | null;
  readonly goTo: (index: number) => void;
}

export interface DocEditorProps {
  readonly docId: string;
  readonly content: string;
  readonly onChange: (value: string) => void;
  readonly onForceSave: () => void;
  readonly footer?: React.ReactNode;
  readonly outline?: DocEditorOutline;
  readonly scrollRef?: Ref<HTMLDivElement>;
  readonly commenting?: DocCommenting;
}

export function DocEditor({
  docId,
  content,
  onChange,
  onForceSave,
  footer,
  outline,
  scrollRef,
  commenting,
}: DocEditorProps) {
  const bootstrap = useBootstrap(null);
  const cmRef = useRef<MarkdownCodeEditorHandle>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const { mode, setMode, toolbar, toggleToolbar } = useDocPreferences();
  const [preview, setPreview] = useState(false);
  const { uploading, percent, upload, uploadEach } = useDocUploads(docId);

  const html = useMemo(
    () => (mode === 'markdown' && preview ? renderMarkdown(content) : ''),
    [mode, preview, content],
  );

  const anchors = useDocAnchors(editor, commenting);

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

  const onModKey = useCallback(
    (key: ModKey) => {
      if (key === 's') return onForceSave();
      if (key === 'b') return applyEdit(wrapSelection(selection(), '**'));
      if (key === 'i') return applyEdit(wrapSelection(selection(), '_'));
      applyEdit(linkSelection(selection()));
    },
    [applyEdit, selection, onForceSave],
  );

  const revealHeading = useCallback(
    (index: number) => {
      if (mode === 'markdown') cmRef.current?.revealHeading(index);
      else outline?.goTo(index);
    },
    [mode, outline],
  );

  const outlinePane =
    outline === undefined || outline.headings.length === 0 ? null : (
      <div className="hidden shrink-0 pr-6 xl:block">
        <DocOutline
          headings={outline.headings}
          activeId={mode === 'markdown' ? null : outline.activeId}
          onSelect={revealHeading}
        />
      </div>
    );

  const onFiles = useCallback(
    (files: readonly File[]) => {
      uploadEach(files, (uploaded) => {
        applyEdit(
          insertBlock(
            selection(),
            `${attachmentMarkdown(uploaded.fileName, uploaded.contentType, uploaded.url)}\n\n`,
          ),
        );
      }).catch(() => undefined);
    },
    [applyEdit, selection, uploadEach],
  );

  const modeSwitch = (
    <EditorModeSwitch
      mode={mode}
      onMode={setMode}
      toolbar={toolbar}
      onToggleToolbar={toggleToolbar}
    />
  );

  const uploadStatus = uploading ? (
    <span className="text-2xs text-faint" data-testid="upload-progress" aria-live="polite">
      Uploading {percent}%
    </span>
  ) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="doc-editor">
      {mode === 'markdown' && toolbar ? (
        <MarkdownToolbarRow
          modeSwitch={modeSwitch}
          toolbar={toolbar}
          uploadStatus={uploadStatus}
          preview={preview}
          onTogglePreview={() => setPreview((value) => !value)}
          onWrap={(marker) => applyEdit(wrapSelection(selection(), marker))}
          onLink={() => applyEdit(linkSelection(selection()))}
          onSnippet={insertSnippet}
        />
      ) : null}

      {mode === 'rich' ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RichTextEditor
              value={content}
              onChange={onChange}
              members={bootstrap.data?.members ?? []}
              onUpload={upload}
              onForceSave={onForceSave}
              onReady={setEditor}
              toolbar="full"
              toolbarHidden={!toolbar}
              ariaLabel="Doc body"
              testId="doc-rich-editor"
              footer={footer}
              toolbarLeading={modeSwitch}
              toolbarTrailing={uploadStatus}
              {...(scrollRef === undefined ? {} : { scrollRef })}
              {...(commenting === undefined ? {} : { onComment: anchors.startComment })}
            />
          </div>
          {outlinePane}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <MarkdownPane
            handleRef={cmRef}
            content={content}
            onChange={onChange}
            onModKey={onModKey}
            onFiles={onFiles}
            previewHtml={preview ? html : null}
          />
          {outlinePane}
        </div>
      )}
    </div>
  );
}
