'use client';

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { placeholder as cmPlaceholder, EditorView, keymap } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn.ts';
import { codeEditorHighlightStyle, codeEditorTheme } from './code-editor-theme.ts';

export interface HtmlCodeEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly ariaLabel: string;
}

export function HtmlCodeEditor({
  value,
  onChange,
  placeholder = 'Write a self-contained HTML page.',
  ariaLabel,
}: HtmlCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is built once on mount; prop changes reach it through refs and the value-sync effect
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([indentWithTab, ...historyKeymap, ...defaultKeymap]),
          html(),
          syntaxHighlighting(codeEditorHighlightStyle),
          codeEditorTheme,
          EditorView.lineWrapping,
          cmPlaceholder(placeholder),
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            'data-testid': 'html-code-editor',
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

  return <div ref={hostRef} data-testid="html-code-editor-host" className={cn('h-full min-h-0')} />;
}
