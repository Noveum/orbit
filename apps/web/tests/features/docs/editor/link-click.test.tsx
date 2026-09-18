import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openableHref } from '../../../../src/features/docs/editor/link-click.ts';
import { RichTextEditor } from '../../../../src/features/docs/editor/rich-text-editor.tsx';

const realOpen = globalThis.window.open;
let opened: ReturnType<typeof mock>;

function blockNavigation(event: Event): void {
  event.preventDefault();
}

beforeEach(() => {
  opened = mock(() => null);
  globalThis.window.open = opened as unknown as typeof window.open;
  globalThis.document.addEventListener('click', blockNavigation, true);
});

afterEach(() => {
  globalThis.document.removeEventListener('click', blockNavigation, true);
  globalThis.window.open = realOpen;
});

function renderDescription(value: string, editable = true) {
  render(
    <RichTextEditor
      value={value}
      onChange={mock()}
      ariaLabel="Issue description"
      editable={editable}
    />,
  );
}

describe('opening links from an editable description', () => {
  it('opens a link in a new tab with no reference back to Orbit', async () => {
    const user = userEvent.setup();
    renderDescription('PR: [936](https://github.com/Noveum/orbit/pull/936)');

    await user.click(await screen.findByRole('link', { name: '936' }));

    expect(opened).toHaveBeenCalledWith(
      'https://github.com/Noveum/orbit/pull/936',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('leaves a click that is not on a link alone', async () => {
    const user = userEvent.setup();
    renderDescription('Nothing to follow here.');

    await user.click(await screen.findByText('Nothing to follow here.'));

    expect(opened).not.toHaveBeenCalled();
  });

  it('leaves the text beside a link alone', async () => {
    const user = userEvent.setup();
    renderDescription('Read [the notes](https://example.com/notes) later');

    await user.click(await screen.findByRole('link', { name: 'the notes' }));
    expect(opened).toHaveBeenCalledTimes(1);

    await user.click(await screen.findByText(/Read/));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('does not take over a link while the editor is read only', async () => {
    const user = userEvent.setup();
    renderDescription('PR: [936](https://github.com/Noveum/orbit/pull/936)', false);

    await user.click(await screen.findByRole('link', { name: '936' }));

    expect(opened).not.toHaveBeenCalled();
  });
});

describe('deciding which hrefs may be opened', () => {
  const base = 'https://orbit.test/issues/AM-215';

  it('resolves a relative href against the document', () => {
    expect(openableHref('/issues/AM-1', base)).toBe('https://orbit.test/issues/AM-1');
    expect(openableHref('AM-1', base)).toBe('https://orbit.test/issues/AM-1');
  });

  it('keeps http, https and mailto', () => {
    expect(openableHref('https://example.com/a', base)).toBe('https://example.com/a');
    expect(openableHref('http://example.com/a', base)).toBe('http://example.com/a');
    expect(openableHref('mailto:ada@example.com', base)).toBe('mailto:ada@example.com');
  });

  it('refuses a scheme that could run code or reach the file system', () => {
    expect(openableHref('javascript:alert(1)', base)).toBeNull();
    expect(openableHref('data:text/html,<script>alert(1)</script>', base)).toBeNull();
    expect(openableHref('file:///etc/passwd', base)).toBeNull();
    expect(openableHref('vbscript:msgbox(1)', base)).toBeNull();
  });

  it('refuses an empty or missing href', () => {
    expect(openableHref(null, base)).toBeNull();
    expect(openableHref('   ', base)).toBeNull();
  });

  it('leaves a jump inside the same document to the page', () => {
    expect(openableHref('#summary', base)).toBeNull();
    expect(openableHref(`${base}#summary`, base)).toBeNull();
  });

  it('still opens a fragment that points at another document', () => {
    expect(openableHref('https://example.com/a#summary', base)).toBe(
      'https://example.com/a#summary',
    );
    expect(openableHref('/issues/AM-1#summary', base)).toBe(
      'https://orbit.test/issues/AM-1#summary',
    );
    expect(openableHref('?tab=activity#summary', base)).toBe(
      'https://orbit.test/issues/AM-215?tab=activity#summary',
    );
  });
});
