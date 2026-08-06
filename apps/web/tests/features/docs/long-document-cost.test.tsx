import { describe, expect, it, mock } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { act, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { useRef, useState } from 'react';
import { toEditorHtml } from '../../../src/features/docs/editor/extensions.ts';
import type { DocHeading } from '../../../src/features/docs/outline.ts';

const counts = { editorHtml: 0 };

mock.module('../../../src/features/docs/editor/editor-content.ts', () => ({
  editorHtmlFrom: (markdown: string) => {
    counts.editorHtml += 1;
    return toEditorHtml(renderMarkdown(markdown));
  },
}));

const { useEditorOutline } = await import('../../../src/features/docs/use-editor-outline.ts');
const { RichTextEditor } = await import('../../../src/features/docs/editor/rich-text-editor.tsx');

function longDocument(tail: string): string {
  const lines: string[] = ['# Long document', ''];
  for (let index = 1; index <= 25; index += 1) {
    lines.push(`## Section ${index}`, '', `Body paragraph ${index}.`, '');
  }
  lines.push(tail);
  return lines.join('\n');
}

let headings: readonly DocHeading[] = [];

function OutlineHarness({ content }: { readonly content: string }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  headings = useEditorOutline(content, scroller).headings;
  return <div ref={scroller} />;
}

describe('the outline of a long document', () => {
  it('is the same list, not a rebuilt one, while the body is typed into', () => {
    const view = render(<OutlineHarness content={longDocument('tail')} />);
    const first = headings;
    expect(first).toHaveLength(26);

    let typed = 'tail';
    for (let stroke = 0; stroke < 12; stroke += 1) {
      typed += 'a';
      const next = typed;
      act(() => {
        view.rerender(<OutlineHarness content={longDocument(next)} />);
      });
      expect(headings).toBe(first);
    }

    view.unmount();
  });

  it('is rebuilt as soon as a heading itself changes', () => {
    const view = render(<OutlineHarness content={longDocument('tail')} />);
    const first = headings;

    act(() => {
      view.rerender(<OutlineHarness content={longDocument('## Appendix')} />);
    });

    expect(headings).not.toBe(first);
    expect(headings.at(-1)).toEqual({ id: 'appendix', text: 'Appendix', level: 2 });
    view.unmount();
  });
});

function EditorHarness({ onReady }: { readonly onReady: (editor: Editor) => void }) {
  const [value, setValue] = useState(longDocument(''));
  return (
    <RichTextEditor
      value={value}
      onChange={setValue}
      ariaLabel="Body"
      testId="long-doc"
      onReady={onReady}
    />
  );
}

describe('typing into a long document', () => {
  it('parses the markdown into editor html once, not once per keystroke', async () => {
    counts.editorHtml = 0;
    const editor = await new Promise<Editor>((resolve) => {
      render(<EditorHarness onReady={resolve} />);
    });
    await waitFor(() => expect(counts.editorHtml).toBeGreaterThan(0));
    const afterMount = counts.editorHtml;
    expect(afterMount).toBe(1);

    editor.commands.focus('end');
    for (let stroke = 0; stroke < 12; stroke += 1) {
      editor.commands.insertContent('a');
    }
    await waitFor(() => expect(editor.getText()).toContain('aaaaaaaaaaaa'));

    expect(counts.editorHtml).toBe(afterMount);
  });
});
