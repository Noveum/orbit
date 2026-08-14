import { describe, expect, it } from 'bun:test';
import { emptyFacets, type IssueFacets } from '@/lib/query/schemas.ts';
import {
  buildFilterFields,
  countValues,
  type FilterFieldDefinition,
} from '../../../src/features/filters/filter-fields.tsx';
import type { WorkspaceData } from '../../../src/features/issues/workspace-provider.tsx';

const labelDef = {
  property: 'label',
  input: 'values',
  label: 'Label',
  options: [],
  facet: 'label',
} as unknown as FilterFieldDefinition;

const uncountedDef = {
  property: 'content',
  input: 'text',
  label: 'Content',
  options: [],
  facet: null,
} as unknown as FilterFieldDefinition;

function facetsWith(label: Record<string, number>): IssueFacets['facets'] {
  return { ...emptyFacets(), label };
}

describe('countValues', () => {
  it('reads the counts the server measured over the whole scope', () => {
    const counts = countValues(labelDef, facetsWith({ bug: 412, perf: 97 }));
    expect(counts.get('bug')).toBe(412);
    expect(counts.get('perf')).toBe(97);
  });

  it('returns nothing before the summary has loaded', () => {
    expect(countValues(labelDef, undefined).size).toBe(0);
  });

  it('returns nothing for a field the server does not count', () => {
    expect(countValues(uncountedDef, facetsWith({ bug: 3 })).size).toBe(0);
  });

  it('survives a facet the server omitted', () => {
    const partial = { ...emptyFacets() } as unknown as IssueFacets['facets'];
    expect(countValues(labelDef, partial).size).toBe(0);
  });
});

describe('buildFilterFields', () => {
  it('includes states from every team for workspace analytics', () => {
    const workspace = {
      states: [
        {
          id: 'state-a',
          teamId: 'team-a',
          name: 'Todo',
          category: 'unstarted',
          color: '#111111',
          position: 0,
        },
        {
          id: 'state-b',
          teamId: 'team-b',
          name: 'In progress',
          category: 'started',
          color: '#222222',
          position: 0,
        },
      ],
      members: [],
      labels: [],
      cycles: [],
      projects: [],
    } as unknown as WorkspaceData;

    const fields = buildFilterFields(workspace, null, ['state'], { workspaceWide: true });
    expect(fields[0]?.options.map((option) => option.value)).toEqual(['state-a', 'state-b']);
  });
});
