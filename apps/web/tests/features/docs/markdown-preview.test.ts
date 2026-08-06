import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { renderMarkdown, renderPlainText } from '@orbit/services/markdown';

const REWRITER = 'HTMLRewriter';

describe('markdown rendering without HTMLRewriter', () => {
  let saved: unknown;

  beforeEach(() => {
    saved = Reflect.get(globalThis, REWRITER);
    Reflect.deleteProperty(globalThis, REWRITER);
  });

  afterEach(() => {
    Reflect.set(globalThis, REWRITER, saved);
  });

  it('renders a preview in the browser', () => {
    expect(renderMarkdown('# Title\n\nHello **world**')).toContain('<strong>world</strong>');
  });

  it('drops scripts, comments and unsafe urls', () => {
    const html = renderMarkdown(
      ['<script>alert(1)</script>', '', '<!-- secret -->', '', '[x](javascript:alert(1))'].join(
        '\n',
      ),
    );
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('javascript:');
  });

  it('opens absolute links in a new tab and leaves relative links alone', () => {
    const external = renderMarkdown('[out](https://example.com)');
    expect(external).toContain('target="_blank"');
    expect(external).toContain('rel="noopener noreferrer"');
    expect(renderMarkdown('[in](/docs/1)')).not.toContain('target="_blank"');
  });

  it('reads text out of rendered markdown', () => {
    expect(renderPlainText('# Title\n\nfirst\n\nsecond')).toBe('Title\n\nfirst\n\nsecond');
  });
});
