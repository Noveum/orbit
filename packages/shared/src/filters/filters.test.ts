import { describe, expect, it } from 'bun:test';
import { issueFilterSchema } from '../validators/index.ts';
import type { FilterPredicate } from './index.ts';
import {
  decodeFilterPredicates,
  dropLastPredicate,
  encodeFilterPredicates,
  MAX_FILTER_PREDICATES,
  removePredicate,
  replacePredicate,
} from './index.ts';

const predicates: FilterPredicate[] = [
  { field: 'state', operator: 'is', values: ['state-a', 'state-b'] },
  { field: 'assignee', operator: 'is_not', values: ['user-1'] },
  { field: 'due', operator: 'is', values: ['overdue', 'this_week'] },
];

describe('filter predicate encoding', () => {
  it('round trips through the url form without losing anything', () => {
    const encoded = encodeFilterPredicates(predicates);
    expect(encoded).toBe(
      'state:is:state-a,state-b;assignee:is_not:user-1;due:is:overdue,this_week',
    );
    expect(decodeFilterPredicates(encoded)).toEqual(predicates);
  });

  it('encodes an empty set to an empty string', () => {
    expect(encodeFilterPredicates([])).toBe('');
    expect(decodeFilterPredicates('')).toEqual([]);
  });

  it('drops chunks that are not valid predicates', () => {
    expect(decodeFilterPredicates('bogus:is:x;state:is:state-a;assignee:is:')).toEqual([
      { field: 'state', operator: 'is', values: ['state-a'] },
    ]);
  });

  it('rejects values carrying separator or script characters', () => {
    expect(decodeFilterPredicates('state:is:<script>')).toEqual([]);
  });

  it('stops decoding past the predicate ceiling the server enforces', () => {
    const oversized = Array.from({ length: 40 }, () => 'state:is:state-a').join(';');
    expect(decodeFilterPredicates(oversized)).toHaveLength(MAX_FILTER_PREDICATES);
    expect(() => issueFilterSchema.parse({ predicates: oversized })).not.toThrow();
  });

  it('defaults a missing operator to is', () => {
    expect(decodeFilterPredicates('label:is:label-a')[0]?.operator).toBe('is');
  });
});

describe('issueFilterSchema predicates', () => {
  it('parses the url string form', () => {
    const parsed = issueFilterSchema.parse({ predicates: 'priority:is:1,2' });
    expect(parsed.predicates).toEqual([{ field: 'priority', operator: 'is', values: ['1', '2'] }]);
  });

  it('parses the stored json form', () => {
    const parsed = issueFilterSchema.parse({ predicates });
    expect(parsed.predicates).toEqual(predicates);
  });

  it('defaults to no predicates', () => {
    expect(issueFilterSchema.parse({}).predicates).toEqual([]);
  });

  it('reads boolean flags from url strings', () => {
    expect(issueFilterSchema.parse({ includeSubIssues: 'false' }).includeSubIssues).toBe(false);
    expect(issueFilterSchema.parse({ includeSubIssues: '0' }).includeSubIssues).toBe(false);
    expect(issueFilterSchema.parse({ includeSubIssues: 'true' }).includeSubIssues).toBe(true);
    expect(issueFilterSchema.parse({}).includeSubIssues).toBe(true);
    expect(issueFilterSchema.parse({ includeArchived: true }).includeArchived).toBe(true);
  });

  it('refuses an unknown field', () => {
    expect(() =>
      issueFilterSchema.parse({ predicates: [{ field: 'nope', values: ['x'] }] }),
    ).toThrow();
  });
});

describe('predicate list helpers', () => {
  it('replaces the predicate that already covers a field', () => {
    const next = replacePredicate(predicates, {
      field: 'assignee',
      operator: 'is',
      values: ['user-2'],
    });
    expect(next).toHaveLength(3);
    expect(next[1]).toEqual({ field: 'assignee', operator: 'is', values: ['user-2'] });
  });

  it('appends a predicate for a field that is not filtered yet', () => {
    const next = replacePredicate(predicates, {
      field: 'label',
      operator: 'is',
      values: ['label-1'],
    });
    expect(next).toHaveLength(4);
    expect(next.at(-1)?.field).toBe('label');
  });

  it('removes one field and leaves the rest', () => {
    expect(removePredicate(predicates, 'state').map((entry) => entry.field)).toEqual([
      'assignee',
      'due',
    ]);
  });

  it('drops only the last predicate', () => {
    expect(dropLastPredicate(predicates).map((entry) => entry.field)).toEqual([
      'state',
      'assignee',
    ]);
    expect(dropLastPredicate([])).toEqual([]);
  });
});
