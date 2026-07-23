import { renderMarkdown, summarize } from '@orbit/services/markdown';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentMarkdown,
  insertBlock,
  linkSelection,
  replaceSlashQuery,
  SNIPPETS,
  wrapSelection,
} from './markdown-input.ts';
import { outlineOf, readTimeMinutes, slugify } from './outline.ts';
import { AUTOSAVE_DELAY_MS, useAutosave } from './use-autosave.ts';

describe('outlineOf', () => {
  it('collects headings, strips inline marks, and skips fenced code', () => {
    const outline = outlineOf(
      '# Realtime **protocol**\n\n```md\n# Not a heading\n```\n\n## Action shape\n\n### `Rules`\n\n#### Too deep\n',
    );
    expect(outline).toEqual([
      { id: 'realtime-protocol', text: 'Realtime protocol', level: 1 },
      { id: 'action-shape', text: 'Action shape', level: 2 },
      { id: 'rules', text: 'Rules', level: 3 },
    ]);
  });

  it('keeps duplicate headings addressable', () => {
    expect(outlineOf('## Setup\n\n## Setup\n').map((entry) => entry.id)).toEqual([
      'setup',
      'setup-1',
    ]);
    expect(slugify('   ')).toBe('section');
  });

  it('never reports less than a minute of reading', () => {
    expect(readTimeMinutes('')).toBe(1);
    expect(readTimeMinutes('word '.repeat(660))).toBe(3);
  });
});

describe('markdown pipeline wiring', () => {
  it('renders the doc constructs the reader relies on', () => {
    const html = renderMarkdown(
      '## Rules\n\n| Rule | Why |\n| --- | --- |\n| Batch | Speed |\n\n- [x] Done\n- [ ] Next\n\n`inline`\n\n```ts\nconst a = 1;\n```\n',
    );
    expect(html).toContain('<h2>Rules</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Rule</th>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<code>inline</code>');
    expect(html).toContain('<pre>');
  });

  it('strips scripts and event handlers before they reach the reader', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('summarizes a doc body into a plain excerpt', () => {
    expect(summarize('# Title\n\nSome **body** text.', 40)).toBe('Title Some body text.');
  });
});

describe('markdown input helpers', () => {
  it('wraps and unwraps a selection', () => {
    const bold = wrapSelection({ value: 'make it loud', start: 8, end: 12 }, '**');
    expect(bold.value).toBe('make it **loud**');
    expect(bold.value.slice(bold.start, bold.end)).toBe('loud');

    const undone = wrapSelection({ value: bold.value, start: 8, end: 16 }, '**');
    expect(undone.value).toBe('make it loud');
  });

  it('builds a link with the url selected', () => {
    const result = linkSelection({ value: 'see docs', start: 4, end: 8 });
    expect(result.value).toBe('see [docs](https://)');
    expect(result.value.slice(result.start, result.end)).toBe('https://');
  });

  it('inserts a block on its own line and replaces the slash query', () => {
    expect(insertBlock({ value: 'intro', start: 5, end: 5 }, SNIPPETS.tasks).value).toBe(
      `intro\n\n${SNIPPETS.tasks}`,
    );
    expect(
      replaceSlashQuery({ value: 'intro\n\n/tab', start: 11, end: 11 }, SNIPPETS.table).value,
    ).toBe(`intro\n\n${SNIPPETS.table}`);
  });

  it('picks image markdown only for images', () => {
    expect(attachmentMarkdown('a.png', 'image/png', '/f/a')).toBe('![a.png](/f/a)');
    expect(attachmentMarkdown('a.pdf', 'application/pdf', '/f/a')).toBe('[a.pdf](/f/a)');
  });
});

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves once after the caller stops typing', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave({ value, save }), {
      initialProps: { value: 'a' },
    });

    expect(result.current.status).toBe('saved');

    rerender({ value: 'ab' });
    rerender({ value: 'abc' });
    expect(result.current.status).toBe('unsaved');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
    expect(result.current.status).toBe('saved');
  });

  it('forces a save immediately and reports a failure', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const { result, rerender } = renderHook(({ value }) => useAutosave({ value, save }), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    await act(async () => {
      result.current.saveNow();
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
