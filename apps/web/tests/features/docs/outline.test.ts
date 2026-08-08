import { describe, expect, it } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { extractHeadings, headingLineNumbers } from '../../../src/features/docs/outline.ts';

const MARKDOWN = [
  '# Global rules',
  '',
  '## Delete remote branch after merging a PR',
  '',
  'body',
  '',
  '## PR descriptions: one-liner only',
  '',
  'body',
].join('\n');

describe('extractHeadings', () => {
  it('reads the ids the server baked into the rendered html', () => {
    const headings = extractHeadings(renderMarkdownWithHeadingIds(MARKDOWN));

    expect(headings).toEqual([
      { id: 'global-rules', text: 'Global rules', level: 1 },
      {
        id: 'delete-remote-branch-after-merging-a-pr',
        text: 'Delete remote branch after merging a PR',
        level: 2,
      },
      { id: 'pr-descriptions-one-liner-only', text: 'PR descriptions: one-liner only', level: 2 },
    ]);
  });

  it('reads through inline markup and entities to the heading text', () => {
    expect(extractHeadings(renderMarkdownWithHeadingIds('## Batch & `sync_id`\n'))).toEqual([
      { id: 'batch-sync-id', text: 'Batch & sync_id', level: 2 },
    ]);
  });

  it('ignores headings without an id and returns nothing for plain html', () => {
    expect(extractHeadings('<h2>No id here</h2>')).toEqual([]);
  });
});

describe('headingLineNumbers', () => {
  it('finds the line each heading sits on', () => {
    const source = ['# One', 'body', '', '## Two', 'more', '### Three'].join('\n');
    expect(headingLineNumbers(source)).toEqual([0, 3, 5]);
  });

  it('ignores a hash inside a fenced code block', () => {
    const source = ['# Real', '```sh', '# not a heading', '```', '## Also real'].join('\n');
    expect(headingLineNumbers(source)).toEqual([0, 4]);
  });

  it('keeps counting after a fence closed by a longer run', () => {
    const source = ['```', '# hidden', '````', '# after'].join('\n');
    expect(headingLineNumbers(source)).toEqual([3]);
  });

  it('does not let a marker with text after it close a fence', () => {
    const source = ['```', '```not-a-closer', '# still hidden', '```', '# after'].join('\n');
    expect(headingLineNumbers(source)).toEqual([4]);
  });

  it('stays in step with the rendered outline when a fence holds a fence-like line', () => {
    const source = ['# One', '```', '```js', '# hidden', '```', '## Two'].join('\n');
    const rendered = extractHeadings(renderMarkdownWithHeadingIds(source));
    expect(headingLineNumbers(source)).toHaveLength(rendered.length);
  });

  it('counts a setext heading at the line its text sits on', () => {
    const source = ['Title', '=====', '', '# Later'].join('\n');
    expect(headingLineNumbers(source)).toEqual([0, 3]);
  });

  it('lines up one for one with the rendered outline', () => {
    const source = ['# One', '```', '# hidden', '```', 'Two', '---', '### Three'].join('\n');
    const rendered = extractHeadings(renderMarkdownWithHeadingIds(source));
    expect(headingLineNumbers(source)).toHaveLength(rendered.length);
  });

  it('finds nothing in a document with no headings', () => {
    expect(headingLineNumbers('just words\nand more')).toEqual([]);
  });
});
