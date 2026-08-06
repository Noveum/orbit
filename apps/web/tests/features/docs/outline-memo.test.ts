import { describe, expect, it, mock } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import type { DocHeading } from '../../../src/features/docs/outline.ts';
import {
  EMPTY_OUTLINE,
  extractHeadings,
  headingSignature,
  outlineFor,
} from '../../../src/features/docs/outline.ts';

function longDocument(bodyWord: string): string {
  const sections: string[] = ['# Long document', ''];
  for (let index = 1; index <= 40; index += 1) {
    sections.push(`## Section ${index}`, '', `${bodyWord} paragraph ${index}.`, '');
  }
  return sections.join('\n');
}

describe('headingSignature', () => {
  it('is unchanged when only body text changes', () => {
    expect(headingSignature(longDocument('alpha'))).toBe(headingSignature(longDocument('beta')));
  });

  it('changes when a heading is added, retitled or removed', () => {
    const base = '# Title\n\nbody\n\n## Two\n\nbody\n';
    expect(headingSignature(base)).not.toBe(headingSignature(`${base}\n## Three\n\nbody\n`));
    expect(headingSignature(base)).not.toBe(headingSignature(base.replace('## Two', '## Twoo')));
    expect(headingSignature(base)).not.toBe(headingSignature(base.replace('## Two\n\n', '')));
  });

  it('changes when a fence opens or closes around a heading', () => {
    const fenced = '```\n# Not a heading\n```\n\nbody\n';
    expect(headingSignature(fenced)).not.toBe(headingSignature(fenced.replace('```\n#', '#')));
  });

  it('tracks the paragraph above a setext underline', () => {
    const setext = 'Release notes\n=============\n\nbody\n';
    expect(headingSignature(setext)).not.toBe(
      headingSignature(setext.replace('Release notes', 'Release plan')),
    );
  });

  it('tracks a setext underline written inside a blockquote', () => {
    const quoted = '> Release notes\n> ---\n\nbody\n';
    expect(headingSignature(quoted)).not.toBe(
      headingSignature(quoted.replace('Release notes', 'Release plan')),
    );
  });

  it('leaves the block above a thematic break out of the signature', () => {
    expect(headingSignature(separatedByBreak('alpha'))).toBe(
      headingSignature(separatedByBreak('beta')),
    );
  });

  it('tells a thematic break from a setext underline by how far the dashes are indented', () => {
    const broken = '# Title\n\n- item\n---\n\n## Two\n';
    const underlined = '# Title\n\n- item\n  ---\n\n## Two\n';

    expect(headingsOf(broken).map((heading) => heading.id)).toEqual(['title', 'two']);
    expect(headingsOf(underlined).map((heading) => heading.id)).toEqual(['title', 'item', 'two']);

    expect(headingSignature(broken)).toBe(headingSignature(broken.replace('- item', '- other')));
    expect(headingSignature(underlined)).not.toBe(
      headingSignature(underlined.replace('- item', '- other')),
    );
  });
});

function separatedByBreak(body: string): string {
  return `# Title\n\n- ${body}\n- second\n---\n\n## Two\n\ntail\n`;
}

describe('a document that uses separators', () => {
  it('does not rebuild the outline while the block above a break is typed', () => {
    const build = mock((source: string) => headingsOf(source));

    let memo = EMPTY_OUTLINE;
    let typed = '';
    for (let stroke = 0; stroke < 8; stroke += 1) {
      typed += 'a';
      memo = outlineFor(memo, separatedByBreak(typed), build);
    }

    expect(build).toHaveBeenCalledTimes(1);
    expect(headingsOf(separatedByBreak('a'))).toEqual(headingsOf(separatedByBreak('aaaaaaaa')));
    expect(memo.headings.map((heading) => heading.id)).toEqual(['title', 'two']);
  });

  it('still rebuilds when that break turns out to underline a paragraph', () => {
    const build = mock((source: string) => headingsOf(source));
    const first = outlineFor(EMPTY_OUTLINE, 'Release notes\n\n---\n\nbody\n', build);
    const second = outlineFor(first, 'Release notes\n---\n\nbody\n', build);

    expect(second.headings.map((heading) => heading.id)).toEqual(['release-notes']);
    expect(build).toHaveBeenCalledTimes(2);
  });
});

function headingsOf(source: string): readonly DocHeading[] {
  return extractHeadings(renderMarkdownWithHeadingIds(source));
}

const HEADINGS_THE_RENDERER_FINDS = [
  {
    what: 'a heading inserted in a blockquote',
    before: '# One\n\n## Two\n',
    after: '# One\n\n> ## Inserted\n\n## Two\n',
  },
  {
    what: 'a heading retitled in a blockquote',
    before: '# One\n\n> ## Inserted\n\n## Two\n',
    after: '# One\n\n> ## Renamed\n\n## Two\n',
  },
  {
    what: 'a heading inserted four spaces deep in a list item',
    before: '# One\n\n1.  item\n\n## Two\n',
    after: '# One\n\n1.  item\n\n    ## Indented\n\n## Two\n',
  },
  {
    what: 'a heading retitled four spaces deep in a list item',
    before: '# One\n\n1.  item\n\n    ## Indented\n\n## Two\n',
    after: '# One\n\n1.  item\n\n    ## Adjusted\n\n## Two\n',
  },
  {
    what: 'a heading released from an html block',
    before: '# One\n\n<div>\n## Swallowed\n</div>\n\n## Two\n',
    after: '# One\n\n## Swallowed\n\n## Two\n',
  },
  {
    what: 'a heading released by replacing the html block around it',
    before: '# One\n\n<div>\n## Swallowed\n</div>\n\n## Two\n',
    after: '# One\n\nplain\n## Swallowed\nplain\n\n## Two\n',
  },
  {
    what: 'a raw h2 written into the body',
    before: '# One\n\n## Two\n',
    after: '# One\n\n<h2>Raw</h2>\n\n## Two\n',
  },
  {
    what: 'a raw h2 retitled in the body',
    before: '# One\n\n<h2>Raw</h2>\n\n## Two\n',
    after: '# One\n\n<h2>Renamed</h2>\n\n## Two\n',
  },
  {
    what: 'a heading inserted in a blockquote nested in a list item',
    before: '# One\n\n- item\n\n## Two\n',
    after: '# One\n\n- item\n\n  > ## Nested\n\n## Two\n',
  },
  {
    what: 'a heading retitled in a blockquote nested in a list item',
    before: '# One\n\n- item\n\n  > ## Nested\n\n## Two\n',
    after: '# One\n\n- item\n\n  > ## Adjusted\n\n## Two\n',
  },
  {
    what: 'a heading freed by a blank line closing the html block above it',
    before: '# One\n\n<div>\n</div>\n## Head\n',
    after: '# One\n\n<div>\n</div>\n\n## Head\n',
  },
  {
    what: 'a setext heading retitled inside a bullet item',
    before: '# One\n\n- Listed\n  ---\n\n## Two\n',
    after: '# One\n\n- Renamed\n  ---\n\n## Two\n',
  },
  {
    what: 'a setext heading retitled inside an ordered item',
    before: '# One\n\n1. Listed\n   ===\n\n## Two\n',
    after: '# One\n\n1. Renamed\n   ===\n\n## Two\n',
  },
  {
    what: 'a setext heading retitled inside a blockquote nested in a list item',
    before: '# One\n\n- > Listed\n  > ---\n\n## Two\n',
    after: '# One\n\n- > Renamed\n  > ---\n\n## Two\n',
  },
  {
    what: 'a setext underline typed under the last list item in the document',
    before: '# One\n\n- Listed\n',
    after: '# One\n\n- Listed\n  ---\n',
  },
  {
    what: 'a setext underline that lazily continues the list item above it',
    before: '# One\n\n- Listed\n',
    after: '# One\n\n- Listed\n===\n',
  },
] as const;

describe('the outline memo never goes stale', () => {
  for (const { what, before, after } of HEADINGS_THE_RENDERER_FINDS) {
    it(`rebuilds for ${what}`, () => {
      expect(headingsOf(after)).not.toEqual(headingsOf(before));

      const first = outlineFor(EMPTY_OUTLINE, before, headingsOf);
      const second = outlineFor(first, after, headingsOf);

      expect(second.headings).toEqual(headingsOf(after));
      expect(headingSignature(after)).not.toBe(headingSignature(before));
    });
  }

  it('keeps the sidebar and the document in step through a blockquote insertion', () => {
    const memo = outlineFor(EMPTY_OUTLINE, '# One\n\n## Two\n', headingsOf);
    const grown = outlineFor(memo, '# One\n\n> ## Inserted\n\n## Two\n', headingsOf);

    expect(grown.headings.map((heading) => heading.id)).toEqual(['one', 'inserted', 'two']);
  });
});

describe('outlineFor', () => {
  it('builds once while the body is edited keystroke by keystroke', () => {
    const build = mock((source: string) => extractHeadings(renderMarkdownWithHeadingIds(source)));
    let memo = EMPTY_OUTLINE;
    let typed = '';

    for (let stroke = 0; stroke < 25; stroke += 1) {
      typed += 'a';
      memo = outlineFor(memo, `${longDocument('alpha')}\n${typed}`, build);
    }

    expect(build).toHaveBeenCalledTimes(1);
    expect(memo.headings).toHaveLength(41);
  });

  it('returns the identical heading list so subscribers do not resubscribe', () => {
    const build = (source: string) => extractHeadings(renderMarkdownWithHeadingIds(source));
    const first = outlineFor(EMPTY_OUTLINE, longDocument('alpha'), build);
    const second = outlineFor(first, longDocument('beta'), build);

    expect(second).toBe(first);
    expect(second.headings).toBe(first.headings);
  });

  it('rebuilds as soon as a heading actually changes', () => {
    const build = mock((source: string) => extractHeadings(renderMarkdownWithHeadingIds(source)));
    const first = outlineFor(EMPTY_OUTLINE, longDocument('alpha'), build);
    const second = outlineFor(first, `${longDocument('alpha')}\n## Appendix\n`, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(second.headings.at(-1)).toEqual({ id: 'appendix', text: 'Appendix', level: 2 });
  });

  it('agrees with a full render of the document', () => {
    const source = longDocument('alpha');
    const built = outlineFor(EMPTY_OUTLINE, source, (value) =>
      extractHeadings(renderMarkdownWithHeadingIds(value)),
    );

    expect(built.headings).toEqual(extractHeadings(renderMarkdownWithHeadingIds(source)));
  });
});
