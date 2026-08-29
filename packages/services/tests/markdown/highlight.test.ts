import { describe, expect, it } from 'bun:test';
import {
  highlightCode,
  languageAlias,
  renderMarkdown,
  renderMarkdownWithHeadingIds,
  renderPlainText,
  summarize,
} from '../../src/markdown/index.ts';

const TS_BLOCK = ['```ts', 'const total = 1;', '```'].join('\n');

describe('code on the read path', () => {
  it('colours a fenced block the same way the editor does', () => {
    const html = renderMarkdown(TS_BLOCK);

    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain('<span class="hljs-number">1</span>');
    expect(html).toContain('class="hljs language-ts"');
  });

  it('colours a fenced html block the same way the editor does', () => {
    const html = renderMarkdown(['```html', '<div class="ok">x</div>', '```'].join('\n'));
    expect(html).toContain('class="hljs language-html"');
    expect(html).toContain('hljs-tag');
  });

  it('survives the sanitizer that every rendered doc passes through', () => {
    const html = renderMarkdownWithHeadingIds(`# Title\n\n${TS_BLOCK}`);

    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain('id="title"');
  });

  it('leaves a block with no language alone rather than guessing', () => {
    const html = renderMarkdown(['```', 'const total = 1;', '```'].join('\n'));

    expect(html).not.toContain('hljs-keyword');
    expect(html).toContain('const total = 1;');
  });

  it('leaves a language nobody ships alone', () => {
    const html = renderMarkdown(['```klingon', 'const total = 1;', '```'].join('\n'));

    expect(html).not.toContain('hljs-keyword');
    expect(html).toContain('const total = 1;');
  });

  it('escapes markup inside a highlighted block instead of emitting it', () => {
    const html = renderMarkdown(
      ['```ts', 'const evil = "</code></pre><img src=x onerror=alert(1)>";', '```'].join('\n'),
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('</code></pre><img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes markup inside a block with no language', () => {
    const html = renderMarkdown(['```', '<img src=x onerror=alert(1)>', '```'].join('\n'));

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('keeps the plain text of a code block readable for search and notifications', () => {
    expect(renderPlainText(TS_BLOCK)).toBe('const total = 1;');
    expect(summarize(`Intro.\n\n${TS_BLOCK}`, 200)).toBe('Intro. const total = 1;');
  });

  it('takes the language from the first token of the info string', () => {
    expect(languageAlias('  TS  extra')).toBe('ts');
    expect(languageAlias('language-python')).toBe('python');
    expect(languageAlias('')).toBe('');
  });

  it('reports a token class for a language it knows and none for one it does not', () => {
    expect(highlightCode('SELECT 1', 'sql')).toContain('hljs-keyword');
    expect(highlightCode('<div class="ok">x</div>', 'html')).toContain('hljs-tag');
    expect(highlightCode('SELECT 1', 'klingon')).toBe('SELECT 1');
    expect(highlightCode('a < b & c', 'klingon')).toBe('a &lt; b &amp; c');
  });
});
