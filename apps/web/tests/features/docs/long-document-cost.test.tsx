import { describe, expect, it } from 'bun:test';
import { act, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { useRef, useState } from 'react';
import { editorHtmlFrom } from '../../../src/features/docs/editor/editor-content.ts';
import { RichTextEditor } from '../../../src/features/docs/editor/rich-text-editor.tsx';
import type { DocHeading } from '../../../src/features/docs/outline.ts';
import { useEditorOutline } from '../../../src/features/docs/use-editor-outline.ts';

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

function EditorHarness({
  initial,
  onReady,
}: {
  readonly initial: string;
  readonly onReady: (editor: Editor) => void;
}) {
  const [value, setValue] = useState(initial);
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

function mountEditor(initial: string): Promise<Editor> {
  return new Promise((resolve) => {
    render(<EditorHarness initial={initial} onReady={resolve} />);
  });
}

async function type(editor: Editor, characters: number): Promise<void> {
  await act(() => {
    editor.commands.focus('end');
    for (let stroke = 0; stroke < characters; stroke += 1) {
      editor.commands.insertContent('a');
    }
  });
  await waitFor(() => expect(editor.getText()).toContain('a'.repeat(characters)));
}

describe('typing into a long document', () => {
  it('keeps the html the editor opened with instead of re-parsing the document', async () => {
    const opening = longDocument('tail');
    const editor = await mountEditor(opening);
    expect(editor.options.content).toBe(editorHtmlFrom(opening));

    await type(editor, 12);

    expect(editor.options.content).toBe(editorHtmlFrom(opening));
    expect(editorHtmlFrom(longDocument('tailaaaaaaaaaaaa'))).not.toBe(editorHtmlFrom(opening));
  });

  it('keeps handing tiptap the same extensions rather than a fresh set per keystroke', async () => {
    const editor = await mountEditor(longDocument('tail'));
    const opened = editor.options.extensions;

    await type(editor, 12);

    expect(editor.options.extensions).toBe(opened);
  });
});

describe('images in the editor', () => {
  it('are left for the browser to fetch when they scroll into view', async () => {
    const editor = await mountEditor('# Doc\n\n![a](https://x.dev/a.png)\n');
    const image = editor.view.dom.querySelector('img');

    expect(image).not.toBeNull();
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('decoding')).toBe('async');
  });
});
