import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { MatchedText, splitOnTerm } from '@/features/docs/search-highlight.tsx';

describe('splitOnTerm', () => {
  it('marks every occurrence and leaves the text between them alone', () => {
    const parts = splitOnTerm('quorum and quorum again', 'quorum');

    expect(parts).toEqual([
      { text: 'quorum', match: true, start: 0 },
      { text: ' and ', match: false, start: 6 },
      { text: 'quorum', match: true, start: 11 },
      { text: ' again', match: false, start: 17 },
    ]);
  });

  it('matches regardless of case but keeps the original casing', () => {
    const parts = splitOnTerm('The Quorum holds', 'quorum');

    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(['Quorum']);
  });

  it('leaves the whole string unmarked when the term is blank or absent', () => {
    expect(splitOnTerm('a body', '   ')).toEqual([{ text: 'a body', match: false, start: 0 }]);
    expect(splitOnTerm('a body', 'zzz')).toEqual([{ text: 'a body', match: false, start: 0 }]);
  });

  it('never loses or duplicates a character', () => {
    const text = 'quorum. A quorum of two. quorum';
    const rebuilt = splitOnTerm(text, 'quorum')
      .map((part) => part.text)
      .join('');

    expect(rebuilt).toBe(text);
  });

  it('treats a regex metacharacter in the term as a literal', () => {
    const parts = splitOnTerm('at 40% of cap', '40%');

    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(['40%']);
    expect(splitOnTerm('a.b', 'a.b')[0]?.match).toBe(true);
    expect(splitOnTerm('axb', 'a.b')[0]?.match).toBe(false);
  });
});

describe('MatchedText', () => {
  it('wraps only the matching run in a mark element', () => {
    render(
      <p data-testid="passage">
        <MatchedText text="waits on a quorum handshake" term="quorum" />
      </p>,
    );

    const passage = screen.getByTestId('passage');
    expect(passage.textContent).toBe('waits on a quorum handshake');
    expect([...passage.querySelectorAll('mark')].map((node) => node.textContent)).toEqual([
      'quorum',
    ]);
  });

  it('renders a passage that looks like markup as text, on both sides of the match', () => {
    const markup = '<img src=x onerror=alert(1)>';
    render(
      <>
        <p data-testid="around">
          <MatchedText text={`before ${markup} after`} term="before" />
        </p>
        <p data-testid="inside">
          <MatchedText text={`before ${markup} after`} term={markup} />
        </p>
      </>,
    );

    for (const id of ['around', 'inside']) {
      const passage = screen.getByTestId(id);
      expect(passage.querySelector('img')).toBeNull();
      expect(passage.textContent).toBe(`before ${markup} after`);
    }
  });
});
