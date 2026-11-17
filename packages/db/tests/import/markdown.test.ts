import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { renderMarkdown } from '../../../services/src/markdown/index.ts';
import { htmlToMarkdown } from '../../src/import/markdown.ts';

function rendered(markdown: string) {
  return parseHTML(`<html><body>${renderMarkdown(markdown)}</body></html>`).document.body;
}

describe('HTML import text fidelity', () => {
  test.each([
    [
      'nested tag entities',
      '&amp;lt;em&amp;gt;hello&amp;lt;/em&amp;gt;',
      '&lt;em&gt;hello&lt;/em&gt;',
    ],
    ['encoded literal markup', '&lt;em&gt;hello&lt;/em&gt;', '<em>hello</em>'],
    ['nested ampersands', 'Tom &amp;amp; Jerry', 'Tom &amp; Jerry'],
    [
      'numeric entities',
      '&#38;lt;b&#38;gt;literal&#38;lt;/b&#38;gt;',
      '&lt;b&gt;literal&lt;/b&gt;',
    ],
    ['named and numeric characters', '&copy; &euro; &#x1f642; &quot; &#39;', '© € 🙂 " \''],
  ])('preserves %s through Markdown rendering', (_name, html, text) => {
    const body = rendered(htmlToMarkdown(html));
    expect(body.textContent.trim()).toBe(text);
    expect(body.querySelector('em, b, strong') === null).toBe(true);
  });

  test('keeps Markdown punctuation as text while preserving actual HTML emphasis', () => {
    const body = rendered(
      htmlToMarkdown(
        '<p>*plain* _plain_ [label](https://wrong.test) ![image](wrong) <em>real</em> <strong>bold</strong></p>',
      ),
    );
    expect(body.querySelectorAll('em').length).toBe(1);
    expect(body.querySelector('em')?.textContent).toBe('real');
    expect(body.querySelector('strong')?.textContent).toBe('bold');
    expect(body.querySelector('a, img') === null).toBe(true);
    expect(body.textContent.trim()).toBe(
      '*plain* _plain_ [label](https://wrong.test) ![image](wrong) real bold',
    );
  });

  test('keeps plain HTML addresses as text rather than Markdown autolinks', () => {
    const body = rendered(
      htmlToMarkdown('<p>https://example.test www.example.test me@example.test</p>'),
    );
    expect(body.querySelector('a') === null).toBe(true);
    expect(body.textContent.trim()).toBe('https://example.test www.example.test me@example.test');
  });

  test('does not turn a literal paragraph prefix into a Markdown block', () => {
    const body = rendered(htmlToMarkdown('<p># title</p><p>- item</p><p>&gt; quote</p>'));
    expect(body.querySelector('h1, li, blockquote') === null).toBe(true);
    expect(Array.from(body.querySelectorAll('p'), (node) => node.textContent)).toEqual([
      '# title',
      '- item',
      '> quote',
    ]);
  });

  test.each([
    ['# title', '# title'],
    ['- item', '- item'],
    ['1) item', '1) item'],
    ['<span>#</span> title', '# title'],
    ['text<br>===', 'text==='],
  ])('keeps a bare fragment literal: %s', (html, text) => {
    const body = rendered(htmlToMarkdown(html));
    expect(body.querySelector('h1, h2, li') === null).toBe(true);
    expect(body.textContent.trim()).toBe(text);
  });

  test('decodes a link destination once without changing its literal entities', () => {
    const body = rendered(
      htmlToMarkdown(
        '<a href="https://example.test/?q=&amp;lt;tag&amp;gt;&amp;b=&quot;quoted&quot;">A &amp;amp; B</a>',
      ),
    );
    expect(decodeURI(body.querySelector('a')?.getAttribute('href') ?? '')).toBe(
      'https://example.test/?q=&lt;tag&gt;&b="quoted"',
    );
    expect(body.querySelector('a')?.textContent).toBe('A &amp; B');
  });

  test('preserves inline code containing backticks and nested entities', () => {
    const body = rendered(
      htmlToMarkdown('<p><code>use &#96;value&#96; &amp;lt;x&amp;gt;</code></p>'),
    );
    expect(body.querySelectorAll('code').length).toBe(1);
    expect(body.querySelector('code')?.textContent).toBe('use `value` &lt;x&gt;');
  });

  test('preserves code block whitespace and fences as literal code', () => {
    const body = rendered(
      htmlToMarkdown('<pre><code>one &amp;lt;x&amp;gt;\n\n\n&#96;&#96;&#96;\n  two</code></pre>'),
    );
    expect(body.querySelectorAll('pre').length).toBe(1);
    expect(body.querySelector('pre code')?.textContent).toBe('one &lt;x&gt;\n\n\n```\n  two\n');
  });

  test.each([
    '<p>A &amp;lt; B</p><script>hidden()</script><style>.hidden{display:none}</style><p>C</p>',
    '<!doctype html><html><head><title>not body text</title></head><body><p>A &amp;lt; B</p><script>hidden()</script><style>.hidden{display:none}</style><p>C</p></body></html>',
  ])('keeps body content and omits script and style content', (html) => {
    const body = rendered(htmlToMarkdown(html));
    expect(Array.from(body.querySelectorAll('p'), (node) => node.textContent)).toEqual([
      'A &lt; B',
      'C',
    ]);
    expect(body.textContent).not.toContain('hidden');
    expect(body.textContent).not.toContain('not body text');
  });
});

describe('HTML formatting inside wrappers', () => {
  test('retains a list inside a div', () => {
    const body = rendered(htmlToMarkdown('<div><ul><li>item</li></ul></div>'));
    expect(body.querySelector('ul > li')?.textContent).toBe('item');
  });

  test('retains a heading inside a div', () => {
    const body = rendered(htmlToMarkdown('<div><h2>Title</h2></div>'));
    expect(body.querySelector('h2')?.textContent).toBe('Title');
  });

  test('retains nested div headings and lists', () => {
    const body = rendered(
      htmlToMarkdown('<div><div><h3>Nested</h3><ul><li>item</li></ul></div></div>'),
    );
    expect(body.querySelector('h3')?.textContent).toBe('Nested');
    expect(body.querySelector('ul > li')?.textContent).toBe('item');
  });

  test('retains blockquotes and their wrapped list contents', () => {
    const body = rendered(
      htmlToMarkdown(
        '<div><blockquote><div><p>Quoted</p><ul><li>item</li></ul></div></blockquote></div>',
      ),
    );
    expect(body.querySelector('blockquote > p')?.textContent).toBe('Quoted');
    expect(body.querySelector('blockquote li')?.textContent).toBe('item');
  });
});

describe('Plane Markdown export', () => {
  test('preserves literal text and intentional markup in actual exported files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orbit-plane-conversion-'));
    try {
      const root = resolve(import.meta.dir, '../../../..');
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          '--preload',
          resolve(import.meta.dir, 'fixtures/fetch-plane.ts'),
          resolve(root, 'scripts/fetch-plane.ts'),
        ],
        {
          cwd: root,
          env: {
            PATH: process.env['PATH'] ?? '',
            HOME: directory,
            BUN_OPTIONS: '--no-env-file',
            PLANE_API_KEY: 'fixture-only',
            PLANE_WORKSPACE: 'conversion-fixture',
            PLANE_OUT: directory,
            PLANE_RATE: '10000',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const output = await new Response(child.stderr).text();
      expect(await child.exited, output).toBe(0);
      const issues = rendered(await readFile(join(directory, 'FIX/issues.md'), 'utf8'));
      const page = rendered(await readFile(join(directory, 'FIX/pages/literal-page.md'), 'utf8'));
      for (const body of [issues, page]) {
        expect(body.textContent).toContain('&lt;em&gt;literal&lt;/em&gt; &amp; *plain*');
        expect(body.querySelectorAll('em').length).toBe(1);
        expect(body.querySelector('em')?.textContent).toBe('real');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
