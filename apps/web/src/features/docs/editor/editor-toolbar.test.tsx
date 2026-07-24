import { describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { RichTextEditor } from './rich-text-editor.tsx';

function Harness({
  onChange,
  onReady,
  variant = 'full',
}: {
  onChange: (value: string) => void;
  onReady: (editor: Editor) => void;
  variant?: 'full' | 'compact';
}) {
  const [value, setValue] = useState('');
  return (
    <TooltipProvider>
      <RichTextEditor
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        ariaLabel="Body"
        testId="rich"
        toolbar={variant}
        onReady={onReady}
      />
    </TooltipProvider>
  );
}

function mountEditor(
  onChange: (value: string) => void,
  variant: 'full' | 'compact' = 'full',
): Promise<Editor> {
  return new Promise((resolve) => {
    render(<Harness onChange={onChange} onReady={resolve} variant={variant} />);
  });
}

async function selectAll(editor: Editor, text: string): Promise<void> {
  editor.chain().focus().insertContent(text).run();
  editor.commands.setTextSelection({ from: 1, to: text.length + 1 });
  await screen.findByTestId('rich-toolbar');
}

describe('rich text toolbar', () => {
  it('renders the persistent formatting controls', async () => {
    const editor = await mountEditor(mock());
    editor.chain().focus().run();
    const toolbar = await screen.findByTestId('rich-toolbar');
    expect(within(toolbar).getByLabelText('Bold')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Underline')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Highlight')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Task list')).toBeInTheDocument();
    expect(screen.getByTestId('rich-toolbar-block')).toBeInTheDocument();
  });

  it('applies underline to the selection from the toolbar', async () => {
    const onChange = mock();
    const editor = await mountEditor(onChange);
    await selectAll(editor, 'underline me');

    const toolbar = screen.getByTestId('rich-toolbar');
    await userEvent.setup().click(within(toolbar).getByLabelText('Underline'));

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('<u>underline me</u>'));
  });

  it('applies highlight to the selection from the toolbar', async () => {
    const onChange = mock();
    const editor = await mountEditor(onChange);
    await selectAll(editor, 'mark me');

    const toolbar = screen.getByTestId('rich-toolbar');
    await userEvent.setup().click(within(toolbar).getByLabelText('Highlight'));

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('<mark>mark me</mark>'));
  });

  it('reflects the active block type after a heading is applied', async () => {
    const editor = await mountEditor(mock());
    editor.chain().focus().insertContent('title').run();
    await screen.findByTestId('rich-toolbar');

    editor.chain().focus().toggleHeading({ level: 2 }).run();

    await waitFor(() =>
      expect(screen.getByTestId('rich-toolbar-block').textContent).toContain('Heading 2'),
    );
  });
});

describe('compact rich text toolbar', () => {
  it('shows the essential controls and hides the heavy blocks', async () => {
    await mountEditor(mock(), 'compact');
    const toolbar = await screen.findByTestId('rich-toolbar');
    expect(within(toolbar).getByLabelText('Bold')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Bulleted list')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Code block')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Link')).toBeInTheDocument();
    expect(screen.queryByTestId('rich-toolbar-block')).toBeNull();
    expect(within(toolbar).queryByLabelText('Table')).toBeNull();
    expect(within(toolbar).queryByLabelText('Task list')).toBeNull();
  });

  it('applies bold to the selection from the compact toolbar', async () => {
    const onChange = mock();
    const editor = await mountEditor(onChange, 'compact');
    editor.chain().focus().insertContent('ship').run();
    editor.commands.setTextSelection({ from: 1, to: 5 });
    await screen.findByTestId('rich-toolbar');

    await userEvent
      .setup()
      .click(within(screen.getByTestId('rich-toolbar')).getByLabelText('Bold'));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('**ship**'));
  });
});
