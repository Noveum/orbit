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

describe('the markers a task list is laid out from', () => {
  const source =
    '<ul data-type="taskList"><li data-checked="true">a</li></ul>' +
    '<p data-checked="true">b</p><div data-type="taskList">c</div>';

  it('keeps them on the list and the item that carry the layout', () => {
    const html = sanitizeHtml(source);
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-checked="true">');
  });

  it('strips them off any other tag, so markup cannot borrow the styling', () => {
    const html = sanitizeHtml(source);
    expect(html).toContain('<p>b</p>');
    expect(html).toContain('<div>c</div>');
  });

  it('agrees with the rewriter when there is no rewriter', () => {
    expect(withoutRewriter(() => sanitizeHtml(source))).toBe(sanitizeHtml(source));
  });

  it('drops a value it never emits, so pasted markup cannot restyle a list', () => {
    const html = sanitizeHtml('<ul data-type="bulletList"><li data-checked="maybe">a</li></ul>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>a</li>');
    expect(html).not.toContain('data-type');
    expect(html).not.toContain('data-checked');
  });
});
