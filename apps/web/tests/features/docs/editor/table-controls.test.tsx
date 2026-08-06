import { describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { RichTextEditor } from '../../../../src/features/docs/editor/rich-text-editor.tsx';

function Harness({
  onChange,
  onReady,
}: {
  onChange: (value: string) => void;
  onReady: (editor: Editor) => void;
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
        toolbar="full"
        onReady={onReady}
      />
    </TooltipProvider>
  );
}

function mountEditor(onChange: (value: string) => void): Promise<Editor> {
  return new Promise((resolve) => {
    render(<Harness onChange={onChange} onReady={resolve} />);
  });
}

function tableLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
}

function rows(markdown: string): string[][] {
  return tableLines(markdown)
    .filter((line) => !/^\|(?:\s*-+\s*\|)+$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
}

function rowIndexOf(markdown: string, text: string): number {
  return rows(markdown).findIndex((row) => row.includes(text));
}

function columnIndexOf(markdown: string, text: string): number {
  for (const row of rows(markdown)) {
    const at = row.indexOf(text);
    if (at !== -1) return at;
  }
  return -1;
}

function columnCount(markdown: string): number {
  return rows(markdown)[0]?.length ?? 0;
}

interface Mounted {
  readonly editor: Editor;
  readonly latest: () => string;
}

async function tableWithContent(): Promise<Mounted> {
  const onChange = mock();
  const editor = await mountEditor(onChange);
  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  editor.chain().focus().insertContent('head').run();
  editor.commands.goToNextCell();
  editor.commands.goToNextCell();
  editor.commands.goToNextCell();
  editor.chain().focus().insertContent('beta').run();
  await screen.findByTestId('rich-table-menu');
  const latest = () => String(onChange.mock.calls.at(-1)?.[0] ?? '');
  await waitFor(() => expect(rowIndexOf(latest(), 'beta')).toBe(1));
  return { editor, latest };
}

async function press(testId: string): Promise<void> {
  await userEvent.setup().click(screen.getByTestId(testId));
}

describe('table controls', () => {
  it('stays out of the way until the caret is inside a table', async () => {
    const editor = await mountEditor(mock());
    editor.chain().focus().insertContent('just a paragraph').run();

    await screen.findByTestId('rich-toolbar');
    expect(screen.queryByTestId('rich-table-menu')).toBeNull();
  });

  it('appears with every row and column operation once a table is inserted', async () => {
    await tableWithContent();

    const menu = screen.getByTestId('rich-table-menu');
    for (const label of [
      'Insert row above',
      'Insert row below',
      'Delete row',
      'Insert column left',
      'Insert column right',
      'Delete column',
      'Toggle header row',
      'Delete table',
    ]) {
      expect(within(menu).getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('inserts a row below the caret, leaving the current row where it was', async () => {
    const { latest } = await tableWithContent();
    expect(rows(latest())).toHaveLength(3);

    await press('rich-table-menu-row-after');

    await waitFor(() => expect(rows(latest())).toHaveLength(4));
    expect(rowIndexOf(latest(), 'beta')).toBe(1);
  });

  it('inserts a row above the caret, pushing the current row down', async () => {
    const { latest } = await tableWithContent();

    await press('rich-table-menu-row-before');

    await waitFor(() => expect(rows(latest())).toHaveLength(4));
    expect(rowIndexOf(latest(), 'beta')).toBe(2);
  });

  it('deletes the row the caret is in', async () => {
    const { latest } = await tableWithContent();

    await press('rich-table-menu-row-delete');

    await waitFor(() => expect(rows(latest())).toHaveLength(2));
    expect(rowIndexOf(latest(), 'beta')).toBe(-1);
    expect(rowIndexOf(latest(), 'head')).toBe(0);
  });

  it('inserts a column to the right, leaving the current column where it was', async () => {
    const { latest } = await tableWithContent();
    expect(columnCount(latest())).toBe(3);

    await press('rich-table-menu-column-after');

    await waitFor(() => expect(columnCount(latest())).toBe(4));
    expect(columnIndexOf(latest(), 'beta')).toBe(0);
  });

  it('inserts a column to the left, pushing the current column across', async () => {
    const { latest } = await tableWithContent();

    await press('rich-table-menu-column-before');

    await waitFor(() => expect(columnCount(latest())).toBe(4));
    expect(columnIndexOf(latest(), 'beta')).toBe(1);
  });

  it('deletes the column the caret is in', async () => {
    const { latest } = await tableWithContent();

    await press('rich-table-menu-column-delete');

    await waitFor(() => expect(columnCount(latest())).toBe(2));
    expect(columnIndexOf(latest(), 'beta')).toBe(-1);
    expect(columnIndexOf(latest(), 'head')).toBe(-1);
  });

  it('turns the header row into ordinary cells and back', async () => {
    await tableWithContent();
    const cells = () => screen.getByTestId('rich').querySelectorAll('th').length;
    expect(cells()).toBe(3);

    await press('rich-table-menu-header-row');
    await waitFor(() => expect(cells()).toBe(0));

    await press('rich-table-menu-header-row');
    await waitFor(() => expect(cells()).toBe(3));
  });

  it('deletes the whole table and takes its own menu away with it', async () => {
    const { latest } = await tableWithContent();

    await press('rich-table-menu-delete');

    await waitFor(() => expect(tableLines(latest())).toHaveLength(0));
    await waitFor(() => expect(screen.queryByTestId('rich-table-menu')).toBeNull());
  });
});
