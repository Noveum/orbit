import { describe, expect, it } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { slugify, withHeadingIds } from './outline.ts';

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

describe('heading ids', () => {
  it('gives every heading the slug of its own text so anchors and hashes agree', () => {
    const { html, headings } = withHeadingIds(renderMarkdown(MARKDOWN));

    expect(headings.map((heading) => heading.id)).toEqual([
      'global-rules',
      'delete-remote-branch-after-merging-a-pr',
      'pr-descriptions-one-liner-only',
    ]);

    for (const heading of headings) {
      expect(heading.id).toBe(slugify(heading.text));
      expect(html).toContain(`id="${heading.id}"`);
    }
  });
});
