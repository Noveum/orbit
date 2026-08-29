import { afterEach, describe, expect, it } from 'bun:test';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from '@/test/render.tsx';
import { HtmlDocEditor } from '../../../src/features/docs/html-doc-editor.tsx';

afterEach(() => {
  cleanup();
});

describe('the html page editor', () => {
  it('starts in split view so source and the live page are both visible', () => {
    render(<HtmlDocEditor title="Board" content="<p>ok</p>" onChange={() => undefined} />);
    expect(screen.getByTestId('html-code-editor-host')).toBeTruthy();
    expect(screen.getByTestId('html-preview')).toBeTruthy();
    expect(screen.getByTestId('html-view-split').getAttribute('aria-pressed')).toBe('true');
  });

  it('puts a drag handle between source and preview', () => {
    render(<HtmlDocEditor title="Board" content="<p>ok</p>" onChange={() => undefined} />);
    const handle = screen.getByTestId('split-pane-handle');
    expect(handle.getAttribute('aria-label')).toBe('Resize source and preview');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('hides the source when preview is selected', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<HtmlDocEditor title="Board" content="<p>ok</p>" onChange={() => undefined} />);
    await user.click(screen.getByTestId('html-view-preview'));
    expect(screen.queryByTestId('html-code-editor-host')).toBeNull();
    expect(screen.getByTestId('html-preview')).toBeTruthy();
    expect(screen.queryByTestId('split-pane-handle')).toBeNull();
  });

  it('keeps comments collapsed so the page fills the pane', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <HtmlDocEditor
        title="Board"
        content="<p>ok</p>"
        onChange={() => undefined}
        footer={<div data-testid="html-footer">notes</div>}
      />,
    );
    expect(screen.queryByTestId('html-comments-panel')).toBeNull();
    await user.click(screen.getByTestId('html-comments-toggle'));
    expect(screen.getByTestId('html-footer').textContent).toBe('notes');
  });
});
