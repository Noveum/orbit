import { describe, expect, it } from 'bun:test';
import {
  absoluteAttachments,
  exportedMarkdown,
  fileNameFor,
  parseMarkdownImport,
} from '../../../src/features/docs/doc-transfer.ts';

describe('a doc leaving Orbit as markdown', () => {
  it('names the file after the doc, safely', () => {
    expect(fileNameFor('Q3 Planning: the plan', 'md')).toBe('q3-planning-the-plan.md');
    expect(fileNameFor('   ', 'md')).toBe('document.md');
    expect(fileNameFor('../../etc/passwd', 'md')).toBe('etc-passwd.md');
  });

  it('rewrites attachment links so they still resolve outside the app', () => {
    const markdown = 'See ![shot](/api/files/team/a.png) and [doc](/api/files/b.pdf).';
    const out = absoluteAttachments(markdown, 'https://orbit.example/');
    expect(out).toContain('](https://orbit.example/api/files/team/a.png)');
    expect(out).toContain('](https://orbit.example/api/files/b.pdf)');
  });

  it('leaves links that are already absolute alone', () => {
    const markdown = '[out](https://example.com/api/files/x.png)';
    expect(absoluteAttachments(markdown, 'https://orbit.example')).toBe(markdown);
  });

  it('adds the title as a heading, but not twice', () => {
    expect(exportedMarkdown('Runbook', 'Steps here.', 'https://o.example')).toBe(
      '# Runbook\n\nSteps here.\n',
    );
    expect(exportedMarkdown('Runbook', '# Runbook\n\nSteps here.', 'https://o.example')).toBe(
      '# Runbook\n\nSteps here.\n',
    );
  });
});

describe('a markdown file arriving as a doc', () => {
  it('prefers a front matter title and strips the block', () => {
    const parsed = parseMarkdownImport(
      'notes.md',
      '---\ntitle: Real Title\ntags: [a]\n---\n\nBody.',
    );
    expect(parsed.title).toBe('Real Title');
    expect(parsed.content).toBe('Body.');
    expect(parsed.content).not.toContain('tags');
  });

  it('falls back to the first heading and lifts it out of the body', () => {
    const parsed = parseMarkdownImport('notes.md', '# Deploy runbook\n\nHow we ship.');
    expect(parsed.title).toBe('Deploy runbook');
    expect(parsed.content).toBe('How we ship.');
  });

  it('falls back to the file name when the file says nothing', () => {
    const parsed = parseMarkdownImport('quarterly_review-2031.md', 'Just a body.');
    expect(parsed.title).toBe('quarterly review 2031');
    expect(parsed.content).toBe('Just a body.');
  });

  it('keeps a heading that is not the first thing in the file', () => {
    const parsed = parseMarkdownImport('notes.md', 'Intro line.\n\n# Later heading\n\nMore.');
    expect(parsed.content).toContain('# Later heading');
  });

  it('survives a byte order mark and windows line endings', () => {
    const parsed = parseMarkdownImport('notes.md', '﻿# Title\r\n\r\nBody.\r\n');
    expect(parsed.title).toBe('Title');
    expect(parsed.content).toBe('Body.');
  });

  it('never lets a title grow past what the doc validator accepts', () => {
    const parsed = parseMarkdownImport('x.md', `# ${'a'.repeat(400)}\n\nBody.`);
    expect(parsed.title.length).toBe(200);
  });
});
