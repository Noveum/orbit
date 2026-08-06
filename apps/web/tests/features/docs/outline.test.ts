import { describe, expect, it } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { extractHeadings } from '../../../src/features/docs/outline.ts';

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
