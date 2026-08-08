'use client';

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
  markdownLanguage,
} from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { placeholder as cmPlaceholder, EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from '@/lib/cn.ts';
import type { EditResult, Selection } from '../markdown-input.ts';
import { headingLineNumbers } from '../outline.ts';

export type ModKey = 'b' | 'i' | 'k' | 's';

export interface MarkdownCodeEditorHandle {
  readonly getSelection: () => Selection;
  readonly applyEdit: (result: EditResult) => void;
  readonly focus: () => void;
  readonly revealHeading: (index: number) => void;
}

export interface MarkdownCodeEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onModKey: (key: ModKey) => void;
  readonly onFiles: (files: readonly File[]) => void;
  readonly placeholder?: string;
  readonly ariaLabel: string;
  readonly testId?: string;
  readonly handleRef?: Ref<MarkdownCodeEditorHandle>;
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--color-text)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--color-text)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--color-accent)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--color-text)' },
  { tag: tags.list, color: 'var(--color-faint)' },
  { tag: tags.quote, color: 'var(--color-muted)' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--color-faint)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--color-accent)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-success)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--color-warning)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--color-faint)',
    fontStyle: 'italic',
  },
  { tag: [tags.function(tags.variableName), tags.variableName], color: 'var(--color-text)' },
  { tag: [tags.typeName, tags.className], color: 'var(--color-warning)' },
  { tag: tags.propertyName, color: 'var(--color-danger)' },
]);

const theme = EditorView.theme({
  '&': { color: 'var(--color-text)', backgroundColor: 'transparent', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: '0.8125rem',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': { padding: '1.25rem 1.5rem', caretColor: 'var(--color-text)' },
  '.cm-line': { padding: '0' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--color-text)' },
  '.cm-placeholder': { color: 'var(--color-faint)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--color-selected)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
});

function extractFiles(source: DataTransfer | null): File[] {
  if (source === null) return [];
  return [...source.files];
}

export function MarkdownCodeEditor({
  value,
  onChange,
  onModKey,
  onFiles,
  placeholder = 'Write markdown. Drop a file to attach it.',
  ariaLabel,
  testId = 'markdown-code-editor',
  handleRef,
}: MarkdownCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onModKeyRef = useRef(onModKey);
  const onFilesRef = useRef(onFiles);
  onChangeRef.current = onChange;
  onModKeyRef.current = onModKey;
  onFilesRef.current = onFiles;

  useImperativeHandle(
    handleRef,
    (): MarkdownCodeEditorHandle => ({
      getSelection: () => {
        const view = viewRef.current;
        if (view === null) return { value, start: value.length, end: value.length };
        const range = view.state.selection.main;
        return { value: view.state.doc.toString(), start: range.from, end: range.to };
      },
      applyEdit: (result) => {
        const view = viewRef.current;
        if (view === null) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: result.value },
          selection: { anchor: result.start, head: result.end },
        });
        view.focus();
      },
      focus: () => viewRef.current?.focus(),
      revealHeading: (index) => {
        const view = viewRef.current;
        if (view === null) return;
        const line = headingLineNumbers(view.state.doc.toString())[index];
        if (line === undefined) return;
        const at = view.state.doc.line(line + 1).from;
        view.dispatch({
          selection: { anchor: at },
          effects: EditorView.scrollIntoView(at, { y: 'start' }),
        });
        view.focus();
      },
    }),
    [value],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is built once on mount; prop changes reach it through refs and the value-sync effect
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const modBinding = (key: ModKey) => ({
      key: `Mod-${key}`,
      preventDefault: true,
      run: () => {
        onModKeyRef.current(key);
        return true;
      },
    });

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            modBinding('b'),
            modBinding('i'),
            modBinding('k'),
            modBinding('s'),
            { key: 'Enter', run: insertNewlineContinueMarkup },
            { key: 'Backspace', run: deleteMarkupBackward },
            indentWithTab,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlightStyle),
          theme,
          EditorView.lineWrapping,
          cmPlaceholder(placeholder),
          EditorState.allowMultipleSelections.of(true),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'data-testid': testId }),
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = extractFiles(event.clipboardData);
              if (files.length === 0) return false;
              event.preventDefault();
              onFilesRef.current(files);
              return true;
            },
            dragover: (event) => {
              if (event.dataTransfer?.types.includes('Files') === true) event.preventDefault();
              return false;
            },
            drop: (event) => {
              const files = extractFiles(event.dataTransfer);
              if (files.length === 0) return false;
              event.preventDefault();
              onFilesRef.current(files);
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={hostRef} data-testid={`${testId}-host`} className={cn('h-full')} />;
}
