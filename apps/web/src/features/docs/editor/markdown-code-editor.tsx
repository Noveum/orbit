'use client';

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
  markdownLanguage,
} from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { placeholder as cmPlaceholder, EditorView, keymap } from '@codemirror/view';
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from '@/lib/cn.ts';
import type { EditResult, Selection } from '../markdown-input.ts';
import { headingLineNumbers } from '../outline.ts';
import { codeEditorHighlightStyle, codeEditorTheme } from './code-editor-theme.ts';

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
          syntaxHighlighting(codeEditorHighlightStyle),
          codeEditorTheme,
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
