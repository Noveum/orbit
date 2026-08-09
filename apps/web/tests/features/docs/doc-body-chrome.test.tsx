import { afterEach, describe, expect, it } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COPIED_LABEL, COPY_LABEL, DocBody, docProseClassName } from '@/features/docs/doc-body.tsx';

afterEach(cleanup);

function stubClipboard(): { value: string } {
  const captured = { value: '' };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (value: string) => {
        captured.value = value;
        return Promise.resolve();
      },
    },
  });
  return captured;
}

describe('a table in a doc', () => {
  it('sits in its own scroller so a wide table never scrolls the page', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
    render(<DocBody html={html} />);

    const scroller = screen.getByTestId('doc-body').querySelector('[data-table-scroll]');
    expect(scroller).not.toBeNull();
    expect(scroller?.querySelector('table')).not.toBeNull();
  });
});

describe('a code block in a doc', () => {
  it('carries its language as an attribute, never as text that search would pick up', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    render(<DocBody html={html} />);

    const block = screen.getByTestId('doc-body').querySelector('[data-code-block]');
    expect(block?.getAttribute('data-code-language')).toBe('ts');
    expect(screen.getByTestId('doc-body').textContent).not.toContain('tsconst');
  });

  it('offers a copy button that puts the code on the clipboard', async () => {
    const user = userEvent.setup();
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    render(<DocBody html={html} />);
    const clipboard = stubClipboard();

    const button = screen.getByLabelText('Copy the code');
    expect(button.textContent).toBe(COPY_LABEL);
    await user.click(button);

    expect(clipboard.value).toContain('const a = 1;');
    await waitFor(() => expect(button.textContent).toBe(COPIED_LABEL));
  });

  it('adds one copy button per block, however often the body re renders', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    const view = render(<DocBody html={html} />);
    view.rerender(<DocBody html={html} />);

    expect(screen.getAllByLabelText('Copy the code')).toHaveLength(1);
  });
});

describe('reading a document', () => {
  it('puts body text at the strong colour, not the muted one', () => {
    expect(docProseClassName).toContain('text-text');
    expect(docProseClassName).not.toContain('text-base text-muted');
  });

  it('gives body copy room to breathe', () => {
    expect(docProseClassName).toContain('leading-[1.75]');
  });
});
