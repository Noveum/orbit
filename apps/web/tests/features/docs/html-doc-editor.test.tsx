import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import userEvent from '@testing-library/user-event';
import {
  DOC_PREFERENCES_STORAGE_KEY,
  resetDocPreferences,
} from '@/features/docs/use-doc-preferences.ts';
import { cleanup, render, screen } from '@/test/render.tsx';
import { HtmlDocEditor } from '../../../src/features/docs/html-doc-editor.tsx';

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.localStorage.removeItem(DOC_PREFERENCES_STORAGE_KEY);
  resetDocPreferences();
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  window.localStorage.removeItem(DOC_PREFERENCES_STORAGE_KEY);
  resetDocPreferences();
});

describe('the html page editor', () => {
  it('places the editable title and view controls in the same toolbar', () => {
    render(
      <HtmlDocEditor
        title="Board"
        titleControl={<input aria-label="Doc title" defaultValue="Board" />}
        content="<p>ok</p>"
        onChange={() => undefined}
      />,
    );
    const toolbar = screen.getByTestId('html-view-preview').parentElement;
    expect(toolbar?.contains(screen.getByRole('textbox', { name: 'Doc title' }))).toBe(true);
  });

  it('starts in split view so source and the live page are both visible', () => {
    render(<HtmlDocEditor title="Board" content="<p>ok</p>" onChange={() => undefined} />);
    expect(screen.getByTestId('html-code-editor-host')).toBeTruthy();
    expect(screen.getByTestId('html-preview')).toBeTruthy();
    expect(screen.getByTestId('html-view-split').getAttribute('aria-pressed')).toBe('true');
  });

  it.each([false, true])('orients the split for desktop=%s', (wide) => {
    window.matchMedia = (query) => ({ ...originalMatchMedia(query), matches: wide });
    render(<HtmlDocEditor title="Board" content="<p>ok</p>" onChange={() => undefined} />);
    const handle = screen.getByTestId('split-pane-handle');
    expect(handle.getAttribute('aria-label')).toBe('Resize source and preview');
    expect(handle.getAttribute('aria-orientation')).toBe(wide ? 'vertical' : 'horizontal');
  });

  it('hides the source when preview is selected', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<HtmlDocEditor title="Board" content="<p>ok</p>" onChange={() => undefined} />);
    await user.click(screen.getByTestId('html-view-preview'));
    expect(screen.queryByTestId('html-code-editor-host')).toBeNull();
    expect(screen.getByTestId('html-preview')).toBeTruthy();
    expect(screen.queryByTestId('split-pane-handle')).toBeNull();
  });

  it('honors a saved preview preference without mounting editable source', () => {
    window.localStorage.setItem(DOC_PREFERENCES_STORAGE_KEY, JSON.stringify({ mode: 'preview' }));
    resetDocPreferences();
    render(<HtmlDocEditor title="Board" content="<p>ok</p>" onChange={() => undefined} />);
    expect(screen.queryByTestId('html-code-editor-host')).toBeNull();
    expect(screen.getByTestId('html-preview')).toBeTruthy();
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
