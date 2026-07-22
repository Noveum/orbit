import { describe, expect, it } from 'vitest';
import { IDENTIFIER_PATTERN, SORT_ORDER_STEP } from '../constants/index.ts';
import {
  branchName,
  chunk,
  extractIssueIdentifiers,
  extractMentions,
  formatBytes,
  groupBy,
  initialsOf,
  issueIdentifier,
  parseIssueIdentifier,
  relativeTime,
  slugify,
  sortOrderBetween,
  truncate,
  unique,
} from './index.ts';

describe('slugify', () => {
  it('lowercases and dashes separators', () => {
    expect(slugify('Realtime Sync Engine')).toBe('realtime-sync-engine');
  });

  it('strips punctuation and collapses repeats', () => {
    expect(slugify('  Docs && Attachments!!  ')).toBe('docs-attachments');
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('issue identifiers', () => {
  it('builds an identifier', () => {
    expect(issueIdentifier('ENG', 62)).toBe('ENG-62');
  });

  it('parses a valid identifier and uppercases the prefix', () => {
    expect(parseIssueIdentifier('eng-62')).toEqual({ prefix: 'ENG', number: 62 });
  });

  it('rejects malformed identifiers', () => {
    expect(parseIssueIdentifier('ENG')).toBeNull();
    expect(parseIssueIdentifier('ENG-0')).toBeNull();
    expect(parseIssueIdentifier('-12')).toBeNull();
    expect(parseIssueIdentifier('TOOLONGPREFIX-1')).toBeNull();
  });

  it('rejects a one character prefix, matching the team key contract', () => {
    expect(IDENTIFIER_PATTERN.test('A')).toBe(false);
    expect(parseIssueIdentifier('A-1')).toBeNull();
    expect(extractIssueIdentifiers('Refs A-1')).toEqual([]);
  });

  it('accepts the shortest and longest legal prefixes', () => {
    expect(parseIssueIdentifier('AB-1')).toEqual({ prefix: 'AB', number: 1 });
    expect(parseIssueIdentifier('ABCDEF-1')).toEqual({ prefix: 'ABCDEF', number: 1 });
    expect(extractIssueIdentifiers('AB-1 and ABCDEF-2')).toEqual(['AB-1', 'ABCDEF-2']);
  });
});

describe('branchName', () => {
  it('builds a git safe branch from an issue', () => {
    expect(
      branchName({ username: 'Pulkit', identifier: 'ENG-62', title: 'Fix the board drag' }),
    ).toBe('pulkit/eng-62-fix-the-board-drag');
  });

  it('falls back when the title yields nothing', () => {
    expect(branchName({ username: 'pulkit', identifier: 'ENG-1', title: '!!!' })).toBe(
      'pulkit/eng-1',
    );
  });

  it('falls back when the username yields nothing', () => {
    expect(branchName({ username: '!!!', identifier: 'ENG-1', title: 'Ship it' })).toBe(
      'orbit/eng-1-ship-it',
    );
  });
});

describe('sortOrderBetween', () => {
  it('returns the step for an empty column', () => {
    expect(sortOrderBetween(null, null)).toBe(SORT_ORDER_STEP);
  });

  it('places before the first item', () => {
    expect(sortOrderBetween(null, 1024)).toBe(0);
  });

  it('places after the last item', () => {
    expect(sortOrderBetween(2048, null)).toBe(2048 + SORT_ORDER_STEP);
  });

  it('midpoints between two neighbours', () => {
    expect(sortOrderBetween(1024, 2048)).toBe(1536);
  });

  it('keeps ordering stable across repeated insertions', () => {
    let before = 1024;
    const after = 2048;
    for (let index = 0; index < 10; index += 1) {
      const next = sortOrderBetween(before, after);
      expect(next).toBeGreaterThan(before);
      expect(next).toBeLessThan(after);
      before = next;
    }
  });
});

describe('initialsOf', () => {
  it('uses the first and last name', () => {
    expect(initialsOf('Shashank Agarwal')).toBe('SA');
  });

  it('handles a single name', () => {
    expect(initialsOf('Pulkit')).toBe('P');
  });

  it('handles empty input', () => {
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('extractMentions', () => {
  it('finds handles and lowercases them', () => {
    expect(extractMentions('cc @Aditi and @shashank')).toEqual(['aditi', 'shashank']);
  });

  it('deduplicates', () => {
    expect(extractMentions('@aditi @aditi')).toEqual(['aditi']);
  });

  it('ignores emails', () => {
    expect(extractMentions('mail pulkit@noveum.ai now')).toEqual([]);
  });
});

describe('extractIssueIdentifiers', () => {
  it('finds identifiers in free text', () => {
    expect(extractIssueIdentifiers('Fixes ENG-62 and refs DES-7')).toEqual(['ENG-62', 'DES-7']);
  });

  it('deduplicates repeats', () => {
    expect(extractIssueIdentifiers('ENG-1 ENG-1')).toEqual(['ENG-1']);
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('adds an ellipsis when cutting', () => {
    expect(truncate('a very long sentence', 8)).toBe('a very…');
  });
});

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('rounds larger units', () => {
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
  });
});

describe('collections', () => {
  it('groups by a key', () => {
    const grouped = groupBy([{ s: 'a' }, { s: 'b' }, { s: 'a' }], (item) => item.s);
    expect(grouped.get('a')).toHaveLength(2);
    expect(grouped.get('b')).toHaveLength(1);
  });

  it('uniques values', () => {
    expect(unique([1, 1, 2])).toEqual([1, 2]);
  });

  it('chunks evenly and unevenly', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rejects a non positive chunk size', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-22T12:00:00.000Z');

  it('reports recent moments', () => {
    expect(relativeTime(new Date('2026-07-22T11:59:50.000Z'), now)).toBe('just now');
  });

  it('reports minutes, hours, and days', () => {
    expect(relativeTime(new Date('2026-07-22T11:30:00.000Z'), now)).toBe('30m ago');
    expect(relativeTime(new Date('2026-07-22T09:00:00.000Z'), now)).toBe('3h ago');
    expect(relativeTime(new Date('2026-07-19T12:00:00.000Z'), now)).toBe('3d ago');
  });
});
