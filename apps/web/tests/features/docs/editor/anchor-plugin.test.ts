import { describe, expect, it } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { buildDocAnchor } from '@orbit/shared/utils';
import { Editor } from '@tiptap/core';
import {
  type DocAnchorDecorationRef,
  docAnchorPlugin,
} from '../../../../src/features/docs/editor/anchor-plugin.ts';
import { anchorRangeIn, docTextOf } from '../../../../src/features/docs/editor/anchor-positions.ts';
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

const source = '# Launch plan\n\nThe launch is blocked on the migration.\n\nWe meet on Thursday.';
const passage = 'blocked on the migration';

function anchoredEditor(): { editor: Editor; ranges: DocAnchorDecorationRef } {
  const editor = mount(source);
  const ranges: DocAnchorDecorationRef = { current: [] };
  editor.registerPlugin(docAnchorPlugin(ranges));

  const docText = docTextOf(editor.state.doc);
  const offset = docText.text.indexOf(passage);
  const anchor = buildDocAnchor(docText.text, offset, offset + passage.length);
  const range = anchorRangeIn(docText, anchor);
  if (range !== null) {
    ranges.current = [{ commentId: 'c_1', from: range.from, to: range.to, focused: false }];
  }
  editor.view.dispatch(editor.state.tr);
  return { editor, ranges };
}

describe('docAnchorPlugin', () => {
  it('marks the anchored passage in the editor and nothing else', () => {
    const { editor } = anchoredEditor();
    const marked = [...editor.view.dom.querySelectorAll('[data-doc-comment-anchor="c_1"]')];
    editor.destroy();

    expect(marked.length).toBeGreaterThan(0);
    expect(marked.map((node) => node.textContent).join('')).toBe(passage);
  });

  it('adds the focused class only for the comment that is focused', () => {
    const { editor, ranges } = anchoredEditor();
    const before = editor.view.dom.querySelector('[data-doc-comment-anchor="c_1"]');
    expect(before?.classList.contains('orbit-doc-anchor-active')).toBe(false);

    ranges.current = ranges.current.map((range) => ({ ...range, focused: true }));
    editor.view.dispatch(editor.state.tr);

    const after = editor.view.dom.querySelector('[data-doc-comment-anchor="c_1"]');
    const focused = after?.classList.contains('orbit-doc-anchor-active') ?? false;
    editor.destroy();

    expect(focused).toBe(true);
  });

  it('draws nothing when there is no anchored comment', () => {
    const editor = mount(source);
    editor.registerPlugin(docAnchorPlugin({ current: [] }));
    editor.view.dispatch(editor.state.tr);
    const marked = editor.view.dom.querySelectorAll('[data-doc-comment-anchor]');
    editor.destroy();

    expect(marked).toHaveLength(0);
  });

  it('drops a range that no longer fits the document instead of throwing', () => {
    const editor = mount(source);
    const ranges: DocAnchorDecorationRef = {
      current: [{ commentId: 'c_gone', from: 5, to: 9_000, focused: false }],
    };
    editor.registerPlugin(docAnchorPlugin(ranges));

    expect(() => editor.view.dispatch(editor.state.tr)).not.toThrow();
    const marked = editor.view.dom.querySelectorAll('[data-doc-comment-anchor]');
    editor.destroy();

    expect(marked).toHaveLength(0);
  });
});
