import { describe, expect, it } from 'bun:test';
import {
  buildDocAnchor,
  DOC_ANCHOR_CONTEXT_LIMIT,
  isDocAnchorOrphaned,
  locateDocAnchor,
} from '../../src/utils/doc-anchor.ts';
import { docCommentAnchorSchema } from '../../src/validators/comment.ts';

const passage = 'The launch is blocked on the migration.';
const document = `Status update\n\n${passage}\n\nWe meet on Thursday.`;
const start = document.indexOf(passage);

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
});
