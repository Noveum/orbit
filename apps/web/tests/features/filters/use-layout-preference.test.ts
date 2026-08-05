import { describe, expect, it } from 'bun:test';
import { isLayoutMode, storedLayout } from '@/features/filters/use-layout-preference.ts';

const preferences = {
  preferences: [
    { page: 'my_issues', scope: '', layout: 'board', display: {} },
    { page: 'team', scope: 'eng', layout: 'list', display: {} },
    { page: 'team', scope: 'design', layout: 'gantt', display: {} },
  ],
};

describe('reading back how someone left a page', () => {
  it('finds the layout for the page and scope asked for', () => {
    expect(storedLayout(preferences, 'my_issues', '')).toBe('board');
    expect(storedLayout(preferences, 'team', 'eng')).toBe('list');
  });

  it('has nothing for a page nobody has chosen yet, so the default stands', () => {
    expect(storedLayout(preferences, 'project', '')).toBeNull();
    expect(storedLayout(undefined, 'my_issues', '')).toBeNull();
  });

  it('keeps one scope from answering for another', () => {
    expect(storedLayout(preferences, 'team', 'marketing')).toBeNull();
  });

  it('ignores a layout the product no longer has rather than rendering nothing', () => {
    expect(storedLayout(preferences, 'team', 'design')).toBeNull();
  });

  it('knows which layouts are real', () => {
    expect(isLayoutMode('board')).toBe(true);
    expect(isLayoutMode('list')).toBe(true);
    expect(isLayoutMode('timeline')).toBe(false);
  });
});
