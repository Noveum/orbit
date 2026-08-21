import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export const codeEditorHighlightStyle = HighlightStyle.define([
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
  { tag: tags.tagName, color: 'var(--color-accent)' },
  { tag: tags.attributeName, color: 'var(--color-warning)' },
  { tag: tags.angleBracket, color: 'var(--color-faint)' },
]);

export const codeEditorTheme = EditorView.theme({
  '&': { color: 'var(--color-text)', backgroundColor: 'transparent', height: '100%' },
  '&.cm-focused': {
    outline: 'var(--orbit-ring-width) solid var(--color-ring)',
    outlineOffset: 'var(--orbit-ring-offset)',
  },
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
