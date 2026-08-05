import { describe, expect, it } from 'bun:test';
import { activeHeadingId, activeHeadingIndex } from '../../../src/features/docs/editor-outline.ts';
import type { DocHeading } from '../../../src/features/docs/outline.ts';

const headings: DocHeading[] = [
  { id: 'intro', text: 'Intro', level: 1 },
  { id: 'shape', text: 'Action shape', level: 2 },
  { id: 'rules', text: 'Rules', level: 2 },
];

const tops = [0, 800, 1600];

describe('which heading the editor is sitting on', () => {
  it('is the first one before the reader has scrolled', () => {
    expect(activeHeadingIndex(tops, 0)).toBe(0);
    expect(activeHeadingId(headings, tops, 0)).toBe('intro');
  });

  it('moves on once a heading passes the top of the viewport', () => {
    expect(activeHeadingId(headings, tops, 760)).toBe('shape');
    expect(activeHeadingId(headings, tops, 1560)).toBe('rules');
  });

  it('stays on the last heading once it is scrolled well past', () => {
    expect(activeHeadingId(headings, tops, 9000)).toBe('rules');
  });

  it('holds the earlier heading while the next one is still below the band', () => {
    expect(activeHeadingId(headings, tops, 600)).toBe('intro');
  });

  it('has nothing to point at in a document without headings', () => {
    expect(activeHeadingIndex([], 0)).toBe(-1);
    expect(activeHeadingId([], [], 0)).toBeNull();
  });
});
