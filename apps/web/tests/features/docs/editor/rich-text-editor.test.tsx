import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import type { Member } from '@/lib/query/schemas.ts';
import {
  type BubbleAnchor,
  bubblePosition,
  RichTextEditor,
  settledMarkdown,
  type UploadedAttachment,
} from '../../../../src/features/docs/editor/rich-text-editor.tsx';

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
  onUpload,
  onComment,
}: {
  onChange?: (value: string) => void;
  onReady: (editor: Editor) => void;
  onCancel?: () => void;
  onUpload?: (file: File) => Promise<UploadedAttachment>;
  onComment?: (range: { from: number; to: number }) => void;
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
      {...(onUpload === undefined ? {} : { onUpload })}
      {...(onComment === undefined ? {} : { onComment })}
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

async function neverUploads(): Promise<UploadedAttachment> {
  return await Promise.reject(new Error('This test never finishes an upload.'));
}

describe('attaching a file from the slash menu', () => {
  it('finds the attachment command by the words people actually type', async () => {
    const editor = await mountEditor({ onUpload: neverUploads });
    editor.chain().focus().insertContent('/attach').run();

    expect(await screen.findByTestId('slash-image')).toBeInTheDocument();
  });

  it('opens the file picker when the attachment command is chosen', async () => {
    const editor = await mountEditor({ onUpload: neverUploads });
    const opened = mock();
    screen.getByTestId('rich-file').addEventListener('click', opened);

    editor.chain().focus().insertContent('/file').run();
    await screen.findByTestId('slash-image');
    await userEvent.setup().click(screen.getByTestId('slash-image'));

    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  });

  it('has no file input at all when the surface cannot take uploads', async () => {
    await mountEditor();
    expect(screen.queryByTestId('rich-file')).toBeNull();
  });

  it('embeds an image and links anything else, using the url the upload reported', async () => {
    const onChange = mock();
    const onUpload = mock(
      async (file: File): Promise<UploadedAttachment> =>
        await Promise.resolve({
          url: `/api/files/org/${file.name}`,
          fileName: file.name,
          contentType: file.type,
        }),
    );
    await mountEditor({ onChange, onUpload });
    const input = screen.getByTestId('rich-file');
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(input, new File(['x'], 'shot.png', { type: 'image/png' }));
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('![shot.png](/api/files/org/shot.png)'),
    );

    await user.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('[notes.txt](/api/files/org/notes.txt)'),
    );
    expect(onUpload).toHaveBeenCalledTimes(2);
  });
});

describe('pasting markdown', () => {
  it('inserts formatted blocks and emits canonical markdown', async () => {
    const onChange = mock();
    const editor = await mountEditor({ onChange });
    const source = [
      '## Plan',
      '',
      'Read the **release notes** in [the docs](https://orbit.test/docs).',
      '',
      '- [ ] Ship it',
    ].join('\n');

    const user = userEvent.setup();
    await user.click(editor.view.dom);
    await user.paste(source);

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe(source));
    expect(editor.view.dom.querySelector('h2')?.textContent).toBe('Plan');
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('release notes');
    expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://orbit.test/docs',
    );
    expect(editor.view.dom.querySelector('ul[data-type="taskList"]')).not.toBeNull();
  });

  it('leaves ordinary pasted text on the native editor path', async () => {
    const onChange = mock();
    const editor = await mountEditor({ onChange });

    const user = userEvent.setup();
    await user.click(editor.view.dom);
    await user.paste('Everything is fine now.');

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe('Everything is fine now.'));
  });

  it('keeps pasted markdown literal inside a code block', async () => {
    const onChange = mock();
    const editor = await mountEditor({ onChange });
    const user = userEvent.setup();

    await user.click(editor.view.dom);
    editor.chain().setCodeBlock().run();
    await user.paste('**text**');

    await waitFor(() =>
      expect(editor.view.dom.querySelector('code')?.textContent).toBe('**text**'),
    );
    expect(editor.view.dom.querySelector('strong')).toBeNull();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('**text**');
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

  it('leaves the comment control out when the surface takes no comments', async () => {
    const editor = await mountEditor();
    editor.chain().focus().insertContent('format me').run();
    editor.commands.setTextSelection({ from: 1, to: 7 });

    const bubble = await screen.findByTestId('rich-bubble');
    expect(bubble.querySelector('[aria-label=Comment]')).toBeNull();
  });

  it('offers Comment over a selection and reports the range that was picked', async () => {
    const onComment = mock((_range: { from: number; to: number }) => undefined);
    const editor = await mountEditor({ onComment });
    editor.chain().focus().insertContent('The launch is blocked').run();
    editor.commands.setTextSelection({ from: 5, to: 11 });

    const bubble = await screen.findByTestId('rich-bubble');
    const control = bubble.querySelector('[aria-label=Comment]');
    expect(control).not.toBeNull();

    if (control !== null) await userEvent.setup().click(control as HTMLElement);

    expect(onComment).toHaveBeenCalledWith({ from: 5, to: 11 });
  });
});

describe('opening a stored document without touching it', () => {
  it('reports the same markdown it was handed, so an idle open is never a save', () => {
    const stored = '# Realtime delta protocol\n\nEvery mutation writes to Postgres.';

    expect(settledMarkdown(`${stored}\n`)).toBe(stored);
    expect(settledMarkdown(stored)).toBe(stored);
  });

  it('settles however many trailing blank lines the serializer leaves behind', () => {
    expect(settledMarkdown('Body\n\n\n')).toBe('Body');
  });

  it('leaves the body alone, trailing spaces and inner blank lines included', () => {
    expect(settledMarkdown('One\n\nTwo')).toBe('One\n\nTwo');
    expect(settledMarkdown('Trailing spaces   ')).toBe('Trailing spaces   ');
  });
});

describe('keyboard saving', () => {
  for (const modifier of ['metaKey', 'ctrlKey']) {
    it(`saves before the editor changes the document with ${modifier}`, async () => {
      const onChange = mock();
      const onForceSave = mock();
      render(
        <RichTextEditor
          value="Keep this text"
          onChange={onChange}
          onForceSave={onForceSave}
          ariaLabel="Body"
        />,
      );
      const textbox = await screen.findByRole('textbox', { name: 'Body' });
      onChange.mockClear();
      fireEvent.keyDown(textbox, { key: 'Enter', [modifier]: true });
      expect(onForceSave).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
      expect(textbox.textContent).toBe('Keep this text');
    });
  }

  for (const modifier of ['metaKey', 'ctrlKey']) {
    it(`does not save during IME composition with ${modifier}`, async () => {
      const onChange = mock();
      const onForceSave = mock();
      render(
        <RichTextEditor
          value="Keep this text"
          onChange={onChange}
          onForceSave={onForceSave}
          ariaLabel="Body"
        />,
      );
      const textbox = await screen.findByRole('textbox', { name: 'Body' });
      onChange.mockClear();
      fireEvent.compositionStart(textbox);
      fireEvent.keyDown(textbox, { key: 'Enter', [modifier]: true, isComposing: true });
      expect(onForceSave).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(textbox.textContent).toBe('Keep this text');
    });
  }

  it('keeps Shift+Enter available for intentional line breaks', async () => {
    const onChange = mock();
    const editor = await mountEditor({ onChange });
    editor.commands.setContent('<p>First line</p>');
    editor.commands.setTextSelection('First line'.length + 1);
    fireEvent.keyDown(editor.view.dom, { key: 'Enter', shiftKey: true });
    expect(editor.getJSON().content?.[0]?.content?.at(-1)?.type).toBe('hardBreak');
  });
});

describe('bubble placement inside the editor box', () => {
  const box = { width: 397, height: 560 };
  const size = { width: 196, height: 40 };
  const anchored = (center: number, top: number, bottom: number): BubbleAnchor => ({
    center,
    top,
    bottom,
    width: box.width,
    height: box.height,
  });

  it('clamps the first word of a narrow drawer inside the left edge', () => {
    const centred = 23 - size.width / 2;

    expect(centred).toBeLessThan(0);
    expect(bubblePosition(anchored(23, 100, 116), size)).toEqual({ left: 8, top: 52 });
  });

  it('clamps a selection at the right edge back inside', () => {
    expect(bubblePosition(anchored(390, 100, 116), size)).toEqual({ left: 193, top: 52 });
  });

  it('keeps centring the popover where the selection has room on both sides', () => {
    const wide: BubbleAnchor = { center: 400, top: 300, bottom: 316, width: 800, height: 560 };

    expect(bubblePosition(wide, size)).toEqual({ left: 302, top: 252 });
  });

  it('flips below the selection when the first line has no room above it', () => {
    expect(bubblePosition(anchored(200, 4, 20), size)).toEqual({ left: 102, top: 28 });
  });

  it('keeps the popover inside a box shorter than the space it asks for', () => {
    const cramped: BubbleAnchor = { center: 200, top: 0, bottom: 16, width: 397, height: 40 };

    expect(bubblePosition(cramped, size)).toEqual({ left: 102, top: 8 });
  });

  it('holds the left margin when the popover is wider than the box', () => {
    const narrow: BubbleAnchor = { center: 200, top: 100, bottom: 116, width: 160, height: 560 };

    expect(bubblePosition(narrow, { width: 240, height: 40 })).toEqual({ left: 8, top: 52 });
  });
});

describe('selection bubble in a narrow drawer', () => {
  const original = Element.prototype.getBoundingClientRect;

  function drawerBox(width: number, height: number): DOMRect {
    return {
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({ width, height }),
    };
  }

  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const id = this instanceof HTMLElement ? this.dataset['testid'] : undefined;
      if (id === 'rich') return drawerBox(397, 560);
      if (id === 'rich-bubble') return drawerBox(196, 40);
      return original.call(this);
    };
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = original;
  });

  it('keeps the popover inside the box when the selection starts at the left edge', async () => {
    const editor = await mountEditor();
    editor.view.coordsAtPos = () => ({ left: 12, right: 34, top: 100, bottom: 116 });
    editor.chain().focus().insertContent('format me').run();
    editor.commands.setTextSelection({ from: 1, to: 7 });

    const bubble = await screen.findByTestId('rich-bubble');
    await waitFor(() => expect(bubble.style.left).toBe('8px'));
    expect(bubble.style.top).toBe('52px');
  });

  it('places the popover below the last selected line when there is no room above', async () => {
    const editor = await mountEditor();
    editor.view.coordsAtPos = (position) =>
      position === 22
        ? { left: 34, right: 56, top: 68, bottom: 84 }
        : { left: 12, right: 34, top: 4, bottom: 20 };
    editor.chain().focus().insertContent('<p>first line</p><p>last line</p>').run();
    editor.commands.setTextSelection({ from: 1, to: 22 });

    const bubble = await screen.findByTestId('rich-bubble');
    await waitFor(() => expect(bubble.style.top).toBe('92px'));
    expect(bubble.style.left).toBe('8px');
  });

  it('flips the popover below the first line when there is no room above it', async () => {
    const editor = await mountEditor();
    editor.view.coordsAtPos = () => ({ left: 12, right: 34, top: 4, bottom: 20 });
    editor.chain().focus().insertContent('format me').run();
    editor.commands.setTextSelection({ from: 1, to: 7 });

    const bubble = await screen.findByTestId('rich-bubble');
    await waitFor(() => expect(bubble.style.top).toBe('28px'));
    expect(bubble.style.left).toBe('8px');
  });
});
