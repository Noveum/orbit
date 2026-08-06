import { afterAll, describe, expect, it } from 'bun:test';
import { htmlToText, sanitizeHtml } from '../../src/markdown/sanitize.ts';

const globals = globalThis as { HTMLRewriter?: unknown };
const bunRewriter = globals.HTMLRewriter;

function withoutRewriter<T>(run: () => T): T {
  globals.HTMLRewriter = undefined;
  try {
    return run();
  } finally {
    globals.HTMLRewriter = bunRewriter;
  }
}

afterAll(() => {
  globals.HTMLRewriter = bunRewriter;
});

describe('sanitizing without HTMLRewriter', () => {
  it('keeps the tags the editor emits', () => {
    const html = withoutRewriter(() =>
      sanitizeHtml('<p>hello <strong>world</strong> <em>again</em></p>'),
    );
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<em>again</em>');
  });

  it('drops a script and its contents', () => {
    const html = withoutRewriter(() => sanitizeHtml('<p>safe</p><script>alert(1)</script>'));
    expect(html).toContain('safe');
    expect(html).not.toContain('script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips an event handler attribute', () => {
    const html = withoutRewriter(() => sanitizeHtml('<p onclick="steal()">text</p>'));
    expect(html).not.toContain('onclick');
    expect(html).toContain('text');
  });

  it('refuses a javascript url', () => {
    const html = withoutRewriter(() => sanitizeHtml('<a href="javascript:alert(1)">x</a>'));
    expect(html).not.toContain('javascript:');
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

  it('agrees with the rewriter on the same markup', () => {
    const source = '<p>hi <strong>there</strong></p><script>bad()</script>';
    const viaDom = withoutRewriter(() => sanitizeHtml(source));
    const viaRewriter = sanitizeHtml(source);
    expect(viaDom).toBe(viaRewriter);
  });
});
