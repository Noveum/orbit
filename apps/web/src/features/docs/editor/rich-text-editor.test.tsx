import { describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import type { Member } from '@/lib/query/schemas.ts';
import { RichTextEditor } from './rich-text-editor.tsx';

const members: readonly Member[] = [
  {
    id: 'u1',
    name: 'Shashank Agarwal',
    email: 's@x.co',
    image: null,
    handle: 'shashank',
    role: 'member',
  },
  { id: 'u2', name: 'Aditi Rao', email: 'a@x.co', image: null, handle: 'aditi', role: 'member' },
];

function Harness({
  onChange = mock(),
  onReady,
  onCancel,
}: {
  onChange?: (value: string) => void;
  onReady: (editor: Editor) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <RichTextEditor
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      members={members}
      ariaLabel="Body"
      testId="rich"
      onReady={onReady}
      {...(onCancel === undefined ? {} : { onCancel })}
    />
  );
}

function mountEditor(props: Partial<Parameters<typeof Harness>[0]> = {}): Promise<Editor> {
  return new Promise((resolve) => {
    render(<Harness onReady={resolve} {...props} />);
  });
}

describe('slash menu', () => {
  it('opens with a listbox and options once a slash is typed', async () => {
    const editor = await mountEditor();
    editor.chain().focus().insertContent('/').run();

    const menu = await screen.findByTestId('slash-menu');
    expect(menu.getAttribute('role')).toBe('listbox');
    expect(screen.getByTestId('slash-task-list')).toBeInTheDocument();
    expect(screen.getByTestId('slash-code-block')).toBeInTheDocument();
  });

  it('filters as the query narrows and inserts the chosen block', async () => {
    const onChange = mock();
    const editor = await mountEditor({ onChange });
    editor.chain().focus().insertContent('/table').run();

    await screen.findByTestId('slash-table');
    expect(screen.queryByTestId('slash-code-block')).toBeNull();

    await userEvent.setup().click(screen.getByTestId('slash-table'));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('| --- | --- | --- |'));
  });

  it('is keyboard operable end to end with aria-activedescendant', async () => {
    const onChange = mock();
    const editor = await mountEditor({ onChange });
    const dom = editor.view.dom;
    editor.chain().focus().insertContent('/').run();

    await screen.findByTestId('slash-menu');
    const user = userEvent.setup();
    await waitFor(() => expect(dom.getAttribute('aria-activedescendant')).toBeTruthy());

    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      const active = dom.getAttribute('aria-activedescendant');
      expect(active).toBe(document.querySelector('[role=option][aria-selected=true]')?.id ?? null);
    });

    await user.keyboard('{Enter}');
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('slash-menu')).toBeNull();
  });
});

describe('mention menu', () => {
  it('offers members and inserts a handle without leaving a trigger character', async () => {
    const onChange = mock();
    const editor = await mountEditor({ onChange });
    editor.chain().focus().insertContent('@').run();

    await screen.findByTestId('mention-list');
    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('@aditi'));
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain('@@');
  });

  it('closes on escape and then lets escape cancel the draft', async () => {
    const onCancel = mock();
    const editor = await mountEditor({ onCancel });
    editor.chain().focus().insertContent('@').run();

    await screen.findByTestId('mention-list');
    const user = userEvent.setup();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByTestId('mention-list')).toBeNull());
    expect(onCancel).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('selection bubble menu', () => {
  it('appears over a text selection with the formatting controls', async () => {
    const editor = await mountEditor();
    editor.chain().focus().insertContent('format me').run();
    editor.commands.setTextSelection({ from: 1, to: 7 });

    const bubble = await screen.findByTestId('rich-bubble');
    expect(bubble.querySelector('[aria-label=Bold]')).not.toBeNull();
    expect(bubble.querySelector('[aria-label=Link]')).not.toBeNull();
  });
});
