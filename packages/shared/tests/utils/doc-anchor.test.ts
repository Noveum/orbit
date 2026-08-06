import { describe, expect, it } from 'bun:test';
import {
  buildDocAnchor,
  DOC_ANCHOR_CONTEXT_LIMIT,
  DOC_ANCHOR_QUOTE_LIMIT,
  isDocAnchorOrphaned,
  locateDocAnchor,
} from '../../src/utils/doc-anchor.ts';
import { docCommentAnchorSchema } from '../../src/validators/comment.ts';

const passage = 'The launch is blocked on the migration.';
const document = `Status update\n\n${passage}\n\nWe meet on Thursday.`;
const start = document.indexOf(passage);

const emoji = '😀';
const halfCharacter = /\p{Surrogate}/u;

describe('buildDocAnchor', () => {
  it('captures the quote with the text on either side of it', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);

    expect(anchor.quote).toBe(passage);
    expect(anchor.start).toBe(start);
    expect(document.slice(start - anchor.prefix.length, start)).toBe(anchor.prefix);
    expect(anchor.suffix.startsWith('\n\nWe meet')).toBe(true);
  });

  it('bounds the context it keeps so a long doc cannot bloat the row', () => {
    const long = `${'a'.repeat(500)}${passage}${'b'.repeat(500)}`;
    const anchor = buildDocAnchor(long, 500, 500 + passage.length);

    expect(anchor.prefix).toHaveLength(DOC_ANCHOR_CONTEXT_LIMIT);
    expect(anchor.suffix).toHaveLength(DOC_ANCHOR_CONTEXT_LIMIT);
  });

  it('produces an anchor the shared schema accepts', () => {
    expect(() =>
      docCommentAnchorSchema.parse(buildDocAnchor(document, start, start + passage.length)),
    ).not.toThrow();
  });

  it('clamps a selection of the whole document to the quote the server accepts', () => {
    const huge = 'w'.repeat(DOC_ANCHOR_QUOTE_LIMIT * 3);
    const anchor = buildDocAnchor(huge, 0, huge.length);

    expect(anchor.quote).toHaveLength(DOC_ANCHOR_QUOTE_LIMIT);
    expect(() => docCommentAnchorSchema.parse(anchor)).not.toThrow();
  });

  it('keeps the last character of a selection that is exactly at the limit', () => {
    const exact = `${'w'.repeat(DOC_ANCHOR_QUOTE_LIMIT)}tail`;
    const anchor = buildDocAnchor(exact, 0, DOC_ANCHOR_QUOTE_LIMIT);

    expect(anchor.quote).toHaveLength(DOC_ANCHOR_QUOTE_LIMIT);
    expect(anchor.quote.endsWith('w')).toBe(true);
    expect(anchor.suffix.startsWith('tail')).toBe(true);
    expect(() => docCommentAnchorSchema.parse(anchor)).not.toThrow();
  });

  it('takes the context that follows the clamped quote, not the selection that was cut', () => {
    const overlong = `${'w'.repeat(DOC_ANCHOR_QUOTE_LIMIT)}cut off here`;
    const anchor = buildDocAnchor(overlong, 0, overlong.length);

    expect(anchor.suffix).toBe('cut off here');
    expect(locateDocAnchor(overlong, anchor)).toEqual({ start: 0, end: DOC_ANCHOR_QUOTE_LIMIT });
  });

  it('cuts the quote before an emoji the limit lands inside instead of through it', () => {
    const straddling = `${'w'.repeat(DOC_ANCHOR_QUOTE_LIMIT - 1)}${emoji}and the rest`;
    const anchor = buildDocAnchor(straddling, 0, straddling.length);

    expect(halfCharacter.test(anchor.quote)).toBe(false);
    expect(halfCharacter.test(anchor.suffix)).toBe(false);
    expect(anchor.quote).toHaveLength(DOC_ANCHOR_QUOTE_LIMIT - 1);
    expect(anchor.suffix.startsWith(emoji)).toBe(true);
    expect(locateDocAnchor(straddling, anchor)).toEqual({
      start: 0,
      end: DOC_ANCHOR_QUOTE_LIMIT - 1,
    });
    expect(() => docCommentAnchorSchema.parse(anchor)).not.toThrow();
  });

  it('opens the context window on a whole character when an emoji straddles its edge', () => {
    const above = `${'x'.repeat(10)}${emoji}${'y'.repeat(DOC_ANCHOR_CONTEXT_LIMIT - 1)}`;
    const text = `${above}${passage}\n\nbelow`;
    const at = above.length;
    const anchor = buildDocAnchor(text, at, at + passage.length);

    expect(halfCharacter.test(anchor.prefix)).toBe(false);
    expect(anchor.prefix).toHaveLength(DOC_ANCHOR_CONTEXT_LIMIT - 1);
    expect(text.slice(at - anchor.prefix.length, at)).toBe(anchor.prefix);
    expect(locateDocAnchor(text, anchor)).toEqual({ start: at, end: at + passage.length });
    expect(() => docCommentAnchorSchema.parse(anchor)).not.toThrow();
  });

  it('closes the context window on a whole character when an emoji straddles its edge', () => {
    const below = `${'y'.repeat(DOC_ANCHOR_CONTEXT_LIMIT - 1)}${emoji}${'z'.repeat(10)}`;
    const text = `above\n\n${passage}${below}`;
    const at = text.indexOf(passage);
    const anchor = buildDocAnchor(text, at, at + passage.length);

    expect(halfCharacter.test(anchor.suffix)).toBe(false);
    expect(anchor.suffix).toHaveLength(DOC_ANCHOR_CONTEXT_LIMIT - 1);
    expect(text.slice(at + passage.length, at + passage.length + anchor.suffix.length)).toBe(
      anchor.suffix,
    );
    expect(locateDocAnchor(text, anchor)).toEqual({ start: at, end: at + passage.length });
    expect(() => docCommentAnchorSchema.parse(anchor)).not.toThrow();
  });
});

describe('locateDocAnchor', () => {
  it('finds the passage where it was anchored', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);

    expect(locateDocAnchor(document, anchor)).toEqual({
      start,
      end: start + passage.length,
    });
  });

  it('still finds the passage after the text above it grew', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);
    const edited = document.replace('Status update', 'Status update, week 14, from the whole team');
    const moved = edited.indexOf(passage);

    expect(moved).not.toBe(start);
    expect(locateDocAnchor(edited, anchor)).toEqual({ start: moved, end: moved + passage.length });
  });

  it('still finds the passage after the text below it was rewritten', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);
    const edited = document.replace('We meet on Thursday.', 'The review moved to next quarter.');

    expect(locateDocAnchor(edited, anchor)).toEqual({ start, end: start + passage.length });
  });

  it('picks the occurrence whose surroundings match when the quote repeats', () => {
    const repeated = `Intro\n\n${passage}\n\nMiddle\n\n${passage}\n\nOutro`;
    const second = repeated.lastIndexOf(passage);
    const anchor = buildDocAnchor(repeated, second, second + passage.length);
    const edited = repeated.replace('Intro', 'A much longer introduction than before');
    const movedSecond = edited.lastIndexOf(passage);

    expect(locateDocAnchor(edited, anchor)).toEqual({
      start: movedSecond,
      end: movedSecond + passage.length,
    });
  });

  it('falls back to the nearest occurrence when the surroundings are gone', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);
    const stripped = `${passage}\n\nnothing else survived`;

    expect(locateDocAnchor(stripped, anchor)).toEqual({ start: 0, end: passage.length });
  });

  it('returns null once the quoted text itself was edited away', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);
    const edited = document.replace(passage, 'The launch is on track.');

    expect(locateDocAnchor(edited, anchor)).toBeNull();
  });

  it('returns null for an empty document', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);

    expect(locateDocAnchor('', anchor)).toBeNull();
  });

  it('refuses an anchor with no quote instead of matching at the recorded offset', () => {
    const empty = { quote: '', prefix: '', suffix: '', start };

    expect(locateDocAnchor(document, empty)).toBeNull();
    expect(isDocAnchorOrphaned(document, empty)).toBe(true);
  });

  it('prefers the occurrence nearer the recorded offset when the context cannot decide', () => {
    const repeated = `alpha ${passage} middle ${passage} omega`;
    const first = repeated.indexOf(passage);
    const second = repeated.lastIndexOf(passage);
    const nearSecond = { quote: passage, prefix: '', suffix: '', start: second - 1 };
    const nearFirst = { quote: passage, prefix: '', suffix: '', start: first + 1 };

    expect(locateDocAnchor(repeated, nearSecond)).toEqual({
      start: second,
      end: second + passage.length,
    });
    expect(locateDocAnchor(repeated, nearFirst)).toEqual({
      start: first,
      end: first + passage.length,
    });
  });

  it('finds a passage that sits past more repeats of the quote than it will ever score', () => {
    const filler = 'lever '.repeat(600);
    const long = `${filler}UNIQUE PREAMBLE lever UNIQUE TAIL`;
    const real = long.indexOf('UNIQUE PREAMBLE ') + 'UNIQUE PREAMBLE '.length;
    const anchor = buildDocAnchor(long, real, real + 'lever'.length);

    expect(long.split('lever').length - 1).toBeGreaterThan(512);
    expect(locateDocAnchor(long, anchor)).toEqual({ start: real, end: real + 'lever'.length });
  });

  it('reports orphaned rather than guessing when the quote repeats past the candidate cap', () => {
    const filler = 'lever '.repeat(600);
    const anchor = {
      quote: 'lever',
      prefix: 'CONTEXT THAT IS NOWHERE IN THIS DOCUMENT',
      suffix: 'NOR IS THIS ONE EITHER',
      start: filler.length * 4,
    };

    expect(locateDocAnchor(filler, anchor)).toBeNull();
  });
});

describe('isDocAnchorOrphaned', () => {
  it('is false while the passage is still there', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);

    expect(isDocAnchorOrphaned(document, anchor)).toBe(false);
  });

  it('becomes true when an edit removes the quoted passage', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);
    const edited = document.replace('blocked on the migration', 'unblocked');

    expect(isDocAnchorOrphaned(edited, anchor)).toBe(true);
  });

  it('treats a partially deleted passage as orphaned rather than half matching', () => {
    const anchor = buildDocAnchor(document, start, start + passage.length);
    const edited = document.replace(passage, passage.slice(0, 10));

    expect(isDocAnchorOrphaned(edited, anchor)).toBe(true);
  });
});

describe('docCommentAnchorSchema', () => {
  it('fills in the context fields that an older client may omit', () => {
    const parsed = docCommentAnchorSchema.parse({ quote: passage, start: 12 });

    expect(parsed).toEqual({ quote: passage, prefix: '', suffix: '', start: 12 });
  });

  it('rejects an empty quote and a negative position', () => {
    expect(() => docCommentAnchorSchema.parse({ quote: '', start: 0 })).toThrow();
    expect(() => docCommentAnchorSchema.parse({ quote: passage, start: -1 })).toThrow();
  });

  it('rejects a quote longer than a passage anyone would select', () => {
    expect(() => docCommentAnchorSchema.parse({ quote: 'x'.repeat(5000), start: 0 })).toThrow();
  });

  it('takes an anchor made of whole characters and refuses one cut through a character', () => {
    const whole = { quote: `${emoji} ships today`, prefix: `after ${emoji}`, suffix: '', start: 4 };
    const high = emoji.charAt(0);
    const low = emoji.charAt(1);

    expect(() => docCommentAnchorSchema.parse(whole)).not.toThrow();
    expect(() => docCommentAnchorSchema.parse({ ...whole, quote: `ends in ${high}` })).toThrow();
    expect(() => docCommentAnchorSchema.parse({ ...whole, prefix: `${low} starts` })).toThrow();
    expect(() => docCommentAnchorSchema.parse({ ...whole, suffix: `ends in ${high}` })).toThrow();
  });
});
