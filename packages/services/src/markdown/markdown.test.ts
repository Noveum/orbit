import { describe, expect, it } from 'bun:test';
import {
  extractFirstImage,
  extractIssueIdentifiers,
  extractMentions,
  renderMarkdown,
  renderPlainText,
  summarize,
} from './index.ts';

describe('renderMarkdown', () => {
  it('renders GFM tables, task lists, strikethrough and autolinks', () => {
    const html = renderMarkdown(
      [
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '- [x] done',
        '- [ ] todo',
        '',
        '~~gone~~',
        '',
        'https://orbit.dev',
      ].join('\n'),
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('href="https://orbit.dev"');
  });

  it('keeps fenced code blocks with a language class', () => {
    const html = renderMarkdown('```ts\nconst a: number = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('class="language-ts"');
    expect(html).toContain('const a: number = 1;');
  });

  it('keeps headings, lists, blockquotes, images and inline code', () => {
    const html = renderMarkdown(
      '# Title\n\n> quote\n\n1. one\n\n`inline`\n\n![alt](https://x.dev/a.png)',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<code>inline</code>');
    expect(html).toContain('<img src="https://x.dev/a.png" alt="alt">');
  });

  it('forces noopener on external links and leaves relative links alone', () => {
    const html = renderMarkdown('[out](https://evil.example.com) and [in](/issues/ORB-1)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    const relative = renderMarkdown('[in](/issues/ORB-1)');
    expect(relative).not.toContain('target=');
  });

  it('returns an empty string for blank input', () => {
    expect(renderMarkdown('   \n  ')).toBe('');
  });
});

describe('renderMarkdown xss', () => {
  it('strips script tags', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips img onerror handlers', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('neutralizes javascript: hrefs in raw html', () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">click</a>');
    expect(html).not.toContain('javascript:');
  });

  it('neutralizes javascript: payloads in markdown links', () => {
    const html = renderMarkdown('[click](javascript:alert(document.cookie))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('document.cookie');
  });

  it('strips iframes', () => {
    const html = renderMarkdown('<iframe src="https://evil.example.com"></iframe>');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('evil.example.com');
  });

  it('strips style attributes and svg payloads', () => {
    const html = renderMarkdown(
      '<p style="background:url(javascript:alert(1))">x</p><svg onload="alert(1)"></svg>',
    );
    expect(html).not.toContain('style=');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('onload');
  });

  it('escapes html injected inside code fences', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderPlainText', () => {
  it('flattens markdown to readable text', () => {
    const text = renderPlainText('# Title\n\nSome **bold** and [a link](https://x.dev).');
    expect(text).toBe('Title\n\nSome bold and a link.');
  });

  it('drops script content entirely', () => {
    expect(renderPlainText('a <script>alert(1)</script> b')).not.toContain('alert');
  });
});

describe('summarize', () => {
  it('collapses whitespace and truncates', () => {
    const summary = summarize('# Heading\n\nA fairly long paragraph of text here.', 20);
    expect(summary.length).toBeLessThanOrEqual(20);
    expect(summary.startsWith('Heading A fairly')).toBe(true);
  });
});

describe('extractFirstImage', () => {
  it('finds the first markdown image', () => {
    expect(
      extractFirstImage('text\n\n![a](https://x.dev/1.png)\n\n![b](https://x.dev/2.png)'),
    ).toBe('https://x.dev/1.png');
  });

  it('finds images nested in lists', () => {
    expect(extractFirstImage('- item ![a](/api/files/k/1.png)')).toBe('/api/files/k/1.png');
  });

  it('ignores unsafe image urls and returns null when none exist', () => {
    expect(extractFirstImage('![a](javascript:alert(1))')).toBeNull();
    expect(extractFirstImage('no images here')).toBeNull();
  });
});

describe('re-exported extractors', () => {
  it('extracts mentions and issue identifiers', () => {
    expect(extractMentions('hey @ada and @grace')).toEqual(['ada', 'grace']);
    expect(extractIssueIdentifiers('fixes ORB-12 and ENG-3')).toEqual(['ORB-12', 'ENG-3']);
  });
});

describe('sanitizer url handling', () => {
  const dangerous = /javascript|vbscript|data:text\/html|\son[a-z]+=/i;

  it('rejects a scheme hidden behind html entities', () => {
    for (const source of [
      '[a](&#106;avascript:alert(1))',
      '[a](&#x6a;avascript:alert(1))',
      '[a](javascript&#58;alert(1))',
      '[a](java&Tab;script:alert(1))',
      '[a](&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1))',
      '![i](&#106;avascript:alert(1))',
      '<img src="&#106;avascript:alert(1)">',
    ]) {
      expect(renderMarkdown(source)).not.toMatch(dangerous);
    }
  });

  it('keeps the first href when an anchor repeats the attribute', () => {
    const html = renderMarkdown('<a href="https://ok.example" href="javascript:alert(1)">x</a>');
    expect(html).toContain('href="https://ok.example"');
    expect(html).not.toMatch(dangerous);
  });

  it('allows http, https, mailto, relative and fragment urls', () => {
    expect(renderMarkdown('[a](https://example.com/x?a=1#f)')).toContain(
      'href="https://example.com/x?a=1#f"',
    );
    expect(renderMarkdown('[a](mailto:x@y.com)')).toContain('href="mailto:x@y.com"');
    expect(renderMarkdown('[a](/relative/path)')).toContain('href="/relative/path"');
    expect(renderMarkdown('[a](#anchor)')).toContain('href="#anchor"');
    expect(renderMarkdown('<a href="/a:b">x</a>')).toContain('href="/a:b"');
  });

  it('drops raw text elements together with their content', () => {
    for (const source of [
      '<script>alert(1)</script>after',
      '<style>body{background:url(javascript:alert(1))}</style>after',
      '<iframe src="https://evil.example"></iframe>after',
      '<textarea></textarea><img src=x onerror=alert(1)>after',
    ]) {
      const html = renderMarkdown(source);
      expect(html).not.toMatch(dangerous);
      expect(html).not.toContain('alert(1)');
    }
  });

  it('marks absolute links as external and leaves relative links alone', () => {
    expect(renderMarkdown('[a](https://example.com)')).toContain('rel="noopener noreferrer"');
    expect(renderMarkdown('[a](/local)')).not.toContain('target=');
  });
});
