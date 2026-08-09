import { describe, expect, it } from 'bun:test';
import {
  extractFirstImage,
  extractIssueIdentifiers,
  extractMentions,
  renderMarkdown,
  renderMarkdownWithHeadingIds,
  renderPlainText,
  summarize,
} from '../../src/markdown/index.ts';

describe('renderMarkdown', () => {
  it('keeps the column alignment a table asked for', () => {
    const html = renderMarkdown('| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |');

    expect(html).toContain('<th align="left">L</th>');
    expect(html).toContain('<th align="center">C</th>');
    expect(html).toContain('<th align="right">R</th>');
    expect(html).toContain('<td align="center">b</td>');
    expect(html).toContain('<td align="right">c</td>');
  });

  it('leaves a table that asked for nothing unaligned', () => {
    const html = renderMarkdown('| A |\n| --- |\n| b |');

    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>b</td>');
  });

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

  it('keeps underline and highlight inline tags the editor emits', () => {
    const html = renderMarkdown('An <u>underlined</u> and <mark>highlighted</mark> run.');
    expect(html).toContain('<u>underlined</u>');
    expect(html).toContain('<mark>highlighted</mark>');
  });

  it('keeps fenced code blocks with a language class and the code intact', () => {
    const source = '```ts\nconst a: number = 1;\n```';
    const html = renderMarkdown(source);
    expect(html).toContain('<pre>');
    expect(html).toContain('class="hljs language-ts"');
    expect(renderPlainText(source)).toBe('const a: number = 1;');
  });

  it('keeps headings, lists, blockquotes, images and inline code', () => {
    const html = renderMarkdown(
      '# Title\n\n> quote\n\n1. one\n\n`inline`\n\n![alt](https://x.dev/a.png)',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<code>inline</code>');
    expect(html).toContain('src="https://x.dev/a.png"');
    expect(html).toContain('alt="alt"');
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

describe('renderMarkdownWithHeadingIds', () => {
  it('leaves renderMarkdown untouched so only the reader paths carry ids', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>\n');
  });

  it('gives each heading the slug of its own text so anchors and hashes agree', () => {
    const html = renderMarkdownWithHeadingIds(
      ['# Global rules', '', '## Delete a branch', '', 'body'].join('\n'),
    );
    expect(html).toContain('<h1 id="global-rules">Global rules</h1>');
    expect(html).toContain('<h2 id="delete-a-branch">Delete a branch</h2>');
  });

  it('only tags h1 through h3', () => {
    const html = renderMarkdownWithHeadingIds('### `Rules`\n\n#### Too deep');
    expect(html).toContain('<h3 id="rules">');
    expect(html).toContain('<h4>Too deep</h4>');
  });

  it('bakes stable, unique ids that survive a re-run', () => {
    const html = renderMarkdownWithHeadingIds('## Setup\n\n## Setup\n');
    expect(html).toBe('<h2 id="setup">Setup</h2>\n<h2 id="setup-1">Setup</h2>\n');
    expect(renderMarkdownWithHeadingIds('## Setup\n\n## Setup\n')).toBe(html);
  });

  it('keeps ids unique when a later heading slugifies onto an earlier suffixed id', () => {
    const html = renderMarkdownWithHeadingIds('## Setup\n\n## Setup\n\n## Setup 1\n');
    expect(html).toContain('id="setup"');
    expect(html).toContain('id="setup-1"');
    expect(html).toContain('id="setup-1-1"');
  });

  it('reads through inline markup and entities to build the slug', () => {
    expect(renderMarkdownWithHeadingIds('## Batch & `sync_id`\n')).toContain('id="batch-sync-id"');
  });

  it('falls back to a section slug when the heading slugifies to nothing', () => {
    expect(renderMarkdownWithHeadingIds('## @@@\n')).toContain('id="section"');
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
  it('allows http, https, mailto, relative and fragment urls', () => {
    expect(renderMarkdown('[a](https://example.com/x?a=1#f)')).toContain(
      'href="https://example.com/x?a=1#f"',
    );
    expect(renderMarkdown('[a](mailto:x@y.com)')).toContain('href="mailto:x@y.com"');
    expect(renderMarkdown('[a](/relative/path)')).toContain('href="/relative/path"');
    expect(renderMarkdown('[a](#anchor)')).toContain('href="#anchor"');
    expect(renderMarkdown('<a href="/a:b">x</a>')).toContain('href="/a:b"');
  });

  it('marks absolute links as external and leaves relative links alone', () => {
    expect(renderMarkdown('[a](https://example.com)')).toContain('rel="noopener noreferrer"');
    expect(renderMarkdown('[a](/local)')).not.toContain('target=');
  });
});

describe('sanitizer defects found by the adversarial audit', () => {
  it('treats a protocol relative link as external', () => {
    const html = renderMarkdown('[y](//example.com/x)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('classifies an entity encoded absolute url as external', () => {
    expect(renderMarkdown('<a href="&#104;ttps://example.com">y</a>')).toContain(
      'rel="noopener noreferrer"',
    );
  });

  it('returns readable plain text rather than escaped html', () => {
    expect(renderPlainText('a < b & "c"')).toBe('a < b & "c"');
    expect(summarize('a < b & "c"', 40)).toBe('a < b & "c"');
  });
});

describe('toggle blocks', () => {
  it('keeps a details disclosure whole so a stored toggle survives a render', () => {
    const html = renderMarkdown(
      '<details open>\n<summary>More</summary>\n\nHidden body\n\n</details>',
    );
    expect(html).toContain('<details open');
    expect(html).toContain('<summary>More</summary>');
    expect(html).toContain('Hidden body');
    expect(html).toContain('</details>');
  });

  it('does not turn a github alert marker into anything but text', () => {
    const html = renderMarkdown('> [!IMPORTANT]\n> read this');
    expect(html).toBe('<blockquote>\n<p>[!IMPORTANT]\nread this</p>\n</blockquote>\n');
    expect(html).not.toContain('markdown-alert');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('<div');
  });
});

describe('task lists', () => {
  it('labels the list and every box so one rule can lay all of them out', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');

    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-checked="true">');
    expect(html).toContain('<li data-checked="false">');
    expect(html).toContain('type="checkbox"');
  });

  it('leaves a plain list plain even when a task list hangs off one of its items', () => {
    const html = renderMarkdown('- outer\n  - [ ] nested');

    expect(html).toContain('<ul>\n<li>');
    expect(html.indexOf('<ul data-type="taskList">')).toBeGreaterThan(html.indexOf('<ul>'));
    expect(html).not.toContain('<li data-checked="false"><p>outer');
  });

  it('labels a task list nested under another task', () => {
    const html = renderMarkdown('- [ ] top\n  - [x] child');

    expect(html.match(/data-type="taskList"/g)).toHaveLength(2);
    expect(html).toContain('data-checked="true"');
  });

  it('marks only the boxed item when a list mixes tasks with plain bullets', () => {
    const html = renderMarkdown('- [ ] boxed\n- plain');

    expect(html).not.toContain('data-type="taskList"');
    expect(html).toContain('<li data-checked="false">');
    expect(html).toContain('<li>plain</li>');
  });

  it('keeps an ordered list ordered and its start intact', () => {
    expect(renderMarkdown('3. three\n4. four')).toContain('<ol start="3">');
    expect(renderMarkdown('1. one')).toContain('<ol>');
  });

  it('leaves a numbered list its numbers even when its items carry a box', () => {
    const html = renderMarkdown('1. [ ] first\n2. [x] second');

    expect(html).toContain('<ol>');
    expect(html).not.toContain('data-type="taskList"');
    expect(html).not.toContain('data-checked');
    expect(html).toContain('type="checkbox"');
  });

  it('survives the second sanitize pass a published doc goes through', () => {
    const html = renderMarkdownWithHeadingIds('# Title\n\n- [x] done\n- [ ] todo');

    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-checked="true">');
    expect(html).toContain('<li data-checked="false">');
  });
});
