import { describe, expect, it } from 'bun:test';
import { selectionThrough } from '../../../src/features/issues/issue-list.tsx';

describe('selectionThrough', () => {
  it('anchors on the row being left and takes the row being reached', () => {
    expect(selectionThrough([], 'a', 'b')).toEqual(['a', 'b']);
  });

  it('grows the range as the caret keeps moving', () => {
    const first = selectionThrough([], 'a', 'b');
    expect(selectionThrough(first, 'b', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('collapses the range when the caret turns back', () => {
    expect(selectionThrough(['a', 'b', 'c'], 'c', 'b')).toEqual(['a', 'b']);
    expect(selectionThrough(['a', 'b'], 'b', 'a')).toEqual(['a']);
  });

  it('leaves the selection alone at the end of the list', () => {
    expect(selectionThrough(['a'], 'a', 'a')).toEqual(['a']);
    expect(selectionThrough(['a'], 'a', undefined)).toEqual(['a']);
  });

  it('never lists a row twice', () => {
    expect(selectionThrough(['a', 'b'], 'a', 'b')).toEqual(['b']);
    expect(selectionThrough(['b'], 'a', 'b')).toEqual(['b']);
  });

  it('takes the reached row without an anchor when nothing was left behind', () => {
    expect(selectionThrough([], undefined, 'b')).toEqual(['b']);
  });
});
