import { describe, expect, it, mock } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
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
