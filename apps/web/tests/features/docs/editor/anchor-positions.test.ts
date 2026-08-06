import { describe, expect, it } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { buildDocAnchor } from '@orbit/shared/utils';
import { Editor } from '@tiptap/core';
import {
  anchorFromSelection,
  anchorRangeIn,
  docTextOf,
  offsetOfPos,
  posOfOffset,
} from '../../../../src/features/docs/editor/anchor-positions.ts';
import {
  editorExtensions,
  type MenuKey,
  toEditorHtml,
} from '../../../../src/features/docs/editor/extensions.ts';

const handler = { current: (_key: MenuKey) => false };

function mount(markdown: string): Editor {
  const element = document.createElement('div');
  document.body.append(element);
  return new Editor({
    element,
    extensions: editorExtensions(handler),
    content: toEditorHtml(renderMarkdown(markdown)),
  });
}

const source = [
  '# Launch plan',
  '',
  'The launch is blocked on the migration.',
  '',
  'We meet on **Thursday** to decide.',
].join('\n');

describe('docTextOf', () => {
  it('reads the document as plain text with one newline between blocks', () => {
    const editor = mount(source);
    const text = docTextOf(editor.state.doc).text;
    editor.destroy();

    expect(text).toBe(
      'Launch plan\nThe launch is blocked on the migration.\nWe meet on Thursday to decide.',
    );
  });

  it('keeps a mark from splitting the text it decorates', () => {
    const editor = mount('We meet on **Thursday** to decide.');
    const { text, spans } = docTextOf(editor.state.doc);
    editor.destroy();

    expect(text).toBe('We meet on Thursday to decide.');
    expect(spans.length).toBeGreaterThan(1);
    expect(spans.map((span) => span.length).reduce((total, length) => total + length, 0)).toBe(
      text.length,
    );
  });
});

describe('offsetOfPos and posOfOffset', () => {
  it('round trips every text position in the document', () => {
    const editor = mount(source);
    const docText = docTextOf(editor.state.doc);

    for (let offset = 0; offset <= docText.text.length; offset += 1) {
      const pos = posOfOffset(docText, offset);
      expect(pos).not.toBeNull();
      if (pos !== null) expect(offsetOfPos(docText, pos)).toBe(offset);
    }

    editor.destroy();
  });

  it('maps a selection back to the exact text the reader picked', () => {
    const editor = mount(source);
    const docText = docTextOf(editor.state.doc);
    const wanted = 'blocked on the migration';
    const offset = docText.text.indexOf(wanted);
    const from = posOfOffset(docText, offset);
    const to = posOfOffset(docText, offset + wanted.length);

    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    if (from !== null && to !== null) {
      expect(editor.state.doc.textBetween(from, to)).toBe(wanted);
    }

    editor.destroy();
  });
});

describe('anchorFromSelection', () => {
  it('quotes the selected passage with the text on either side', () => {
    const editor = mount(source);
    const docText = docTextOf(editor.state.doc);
    const wanted = 'blocked on the migration';
    const offset = docText.text.indexOf(wanted);
    const from = posOfOffset(docText, offset) ?? 0;
    const to = posOfOffset(docText, offset + wanted.length) ?? 0;

    const anchor = anchorFromSelection(docText, from, to);
    editor.destroy();

    expect(anchor?.quote).toBe(wanted);
    expect(anchor?.prefix.endsWith('The launch is ')).toBe(true);
  });

  it('refuses a selection that is empty or only whitespace', () => {
    const editor = mount(source);
    const docText = docTextOf(editor.state.doc);
    editor.destroy();

    expect(anchorFromSelection(docText, 4, 4)).toBeNull();
  });
});

describe('anchorRangeIn', () => {
  it('finds the passage again after an unrelated edit moved it', () => {
    const original = mount(source);
    const anchor = buildDocAnchor(
      docTextOf(original.state.doc).text,
      'Launch plan\n'.length,
      'Launch plan\n'.length + 'The launch is blocked on the migration.'.length,
    );
    original.destroy();

    const edited = mount(
      `# Launch plan, week 14\n\nA new paragraph landed on top.\n\n${source
        .split('\n')
        .slice(2)
        .join('\n')}`,
    );
    const docText = docTextOf(edited.state.doc);
    const range = anchorRangeIn(docText, anchor);

    expect(range).not.toBeNull();
    if (range !== null) {
      expect(edited.state.doc.textBetween(range.from, range.to)).toBe(
        'The launch is blocked on the migration.',
      );
    }
    edited.destroy();
  });

  it('returns null once the quoted passage was edited away', () => {
    const original = mount(source);
    const anchor = buildDocAnchor(
      docTextOf(original.state.doc).text,
      'Launch plan\n'.length,
      'Launch plan\n'.length + 'The launch is blocked on the migration.'.length,
    );
    original.destroy();

    const edited = mount('# Launch plan\n\nThe launch is on track.\n\nWe meet on Thursday.');
    const range = anchorRangeIn(docTextOf(edited.state.doc), anchor);
    edited.destroy();

    expect(range).toBeNull();
  });
});
