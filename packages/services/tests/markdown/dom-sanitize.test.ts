import { afterAll, describe, expect, it } from 'bun:test';
import { htmlToText, sanitizeHtml } from '../../src/markdown/sanitize.ts';
import { restoreRewriter, withoutRewriter } from './sanitizer-vectors.ts';

afterAll(restoreRewriter);

describe('sanitizing without HTMLRewriter', () => {
  it('keeps the tags the editor emits', () => {
    const html = withoutRewriter(() =>
      sanitizeHtml('<p>hello <strong>world</strong> <em>again</em></p>'),
    );
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<em>again</em>');
  });

  it('unwraps a tag that is not allowed but keeps its text', () => {
    const html = withoutRewriter(() => sanitizeHtml('<section><p>kept</p></section>'));
    expect(html).toContain('kept');
    expect(html).not.toContain('<section>');
  });

  it('reads text out of markup', () => {
    const text = withoutRewriter(() => htmlToText('<p>one</p><p>two</p>'));
    expect(text).toContain('one');
    expect(text).toContain('two');
  });

  it('counts a void element as a word boundary the way the rewriter does', () => {
    const source = '<p>one<br>two</p><img src="x"><input type="checkbox">three';
    expect(withoutRewriter(() => htmlToText(source))).toBe(htmlToText(source));
  });
});
