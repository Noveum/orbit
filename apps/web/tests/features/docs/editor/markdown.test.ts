import { describe, expect, it } from 'bun:test';
import type { JSONContent } from '@tiptap/core';
import { docToMarkdown } from '../../../../src/features/docs/editor/markdown.ts';

describe('a document survives being edited', () => {
  it('keeps blank lines inside a code fence, which are code', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const a = 1;\n\n\n\nconst b = 2;' }],
        },
      ],
    };
    expect(docToMarkdown(doc)).toBe('```ts\nconst a = 1;\n\n\n\nconst b = 2;\n```\n');
  });

  it('keeps a fence intact when prose surrounds it', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        {
          type: 'codeBlock',
          attrs: { language: null },
          content: [{ type: 'text', text: 'a\n\n\nb' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    };
    expect(docToMarkdown(doc)).toBe('Before\n\n```\na\n\n\nb\n```\n\nAfter\n');
  });

  it('still collapses runs of blank lines between prose blocks', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
      ],
    };
    expect(docToMarkdown(doc)).toBe('One\n\nTwo\n');
  });

  it('fences a block that itself contains a fence, so nothing leaks out', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'md' },
          content: [{ type: 'text', text: 'Example:\n\n```\ninner\n```\n\n\ndone' }],
        },
      ],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown.startsWith('````md\n')).toBe(true);
    expect(markdown).toContain('```\ninner\n```');
    expect(markdown).toContain('\n\n\ndone');
    expect(markdown.trimEnd().endsWith('````')).toBe(true);
  });

  it('keeps every heading level the sanitizer allows', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const doc: JSONContent = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'Title' }] },
        ],
      };
      expect(docToMarkdown(doc)).toBe(`${'#'.repeat(level)} Title\n`);
    }
  });
});
