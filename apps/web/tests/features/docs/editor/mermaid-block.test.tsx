import { describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import { STARTER_DIAGRAM } from '@/features/docs/editor/commands.ts';
import { editorHtmlFrom } from '@/features/docs/editor/editor-content.ts';
import { docToMarkdown } from '@/features/docs/editor/markdown.ts';
import { RichTextEditor } from '@/features/docs/editor/rich-text-editor.tsx';

const DIAGRAM = ['```mermaid', 'graph TD', '  A[Start] --> B[Ship]', '```'].join('\n');

function Harness({
  initial = '',
  onChange = mock(),
  onReady,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  onReady: (editor: Editor) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <RichTextEditor
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      ariaLabel="Body"
      testId="rich"
      onReady={onReady}
    />
  );
}

function mountEditor(props: Partial<Parameters<typeof Harness>[0]> = {}): Promise<Editor> {
  return new Promise((resolve) => {
    render(<Harness onReady={resolve} {...props} />);
  });
}

describe('a mermaid block in the rich editor', () => {
  it('opens a diagram fence as a code block that still knows its language', async () => {
    const editor = await mountEditor({ initial: DIAGRAM });

    await waitFor(() => {
      const block = editor.state.doc.firstChild;
      expect(block?.type.name).toBe('codeBlock');
      expect(block?.attrs['language']).toBe('mermaid');
    });
  });

  it('writes the fence back out unchanged, so the document round trips', async () => {
    const editor = await mountEditor({ initial: DIAGRAM });

    await waitFor(() => expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock'));
    expect(docToMarkdown(editor.getJSON()).trim()).toBe(DIAGRAM);
  });

  it('shows a preview beside the source only for a diagram, not for other code', async () => {
    await mountEditor({ initial: DIAGRAM });
    expect(await screen.findByTestId('mermaid-preview')).toBeInTheDocument();

    const other = render(<Harness initial={'```ts\nconst a = 1;\n```'} onReady={mock()} />);
    await waitFor(() => expect(other.container.querySelector('pre')).not.toBeNull());
    expect(other.container.querySelector('[data-testid=mermaid-preview]')).toBeNull();
  });

  it('drops a starter diagram in from the slash menu', async () => {
    const onChange = mock();
    const editor = await mountEditor({ onChange });
    editor.chain().focus().insertContent('/diagram').run();

    await screen.findByTestId('slash-diagram');
    await userEvent.setup().click(screen.getByTestId('slash-diagram'));

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('```mermaid'));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(STARTER_DIAGRAM);
  });

  it('is reachable by the words people search for', async () => {
    const editor = await mountEditor();
    editor.chain().focus().insertContent('/mermaid').run();

    expect(await screen.findByTestId('slash-diagram')).toBeInTheDocument();
  });
});

describe('the html the editor opens with', () => {
  it('keeps a mermaid fence as a pre and code pair the editor can parse', () => {
    const html = editorHtmlFrom(DIAGRAM);

    expect(html).toContain('language-mermaid');
    expect(html).toContain('<pre>');
  });
});
