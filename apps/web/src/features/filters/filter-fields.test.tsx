import { describe, expect, it } from 'bun:test';
import type { Issue } from '@/lib/query/schemas.ts';
import { countValues, type FilterFieldDefinition } from './filter-fields.tsx';

const labelDef = {
  property: 'label',
  input: 'values',
  label: 'Label',
  options: [],
  countOf: (issue: Issue) => (Array.isArray(issue.labelIds) ? issue.labelIds : []),
} as unknown as FilterFieldDefinition;

describe('countValues', () => {
  it('never throws when the issues argument is not an array', () => {
    const infiniteDataShape = { pages: [], pageParams: [] } as unknown as readonly Issue[];
    expect(countValues(labelDef, infiniteDataShape).size).toBe(0);
    expect(countValues(labelDef, undefined as unknown as readonly Issue[]).size).toBe(0);
  });

  it('counts values for a normal issue array', () => {
    const rows = [
      { labelIds: ['bug'] },
      { labelIds: ['bug', 'perf'] },
    ] as unknown as readonly Issue[];
    const counts = countValues(labelDef, rows);
    expect(counts.get('bug')).toBe(2);
    expect(counts.get('perf')).toBe(1);
  });
});
